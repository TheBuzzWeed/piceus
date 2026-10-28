import json
import os
import re
import time
from urllib import error, parse, request
from collections import deque
from html import escape
from threading import Lock

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from .blog_service import create_blog_router


app = FastAPI(title='PICEUS API', version='0.1.0')


MIN_CONTACT_FILL_TIME_MS = 1500
MAX_CONTACT_FILL_TIME_MS = 60 * 60 * 1000
MAX_CONTACT_NAME_LENGTH = 80
MAX_CONTACT_EMAIL_LENGTH = 150
MAX_CONTACT_INTEREST_LENGTH = 120
MAX_CONTACT_MESSAGE_LENGTH = 4000
DEFAULT_CONTACT_RATE_MAX_REQUESTS = 8
CONTACT_RATE_WINDOW_SECONDS = 60 * 60
EMAIL_PATTERN = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
contact_rate_buckets: dict[str, deque[float]] = {}
contact_rate_lock = Lock()


def env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == '':
        return default
    return value


def truthy(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {'1', 'true', 'yes', 'on'}


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=env(
        'PICEUS_API_ALLOWED_ORIGIN_REGEX',
        (
            r'https://([a-z0-9-]+\.)?'
            r'(piceus\.com|buzzvibe\.com|merlinintelligence\.ai|churchofmatrix\.[a-z.]+)$'
            r'|http://(localhost|127\.0\.0\.1)(:\d+)?$'
        ),
    ),
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def api_base_url() -> str:
    return env(
        'PICEUS_MATRIX_API_URL',
        'https://merlin-theme-api-deploy.vercel.app',
    ).rstrip('/')


def auth_api_base_url() -> str:
    return env(
        'PICEUS_AUTH_API_URL',
        'https://backend.buzzvibe.com/api/v2',
    ).rstrip('/')


def parse_recipient_emails(raw_value: str) -> list[str]:
    return [
        candidate.strip()
        for candidate in raw_value.replace(';', ',').split(',')
        if candidate.strip()
    ]


def parse_identity_markers(raw_value: str) -> set[str]:
    return {
        candidate.strip().lower()
        for candidate in raw_value.replace(';', ',').split(',')
        if candidate.strip()
    }


def contact_recipients() -> list[str]:
    return parse_recipient_emails(env('CONTACT_TO_EMAIL', ''))


def contact_configured() -> bool:
    return bool(env('RESEND_API_KEY', '').strip() and contact_recipients())


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.match(value))


def contact_rate_max_requests() -> int:
    raw_value = env('CONTACT_RATE_MAX_REQUESTS', '')
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = DEFAULT_CONTACT_RATE_MAX_REQUESTS
    return parsed if parsed > 0 else DEFAULT_CONTACT_RATE_MAX_REQUESTS


def get_client_ip(incoming: Request) -> str:
    forwarded_for = incoming.headers.get('x-forwarded-for', '')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    real_ip = incoming.headers.get('x-real-ip', '').strip()
    if real_ip:
        return real_ip
    if incoming.client and incoming.client.host:
        return incoming.client.host
    return 'unknown'


def is_rate_limited(client_ip: str) -> bool:
    now = time.time()
    window_start = now - CONTACT_RATE_WINDOW_SECONDS
    max_requests = contact_rate_max_requests()

    with contact_rate_lock:
        bucket = contact_rate_buckets.setdefault(client_ip, deque())
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= max_requests:
            return True
        bucket.append(now)
    return False


def contact_recipient_map() -> dict[str, list[str]]:
    raw_value = env('CONTACT_ROUTING_MAP', '').strip()
    if not raw_value:
        return {}

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed, dict):
        return {}

    routing: dict[str, list[str]] = {}
    for key, value in parsed.items():
        if not isinstance(key, str):
            continue

        recipients: list[str] = []
        if isinstance(value, list):
            recipients = [
                item.strip()
                for item in value
                if isinstance(item, str) and item.strip()
            ]
        elif isinstance(value, str) and value.strip():
            recipients = parse_recipient_emails(value)

        if recipients:
            routing[key.strip().lower()] = recipients

    return routing


def resolve_contact_recipients(interest: str) -> list[str]:
    routing = contact_recipient_map()
    routed = routing.get(interest.strip().lower())
    return routed or contact_recipients()


def send_resend_email(
    *,
    api_key: str,
    from_email: str,
    to_emails: list[str],
    subject: str,
    text: str,
    html: str,
    reply_to: str | None = None,
) -> dict:
    payload = {
        'from': from_email,
        'to': to_emails,
        'subject': subject,
        'text': text,
        'html': html,
    }
    if reply_to:
        payload['reply_to'] = reply_to

    outgoing = request.Request(
        'https://api.resend.com/emails',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        method='POST',
    )

    try:
        with request.urlopen(outgoing, timeout=25) as response:
            raw = response.read().decode('utf-8')
            if not raw:
                return {}
            return json.loads(raw)
    except error.HTTPError as exc:
        raw = exc.read().decode('utf-8')
        detail = 'Unable to send message right now.'
        try:
            parsed = json.loads(raw)
            detail = parsed.get('message') or parsed.get('error') or detail
        except json.JSONDecodeError:
            if raw:
                detail = raw
        raise HTTPException(status_code=502, detail=detail) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail='Unable to reach the contact relay provider.',
        ) from exc


def build_internal_contact_html(
    *,
    name: str,
    email: str,
    interest: str,
    page_url: str,
    request_id: str,
    client_ip: str,
    message: str,
) -> str:
    return ''.join([
        (
            '<!doctype html><html><body '
            'style="margin:0;padding:24px;background:#0f1115;'
            'color:#f5f7f9;font-family:Arial,Helvetica,sans-serif;">'
        ),
        (
            '<div style="max-width:680px;margin:0 auto;background:#171a21;'
            'border:1px solid #2a303b;border-radius:18px;padding:28px;">'
        ),
        (
            '<div style="font-size:12px;letter-spacing:0.18em;'
            'text-transform:uppercase;color:#8d96a6;margin-bottom:12px;">'
            'PICEUS contact relay</div>'
        ),
        (
            f'<h1 style="margin:0 0 18px;font-size:30px;line-height:1.15;">'
            f'{escape(name)}</h1>'
        ),
        (
            f'<p style="margin:0 0 8px;"><strong>Email:</strong> '
            f'{escape(email)}</p>'
        ),
        (
            f'<p style="margin:0 0 8px;"><strong>Interest:</strong> '
            f'{escape(interest)}</p>'
        ),
        (
            f'<p style="margin:0 0 8px;"><strong>Page:</strong> '
            f'{escape(page_url)}</p>'
        ),
        (
            f'<p style="margin:0 0 8px;"><strong>Request ID:</strong> '
            f'{escape(request_id or "n/a")}</p>'
        ),
        (
            f'<p style="margin:0 0 24px;"><strong>Client IP:</strong> '
            f'{escape(client_ip)}</p>'
        ),
        (
            '<div style="padding:18px;border-radius:12px;'
            'background:#0f1115;border:1px solid #2a303b;'
            f'white-space:pre-wrap;">{escape(message)}</div>'
        ),
        '</div></body></html>',
    ])


def build_sender_receipt_html(name: str) -> str:
    return ''.join([
        (
            '<!doctype html><html><body '
            'style="margin:0;padding:24px;background:#f7f3ef;'
            'color:#242424;font-family:Arial,Helvetica,sans-serif;">'
        ),
        (
            '<div style="max-width:640px;margin:0 auto;background:#ffffff;'
            'border:1px solid #e3ddd8;border-radius:18px;padding:28px;">'
        ),
        (
            '<div style="font-size:12px;letter-spacing:0.18em;'
            'text-transform:uppercase;color:#8e8177;margin-bottom:14px;">'
            'PICEUS</div>'
        ),
        (
            f'<h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;">'
            f'Thank you, {escape(name)}.</h1>'
        ),
        (
            '<p style="margin:0 0 14px;line-height:1.7;">'
            'Your inquiry was received by the internal PICEUS team. '
            'A designated contact will review it and respond directly '
            'if follow-up is needed.</p>'
        ),
        (
            '<p style="margin:0;line-height:1.7;color:#5f5a56;">'
            'This acknowledgement is automated. It does not create an '
            'account and does not open public access to the platform.</p>'
        ),
        '</div></body></html>',
    ])


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if authorization.lower().startswith('bearer '):
        return authorization[7:]
    return authorization


def sanitize_error_detail(value: object) -> object:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        sanitized_items = [
            sanitize_error_detail(item)
            for item in value
        ]
        return [
            item for item in sanitized_items
            if item not in (None, '', [], {})
        ]
    if isinstance(value, dict):
        if isinstance(value.get('msg'), str) and value.get('msg', '').strip():
            location = value.get('loc')
            path = ''
            if isinstance(location, list):
                path = '.'.join(
                    str(part) for part in location if str(part) != 'body'
                )
            message = value['msg'].strip()
            return f'{path}: {message}' if path else message

        sanitized: dict[str, object] = {}
        for key, nested in value.items():
            if key in {
                'input',
                'password',
                'token',
                'access_token',
                'refresh_token',
            }:
                continue
            sanitized_nested = sanitize_error_detail(nested)
            if sanitized_nested not in (None, '', [], {}):
                sanitized[key] = sanitized_nested
        return sanitized
    return value


def forward_json(
    method: str,
    path: str,
    payload: dict | None = None,
    token: str | None = None,
    query_string: str = '',
    base_url: str | None = None,
) -> dict:
    target = f'{(base_url or api_base_url())}{path}'
    if query_string:
        target = f'{target}?{query_string}'

    body = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        body = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'

    outgoing = request.Request(
        target,
        data=body,
        headers=headers,
        method=method,
    )

    try:
        with request.urlopen(outgoing, timeout=25) as response:
            raw = response.read().decode('utf-8')
            if not raw:
                return {}
            return json.loads(raw)
    except error.HTTPError as exc:
        raw = exc.read().decode('utf-8')
        detail = raw
        try:
            parsed = json.loads(raw)
            detail = sanitize_error_detail(
                parsed.get('detail') or parsed.get('message') or parsed
            )
        except json.JSONDecodeError:
            if not detail:
                detail = 'Request failed'
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail='Unable to reach the MATRIX API upstream.',
        ) from exc


def auth_forward_json(
    method: str,
    path: str,
    payload: dict | None = None,
    token: str | None = None,
    query_string: str = '',
) -> dict:
    return forward_json(
        method,
        path,
        payload=payload,
        token=token,
        query_string=query_string,
        base_url=auth_api_base_url(),
    )


def membership_user_from_response(payload: dict) -> dict:
    if isinstance(payload, dict) and isinstance(payload.get('user'), dict):
        return payload['user']
    return payload


def normalize_membership_auth_response(payload: dict) -> dict:
    user = membership_user_from_response(payload)
    token = payload.get('token') if isinstance(payload, dict) else None
    refresh_token = (
        payload.get('refresh_token')
        if isinstance(payload, dict)
        else None
    )
    normalized = {
        'access_token': token or '',
        'refresh_token': refresh_token or '',
        'user': user,
    }
    if isinstance(payload, dict) and payload.get('message'):
        normalized['message'] = payload['message']
    return normalized


def resolve_matrix_actor(authorization: str | None) -> dict:
    token = bearer_token(authorization)
    if not token:
        return {
            'authenticated': False,
            'name': 'Guest Reader',
            'role': 'Public',
            'capabilities': {
                'canAccessMembersOnly': False,
                'canManagePosts': False,
            },
        }

    try:
        user_response = auth_forward_json(
            'GET',
            '/user/getuser',
            token=token,
        )
        user = membership_user_from_response(user_response)
    except HTTPException:
        return {
            'authenticated': False,
            'name': 'Guest Reader',
            'role': 'Public',
            'capabilities': {
                'canAccessMembersOnly': False,
                'canManagePosts': False,
            },
        }

    def flatten_claim_strings(value: object) -> set[str]:
        strings: set[str] = set()
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized:
                strings.add(normalized)
            return strings
        if isinstance(value, dict):
            for key, nested in value.items():
                key_text = str(key).strip().lower()
                if isinstance(nested, bool):
                    if nested and key_text:
                        strings.add(key_text)
                else:
                    if key_text:
                        strings.add(key_text)
                    strings.update(flatten_claim_strings(nested))
            return strings
        if isinstance(value, (list, tuple, set)):
            for item in value:
                strings.update(flatten_claim_strings(item))
        return strings

    def truthy_claim(source: dict, *keys: str) -> bool:
        for key in keys:
            value = source.get(key)
            if isinstance(value, bool) and value:
                return True
            if isinstance(value, str) and value.strip().lower() in {'1', 'true', 'yes', 'active', 'member'}:
                return True
        return False

    def has_active_membership(source: dict) -> bool:
        memberships = source.get('memberships')
        if isinstance(memberships, dict):
            memberships = [memberships]
        if not isinstance(memberships, list):
            return False
        for membership in memberships:
            if isinstance(membership, dict):
                if membership.get('active') is True:
                    return True
                status = str(
                    membership.get('status')
                    or membership.get('state')
                    or membership.get('tier')
                    or ''
                ).strip().lower()
                if status in {'active', 'member', 'paid', 'premium', 'trialing'}:
                    return True
            elif membership:
                return True
        return False

    markers = flatten_claim_strings(user)
    member_markers = {
        'member',
        'members',
        'membership',
        'subscribed',
        'subscriber',
        'premium',
        'paid',
        'community',
        'authenticated member',
    }
    manage_markers = {
        'admin',
        'administrator',
        'owner',
        'editor',
        'editorial',
        'author',
        'publisher',
        'staff',
        'blog:manage',
        'blog.manage',
        'blog:write',
        'blog.write',
        'blog:create',
        'blog.create',
        'blog:publish',
        'blog.publish',
        'article:manage',
        'article.manage',
        'article:write',
        'article.write',
        'content:manage',
        'content.manage',
        'content:write',
        'content.write',
    }

    default_super_admin_markers = {
        'dubsthecreator',
        'dubsthecreatoraccount',
    }
    configured_super_admin_markers = parse_identity_markers(
        env('PICEUS_SUPER_ADMIN_IDENTIFIERS', '')
    )
    super_admin_markers = (
        configured_super_admin_markers or default_super_admin_markers
    )
    identity_candidates = flatten_claim_strings({
        'email': user.get('email', ''),
        'username': user.get('username', ''),
        'preferred_username': user.get('preferred_username', ''),
        'handle': user.get('handle', ''),
        'slug': user.get('slug', ''),
        'name': user.get('name', ''),
        'id': user.get('id', ''),
    })
    is_piceus_super_admin = any(
        marker == candidate or marker in candidate
        for candidate in identity_candidates
        for marker in super_admin_markers
    )

    can_manage_posts = truthy_claim(
        user,
        'isAdmin',
        'is_admin',
        'isEditor',
        'is_editor',
        'isStaff',
        'is_staff',
        'canManageBlog',
        'can_manage_blog',
        'canPublish',
        'can_publish',
    ) or any(marker in markers for marker in manage_markers) or is_piceus_super_admin

    can_access_members_only = can_manage_posts or truthy_claim(
        user,
        'isMember',
        'is_member',
        'isSubscribed',
        'is_subscribed',
        'canAccessMembersOnly',
        'can_access_members_only',
        'canAccessMemberContent',
        'can_access_member_content',
    ) or has_active_membership(user) or any(marker in markers for marker in member_markers)

    return {
        'authenticated': True,
        'name': user.get('name') or user.get('email') or 'Authenticated Member',
        'role': user.get('role') or 'Authenticated Member',
        'capabilities': {
            'canAccessMembersOnly': can_access_members_only,
            'canManagePosts': can_manage_posts,
        },
        'source': 'matrix-auth-me',
    }


app.include_router(create_blog_router(resolve_matrix_actor))


@app.get('/api/health')
def health() -> dict:
    return {'ok': True, 'service': 'piceus-api'}


@app.get('/api/site-context')
def site_context() -> dict:
    authenticated = truthy('PICEUS_AUTHENTICATED_DEFAULT', True)
    session_user = {
        'name': env('PICEUS_DEFAULT_USER_NAME', 'Matrix Member'),
        'role': env(
            'PICEUS_DEFAULT_USER_ROLE',
            'Authenticated Visitor',
        ),
    }

    return {
        'session': {
            'authenticated': authenticated,
            'user': session_user,
        },
        'matrixProductName': env(
            'PICEUS_MATRIX_PRODUCT_NAME',
            'MATRIX',
        ),
        'matrixSigninUrl': env(
            'VITE_MATRIX_SIGNIN_URL',
            'https://www.piceus.com',
        ),
        'authenticatedHomePath': env(
            'PICEUS_AUTH_HOME_PATH',
            '/home',
        ),
        'contactEnabled': contact_configured(),
        'legacyOriginUrl': env('PICEUS_LEGACY_ORIGIN_URL', ''),
        'legacyOriginLabel': env(
            'PICEUS_LEGACY_ORIGIN_LABEL',
            'Current MATRIX shell',
        ),
        'matrixApiBaseUrl': auth_api_base_url(),
        'matrixAuthApiBaseUrl': auth_api_base_url(),
        'matrixLoginPath': env('PICEUS_MATRIX_LOGIN_PATH', '/login'),
        'accountSelfServiceEnabled': truthy(
            'PICEUS_ACCOUNT_SELF_SERVICE_ENABLED',
            False,
        ),
        'vercelProject': {
            'scope': env('PICEUS_EXPECTED_VERCEL_SCOPE', 'buzz-corp'),
            'projectName': env('PICEUS_EXPECTED_VERCEL_PROJECT', 'piceus'),
            'primaryDomain': env('PICEUS_PRIMARY_DOMAIN', 'www.piceus.com'),
            'secondaryDomain': env('PICEUS_SECONDARY_DOMAIN', 'piceus.com'),
        },
        'integrationStatus': (
            'PICEUS is wired to the ThinkTank content surface and '
            'BuzzVibe membership auth through FastAPI proxy endpoints '
            'and is intended '
            'for the BuzzCorp www.piceus.com Vercel project.'
        ),
    }


@app.post('/api/contact')
async def contact(incoming: Request) -> dict:
    if not contact_configured():
        raise HTTPException(
            status_code=503,
            detail='Contact routing is not configured yet.',
        )

    origin = incoming.headers.get('origin')
    host = incoming.headers.get('host')
    if origin and host:
        try:
            if parse.urlparse(origin).netloc != host:
                raise HTTPException(status_code=403, detail='Invalid origin.')
        except ValueError as exc:
            raise HTTPException(
                status_code=403,
                detail='Invalid origin.',
            ) from exc

    client_ip = get_client_ip(incoming)
    if is_rate_limited(client_ip):
        raise HTTPException(
            status_code=429,
            detail='Too many requests. Please try again later.',
        )

    payload = await incoming.json()
    configured_name = env('PICEUS_CONTACT_NAME_OVERRIDE', '').strip()
    name = configured_name or str(payload.get('name', '')).strip()
    email = str(payload.get('email', '')).strip()
    interest = str(payload.get('interest', '')).strip() or 'General inquiry'
    message = str(payload.get('message', '')).strip()
    company = str(payload.get('company', '')).strip()
    page_url = str(payload.get('pageUrl', '')).strip() or env(
        'VITE_MATRIX_SIGNIN_URL',
        'https://www.piceus.com',
    )

    try:
        started_at = int(payload.get('startedAt', 0))
    except (TypeError, ValueError):
        started_at = 0

    if company:
        return {'ok': True}

    if started_at <= 0:
        raise HTTPException(
            status_code=400,
            detail='Invalid submission timing.',
        )

    elapsed_ms = int(time.time() * 1000) - started_at
    if (
        elapsed_ms < MIN_CONTACT_FILL_TIME_MS
        or elapsed_ms > MAX_CONTACT_FILL_TIME_MS
    ):
        raise HTTPException(
            status_code=400,
            detail='Submission timing check failed.',
        )

    if len(name) < 2 or len(name) > MAX_CONTACT_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail='Please provide a valid name.',
        )

    if (
        not email
        or len(email) > MAX_CONTACT_EMAIL_LENGTH
        or not is_valid_email(email)
    ):
        raise HTTPException(
            status_code=400,
            detail='Please provide a valid email.',
        )

    if len(interest) > MAX_CONTACT_INTEREST_LENGTH:
        raise HTTPException(
            status_code=400,
            detail='Please shorten the inquiry type.',
        )

    if len(message) < 10 or len(message) > MAX_CONTACT_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail='Please provide a valid message.',
        )

    submitted_at = incoming.headers.get('x-vercel-id', '') or ''
    recipients = resolve_contact_recipients(interest)
    subject = f'PICEUS inquiry | {interest} | {name}'
    text = '\n'.join([
        'PICEUS inquiry',
        '',
        f'Name: {name}',
        f'Email: {email}',
        f'Interest: {interest}',
        f'Page: {page_url}',
        f'Request ID: {submitted_at or "n/a"}',
        f'Client IP: {client_ip}',
        '',
        message,
    ])
    html = build_internal_contact_html(
        name=name,
        email=email,
        interest=interest,
        page_url=page_url,
        request_id=submitted_at,
        client_ip=client_ip,
        message=message,
    )

    send_resend_email(
        api_key=env('RESEND_API_KEY', ''),
        from_email=env('CONTACT_FROM_EMAIL', 'PICEUS <onboarding@resend.dev>'),
        to_emails=recipients,
        subject=subject,
        text=text,
        html=html,
        reply_to=email,
    )

    sender_receipt_sent = False
    try:
        send_resend_email(
            api_key=env('RESEND_API_KEY', ''),
            from_email=env(
                'CONTACT_FROM_EMAIL',
                'PICEUS <onboarding@resend.dev>',
            ),
            to_emails=[email],
            subject='Thank you for contacting PICEUS',
            text=(
                'Thank you for reaching out to PICEUS. '
                'Your inquiry has been received by the internal team. '
                'If follow-up is needed, the assigned contact will '
                'respond directly.'
            ),
            html=build_sender_receipt_html(name),
        )
        sender_receipt_sent = True
    except HTTPException:
        sender_receipt_sent = False

    return {'ok': True, 'senderReceiptSent': sender_receipt_sent}


@app.post('/api/matrix/auth/login')
async def matrix_login(incoming: Request) -> dict:
    payload = await incoming.json()
    login_identifier = str(
        payload.get('identifier') or payload.get('email') or ''
    ).strip()
    membership_payload = {
        'identifier': login_identifier,
        'password': payload.get('password', ''),
    }
    response = auth_forward_json(
        'POST',
        '/user/login-user',
        payload=membership_payload,
    )
    return normalize_membership_auth_response(response)


@app.post('/api/matrix/auth/register')
async def matrix_register(incoming: Request) -> dict:
    payload = await incoming.json()
    return forward_json('POST', '/api/auth/register', payload=payload)


@app.post('/api/matrix/auth/refresh')
async def matrix_refresh(incoming: Request) -> dict:
    await incoming.json()
    raise HTTPException(
        status_code=400,
        detail='Session refresh is not available for this login surface.',
    )


@app.post('/api/matrix/auth/logout')
def matrix_logout(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    return auth_forward_json('POST', '/user/logout', token=token)


@app.get('/api/matrix/auth/me')
def matrix_me(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    response = auth_forward_json('GET', '/user/getuser', token=token)
    return membership_user_from_response(response)


@app.get('/api/matrix/widgets/metrics')
def matrix_metrics(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    return forward_json('GET', '/api/widgets/metrics', token=token)


@app.get('/api/matrix/widgets/status')
def matrix_status(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    return forward_json('GET', '/api/widgets/status', token=token)


@app.get('/api/matrix/widgets/alerts')
def matrix_alerts(
    authorization: str | None = Header(default=None),
    limit: int = Query(default=5, ge=1, le=25),
) -> dict:
    token = bearer_token(authorization)
    query_string = parse.urlencode({'limit': limit})
    return forward_json(
        'GET',
        '/api/widgets/alerts',
        token=token,
        query_string=query_string,
    )


@app.get('/api/matrix/widgets/logs')
def matrix_logs(
    authorization: str | None = Header(default=None),
    limit: int = Query(default=10, ge=1, le=50),
) -> dict:
    token = bearer_token(authorization)
    query_string = parse.urlencode({'limit': limit})
    return forward_json(
        'GET',
        '/api/widgets/logs',
        token=token,
        query_string=query_string,
    )
