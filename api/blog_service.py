from base64 import b64decode
from binascii import Error as BinasciiError
from collections.abc import Callable
from urllib.parse import unquote

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response

from .blob_storage import download_private_blob, upload_private_blob
from .blog_store import BlogStore
from .link_preview import fetch_link_preview


ActorResolver = Callable[[str | None], dict]


def create_blog_router(resolve_actor: ActorResolver) -> APIRouter:
    router = APIRouter(prefix='/api/blog', tags=['blog'])
    store = BlogStore()

    def actor_from_header(authorization: str | None) -> dict:
        actor = resolve_actor(authorization)
        if not isinstance(actor, dict):
            return {
                'authenticated': False,
                'name': 'Guest Reader',
                'role': 'Public',
                'capabilities': {
                    'canAccessMembersOnly': False,
                    'canManagePosts': False,
                },
            }
        capabilities = (
            actor.get('capabilities')
            if isinstance(actor.get('capabilities'), dict)
            else {}
        )
        return {
            'authenticated': bool(actor.get('authenticated')),
            'name': actor.get('name') or 'Guest Reader',
            'role': actor.get('role') or 'Public',
            'capabilities': {
                'canAccessMembersOnly': bool(
                    capabilities.get('canAccessMembersOnly')
                ),
                'canManagePosts': bool(capabilities.get('canManagePosts')),
            },
        }

    def require_editor_actor(authorization: str | None) -> dict:
        actor = actor_from_header(authorization)
        if not actor['authenticated']:
            raise HTTPException(
                status_code=401,
                detail='Authentication required.',
            )
        if not actor['capabilities']['canManagePosts']:
            raise HTTPException(
                status_code=403,
                detail='Editorial access required.',
            )
        return actor

    def actor_can_view_members_only(actor: dict) -> bool:
        return bool(actor['capabilities']['canAccessMembersOnly'])

    def actor_can_view_drafts(actor: dict) -> bool:
        return bool(actor['capabilities']['canManagePosts'])

    def require_member_actor(authorization: str | None) -> dict:
        actor = actor_from_header(authorization)
        if not actor['authenticated']:
            raise HTTPException(
                status_code=401,
                detail='Authentication required.',
            )
        if not actor_can_view_members_only(actor):
            raise HTTPException(
                status_code=403,
                detail='Member access required to interact.',
            )
        return actor

    def require_visible_post(post_id: str, actor: dict) -> dict:
        post = store.get_post(post_id)
        if not post:
            raise HTTPException(status_code=404, detail='Post not found.')
        if post.get('deletedAt') and not actor_can_view_drafts(actor):
            raise HTTPException(status_code=404, detail='Post not found.')
        if (
            post.get('status') != 'published'
            and not actor_can_view_drafts(actor)
        ):
            raise HTTPException(status_code=404, detail='Post not found.')
        if post.get('membersOnly') and not actor_can_view_members_only(actor):
            raise HTTPException(
                status_code=403,
                detail='Members-only access required.',
            )
        return post

    @router.get('/health')
    def blog_health() -> dict:
        return {'ok': True, 'service': 'piceus-blog'}

    @router.get('/viewer')
    def blog_viewer(authorization: str | None = Header(default=None)) -> dict:
        actor = actor_from_header(authorization)
        return {
            'viewer': actor,
            'service': 'piceus-blog',
            'audiences': ['public', 'members', 'private'],
        }

    @router.get('/feed')
    def blog_feed(
        authorization: str | None = Header(default=None),
        limit: int = Query(default=12),
    ) -> dict:
        actor = actor_from_header(authorization)
        items = store.list_feed_items(
            include_members_only=actor_can_view_members_only(actor),
            limit=max(1, min(limit, 50)),
        )
        return {
            'items': items,
            'viewer': actor,
            'service': 'piceus-blog',
        }

    @router.get('/dashboard')
    def blog_dashboard(
        authorization: str | None = Header(default=None),
        post_id: str | None = Query(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        return {
            'viewer': actor,
            'service': 'piceus-blog',
            'dashboard': store.get_dashboard(post_id=post_id),
        }

    @router.get('/link-preview')
    def blog_link_preview(url: str = Query(..., min_length=8)) -> dict:
        cached = store.get_link_preview(url)
        if cached:
            return {'item': cached}
        try:
            preview = fetch_link_preview(url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail='Unable to fetch link preview.',
            ) from exc
        saved = store.save_link_preview(url, preview)
        return {'item': saved}

    @router.get('/posts')
    def list_blog_posts(
        authorization: str | None = Header(default=None),
        include_drafts: bool = Query(default=False),
        q: str = Query(default=''),
        title: str = Query(default=''),
        author: str = Query(default=''),
        status: str = Query(default=''),
        audience: str = Query(default=''),
        category: str = Query(default=''),
        tag: str = Query(default=''),
        date_from: str = Query(default=''),
        date_to: str = Query(default=''),
        include_deleted: bool = Query(default=False),
    ) -> dict:
        actor = actor_from_header(authorization)
        posts = store.list_posts(
            include_drafts=include_drafts and actor_can_view_drafts(actor),
            include_members_only=actor_can_view_members_only(actor),
            include_deleted=include_deleted and actor_can_view_drafts(actor),
            filters={
                'q': q,
                'title': title,
                'author': author,
                'status': status,
                'audience': audience,
                'category': category,
                'tag': tag,
                'date_from': date_from,
                'date_to': date_to,
            },
        )
        return {
            'items': posts,
            'viewer': actor,
            'service': 'piceus-blog',
        }

    @router.get('/posts/{slug_or_id}')
    def get_blog_post(
        slug_or_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = actor_from_header(authorization)
        post = store.get_post(slug_or_id)
        if not post:
            raise HTTPException(status_code=404, detail='Post not found.')
        if post.get('deletedAt') and not actor_can_view_drafts(actor):
            raise HTTPException(status_code=404, detail='Post not found.')
        if (
            post.get('status') != 'published'
            and not actor_can_view_drafts(actor)
        ):
            raise HTTPException(status_code=404, detail='Post not found.')
        if post.get('membersOnly') and not actor_can_view_members_only(actor):
            post['blocks'] = []
            post['locked'] = True
        else:
            post['locked'] = False
        return {
            'item': post,
            'viewer': actor,
        }

    @router.get('/posts/{post_id}/history')
    def get_blog_post_history(
        post_id: str,
        authorization: str | None = Header(default=None),
        limit: int = Query(default=20),
    ) -> dict:
        actor = require_editor_actor(authorization)
        revisions = store.list_revisions(
            post_id,
            limit=max(1, min(limit, 100)),
        )
        return {
            'items': revisions,
            'viewer': actor,
        }

    @router.post('/posts')
    async def create_blog_post(
        incoming: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        payload = await incoming.json()
        title = str(payload.get('title', '')).strip()
        if len(title) < 3:
            raise HTTPException(
                status_code=400,
                detail='Title must be at least 3 characters.',
            )
        saved = store.save_post(payload, actor['name'], actor['role'])
        store.record_event(saved['id'], 'create', actor, {
            'title': saved.get('title', ''),
            'status': saved.get('status', ''),
            'membersOnly': bool(saved.get('membersOnly')),
            'attachmentCount': len(saved.get('attachments', [])),
        })
        return {'item': saved}

    @router.put('/posts/{post_id}')
    async def update_blog_post(
        post_id: str,
        incoming: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        existing = store.get_post(post_id)
        payload = await incoming.json()
        payload['id'] = post_id
        saved = store.save_post(payload, actor['name'], actor['role'])
        store.record_event(saved['id'], 'update', actor, {
            'title': saved.get('title', ''),
            'status': saved.get('status', ''),
            'membersOnly': bool(saved.get('membersOnly')),
            'attachmentCount': len(saved.get('attachments', [])),
            'audienceChanged': bool(
                existing
                and (
                    existing.get('status') != saved.get('status')
                    or bool(existing.get('membersOnly'))
                    != bool(saved.get('membersOnly'))
                )
            ),
        })
        return {'item': saved}

    @router.delete('/posts/{post_id}')
    def delete_blog_post(
        post_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        archived = store.archive_post(post_id, actor['name'], actor['role'])
        if not archived:
            raise HTTPException(status_code=404, detail='Post not found.')
        store.record_event(post_id, 'archive', actor, {
            'title': archived.get('title', ''),
            'status': archived.get('status', ''),
        })
        return {'ok': True}

    @router.post('/posts/{post_id}/restore')
    def restore_blog_post(
        post_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        restored = store.restore_post(post_id, actor['name'], actor['role'])
        if not restored:
            raise HTTPException(status_code=404, detail='Post not found.')
        store.record_event(post_id, 'restore', actor, {
            'title': restored.get('title', ''),
            'status': restored.get('status', ''),
        })
        return {'item': restored}

    @router.post('/uploads')
    async def upload_blog_attachment(
        incoming: Request,
        filename: str = Query(..., min_length=1),
        content_type: str = Query(default='application/octet-stream'),
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_editor_actor(authorization)
        body = await incoming.body()
        if not body:
            raise HTTPException(status_code=400, detail='Attachment body is empty.')
        safe_name = unquote(filename).split('/')[-1].strip()
        if not safe_name:
            raise HTTPException(status_code=400, detail='Filename is required.')
        try:
            blob = await upload_private_blob(
                f'thinktank/attachments/{safe_name}',
                body,
                content_type,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {
            'item': {
                'kind': 'historical-data',
                'storageKind': 'blob',
                'fileName': safe_name,
                'mimeType': content_type,
                'sizeBytes': len(body),
                'blobUrl': blob.get('url', ''),
                'blobDownloadUrl': blob.get('downloadUrl', ''),
                'blobPath': blob.get('pathname', ''),
                'contentData': '',
            }
        }

    @router.get('/posts/{post_id}/attachments/{attachment_id}')
    async def download_blog_attachment(
        post_id: str,
        attachment_id: str,
        authorization: str | None = Header(default=None),
    ) -> Response:
        actor = actor_from_header(authorization)
        post = require_visible_post(post_id, actor)
        attachment = store.get_attachment(post['id'], attachment_id)
        if not attachment:
            raise HTTPException(status_code=404, detail='Attachment not found.')
        try:
            if attachment.get('storageKind') == 'blob':
                payload, metadata = await download_private_blob(
                    attachment.get('blobPath') or attachment.get('blobUrl')
                )
                media_type = (
                    metadata.get('content_type')
                    or attachment.get('mimeType')
                    or 'application/octet-stream'
                )
            else:
                content_data = str(attachment.get('contentData', ''))
                if ',' not in content_data:
                    raise ValueError('Attachment data is invalid.')
                header, encoded = content_data.split(',', 1)
                media_type = (
                    attachment.get('mimeType') or 'application/octet-stream'
                )
                if ';base64' in header:
                    payload = b64decode(encoded)
                else:
                    payload = encoded.encode('utf-8')
        except (RuntimeError, FileNotFoundError, ValueError, BinasciiError) as exc:
            raise HTTPException(
                status_code=404,
                detail='Attachment could not be read.',
            ) from exc

        return Response(
            content=payload,
            media_type=media_type,
            headers={
                'Content-Disposition': (
                    f'attachment; filename="{attachment.get("fileName", "attachment")}"'
                ),
            },
        )

    @router.post('/posts/{post_id}/engagement')
    async def update_engagement(
        post_id: str,
        incoming: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = actor_from_header(authorization)
        require_visible_post(post_id, actor)
        payload = await incoming.json()
        context = (
            payload.get('context')
            if isinstance(payload.get('context'), dict)
            else {}
        )
        action = str(payload.get('action', '')).strip().lower()
        if action != 'view':
            actor = require_member_actor(authorization)
        try:
            saved = store.record_engagement(post_id, action)
            store.record_event(post_id, action, actor, context)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail='Post not found.',
            ) from exc
        return {'item': saved}

    @router.post('/posts/{post_id}/comments')
    async def create_comment(
        post_id: str,
        incoming: Request,
        authorization: str | None = Header(default=None),
    ) -> dict:
        actor = require_member_actor(authorization)
        require_visible_post(post_id, actor)
        payload = await incoming.json()
        context = (
            payload.get('context')
            if isinstance(payload.get('context'), dict)
            else {}
        )
        author_name = (
            str(payload.get('authorName', '')).strip() or actor['name']
        )
        body = str(payload.get('body', '')).strip()
        if len(body) < 3:
            raise HTTPException(
                status_code=400,
                detail='Comment must be at least 3 characters.',
            )
        try:
            comment = store.add_comment(post_id, author_name, body)
            saved = store.record_engagement(post_id, 'view')
            store.record_event(post_id, 'comment', actor, context)
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail='Post not found.',
            ) from exc
        return {'comment': comment, 'item': saved}

    return router
