import json
import os
from urllib import error, parse, request

from fastapi import FastAPI, Header, HTTPException, Query, Request


app = FastAPI(title='PICEUS API', version='0.1.0')


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


def api_base_url() -> str:
    return env(
        'PICEUS_MATRIX_API_URL',
        'https://merlin-theme-api-deploy.vercel.app',
    ).rstrip('/')


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if authorization.lower().startswith('bearer '):
        return authorization[7:]
    return authorization


def forward_json(
    method: str,
    path: str,
    payload: dict | None = None,
    token: str | None = None,
    query_string: str = '',
) -> dict:
    target = f'{api_base_url()}{path}'
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
            detail = parsed.get('detail') or parsed.get('message') or parsed
        except json.JSONDecodeError:
            if not detail:
                detail = 'Request failed'
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail='Unable to reach the MATRIX API upstream.',
        ) from exc


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
        'contactEmail': env(
            'PICEUS_CONTACT_EMAIL',
            'william.weems@gmail.com',
        ),
        'legacyOriginUrl': env('PICEUS_LEGACY_ORIGIN_URL', ''),
        'legacyOriginLabel': env(
            'PICEUS_LEGACY_ORIGIN_LABEL',
            'Current MATRIX shell',
        ),
        'matrixApiBaseUrl': api_base_url(),
        'matrixLoginPath': env('PICEUS_MATRIX_LOGIN_PATH', '/login'),
        'matrixRegisterPath': env('PICEUS_MATRIX_REGISTER_PATH', '/register'),
        'matrixForgotPasswordPath': env(
            'PICEUS_MATRIX_FORGOT_PASSWORD_PATH',
            '/forgot-password',
        ),
        'vercelProject': {
            'scope': env('PICEUS_EXPECTED_VERCEL_SCOPE', 'buzz-corp'),
            'projectName': env('PICEUS_EXPECTED_VERCEL_PROJECT', 'piceus'),
            'primaryDomain': env('PICEUS_PRIMARY_DOMAIN', 'www.piceus.com'),
            'secondaryDomain': env('PICEUS_SECONDARY_DOMAIN', 'piceus.com'),
        },
        'integrationStatus': (
            'PICEUS is wired to the existing MATRIX auth and content '
            'surface through FastAPI proxy endpoints and is intended '
            'for the BuzzCorp www.piceus.com Vercel project.'
        ),
    }


@app.post('/api/matrix/auth/login')
async def matrix_login(incoming: Request) -> dict:
    payload = await incoming.json()
    return forward_json('POST', '/api/auth/login', payload=payload)


@app.post('/api/matrix/auth/register')
async def matrix_register(incoming: Request) -> dict:
    payload = await incoming.json()
    return forward_json('POST', '/api/auth/register', payload=payload)


@app.post('/api/matrix/auth/refresh')
async def matrix_refresh(incoming: Request) -> dict:
    payload = await incoming.json()
    return forward_json('POST', '/api/auth/refresh', payload=payload)


@app.post('/api/matrix/auth/logout')
def matrix_logout(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    return forward_json('POST', '/api/auth/logout', token=token)


@app.get('/api/matrix/auth/me')
def matrix_me(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    return forward_json('GET', '/api/auth/me', token=token)


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
