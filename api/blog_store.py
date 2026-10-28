import asyncio
import json
import os
import re
import sqlite3
from threading import Lock
from threading import Thread
from time import time
from urllib.parse import urlparse
from uuid import uuid4

from .blob_storage import blob_storage_enabled, download_private_json, upload_private_json


def _storage_path() -> str:
    configured = os.getenv('PICEUS_BLOG_STORAGE_PATH', '').strip()
    if configured:
        return configured
    if os.getenv('VERCEL'):
        return '/tmp/piceus_blog.sqlite3'
    return os.path.join(os.path.dirname(__file__), 'blog_store.sqlite3')


def _snapshot_blob_path() -> str:
    scope = (
        os.getenv('PICEUS_SNAPSHOT_SCOPE', '').strip()
        or os.getenv('VERCEL_ENV', '').strip()
        or ('production' if os.getenv('VERCEL') else 'local')
    )
    return f'thinktank/state/{scope}/blog-store-snapshot.json'


def _legacy_json_path() -> str:
    configured = os.getenv('PICEUS_BLOG_LEGACY_JSON_PATH', '').strip()
    if configured:
        return configured
    return os.path.join(os.path.dirname(__file__), 'blog_store.json')


def _timestamp() -> str:
    return str(int(time()))


def _run_async_blocking(async_callable, *args, **kwargs):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(async_callable(*args, **kwargs))

    result: dict[str, object] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result['value'] = asyncio.run(async_callable(*args, **kwargs))
        except BaseException as exc:
            error['value'] = exc

    thread = Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if 'value' in error:
        raise error['value']
    return result.get('value')


def _slugify(value: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    return slug or f'post-{uuid4().hex[:8]}'


def _normalize_filters(filters: dict | None) -> dict:
    normalized = filters if isinstance(filters, dict) else {}
    return {
        'q': str(normalized.get('q', '')).strip(),
        'title': str(normalized.get('title', '')).strip(),
        'author': str(normalized.get('author', '')).strip(),
        'status': str(normalized.get('status', '')).strip().lower(),
        'audience': str(normalized.get('audience', '')).strip().lower(),
        'category': str(normalized.get('category', '')).strip(),
        'tag': str(normalized.get('tag', '')).strip(),
        'date_from': str(normalized.get('date_from', '')).strip(),
        'date_to': str(normalized.get('date_to', '')).strip(),
    }


def _date_filter_to_timestamp(value: str, *, end_of_day: bool) -> str:
    if not value:
        return ''
    if re.fullmatch(r'\d{10,}', value):
        return value[:10]
    match = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', value)
    if not match:
        return ''

    year, month, day = [int(part) for part in match.groups()]

    from datetime import datetime, timezone

    dt = datetime(
        year,
        month,
        day,
        23 if end_of_day else 0,
        59 if end_of_day else 0,
        59 if end_of_day else 0,
        tzinfo=timezone.utc,
    )
    return str(int(dt.timestamp()))


def _safe_json_loads(value: str) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _host_from_url(value: str) -> str:
    if not value:
        return ''
    try:
        return urlparse(value).netloc.lower()
    except ValueError:
        return ''


DEFAULT_STATE = {
    'posts': [
        {
            'id': 'members-only-editorial-roadmap',
            'slug': 'members-only-editorial-roadmap',
            'title': 'Members-Only Editorial Roadmap',
            'excerpt': 'A private draft for how memberships, editorial workflows, and think-tank engagement can become their own product surface.',
            'authorName': 'PICEUS Labs',
            'authorRole': 'Editorial Admin',
            'status': 'draft',
            'membersOnly': True,
            'category': 'Roadmap',
            'tags': ['Members', 'Editorial', 'Roadmap'],
            'coverImage': '',
            'coverVideo': '',
            'createdAt': '1791530200',
            'updatedAt': '1791530200',
            'publishedAt': '',
            'blocks': [
                {
                    'type': 'paragraph',
                    'content': 'This private draft maps how membership, community, publishing, and revenue systems can be unified into one operating surface.',
                },
            ],
            'engagement': {
                'likes': 0,
                'shares': 0,
                'views': 0,
            },
            'comments': [],
        },
    ],
}


class BlogStore:
    def __init__(self, path: str | None = None):
        self.path = path or _storage_path()
        self.lock = Lock()
        self._ensure_store()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _ensure_store(self) -> None:
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with self.lock:
            with self._connect() as connection:
                connection.execute('PRAGMA foreign_keys = ON')
                connection.executescript(
                    '''
                    CREATE TABLE IF NOT EXISTS posts (
                        id TEXT PRIMARY KEY,
                        slug TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL,
                        excerpt TEXT NOT NULL DEFAULT '',
                        category TEXT NOT NULL DEFAULT '',
                        author_name TEXT NOT NULL DEFAULT '',
                        author_role TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'draft',
                        members_only INTEGER NOT NULL DEFAULT 0,
                        cover_image TEXT NOT NULL DEFAULT '',
                        cover_video TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        published_at TEXT NOT NULL DEFAULT '',
                        deleted_at TEXT NOT NULL DEFAULT '',
                        search_text TEXT NOT NULL DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS post_tags (
                        post_id TEXT NOT NULL,
                        tag TEXT NOT NULL,
                        position INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (post_id, tag),
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS post_blocks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        post_id TEXT NOT NULL,
                        position INTEGER NOT NULL DEFAULT 0,
                        type TEXT NOT NULL,
                        content TEXT NOT NULL DEFAULT '',
                        url TEXT NOT NULL DEFAULT '',
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS post_attachments (
                        id TEXT PRIMARY KEY,
                        post_id TEXT NOT NULL,
                        position INTEGER NOT NULL DEFAULT 0,
                        kind TEXT NOT NULL DEFAULT 'historical-data',
                        storage_kind TEXT NOT NULL DEFAULT 'inline',
                        file_name TEXT NOT NULL DEFAULT '',
                        mime_type TEXT NOT NULL DEFAULT '',
                        size_bytes INTEGER NOT NULL DEFAULT 0,
                        blob_url TEXT NOT NULL DEFAULT '',
                        blob_download_url TEXT NOT NULL DEFAULT '',
                        blob_path TEXT NOT NULL DEFAULT '',
                        content_data TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS engagement (
                        post_id TEXT PRIMARY KEY,
                        likes INTEGER NOT NULL DEFAULT 0,
                        shares INTEGER NOT NULL DEFAULT 0,
                        views INTEGER NOT NULL DEFAULT 0,
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS comments (
                        id TEXT PRIMARY KEY,
                        post_id TEXT NOT NULL,
                        author_name TEXT NOT NULL,
                        body TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS post_revisions (
                        id TEXT PRIMARY KEY,
                        post_id TEXT NOT NULL,
                        actor_name TEXT NOT NULL,
                        actor_role TEXT NOT NULL,
                        revision_at TEXT NOT NULL,
                        snapshot_json TEXT NOT NULL,
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS analytics_events (
                        id TEXT PRIMARY KEY,
                        post_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        viewer_name TEXT NOT NULL DEFAULT '',
                        viewer_role TEXT NOT NULL DEFAULT '',
                        authenticated INTEGER NOT NULL DEFAULT 0,
                        viewer_member INTEGER NOT NULL DEFAULT 0,
                        referrer TEXT NOT NULL DEFAULT '',
                        origin TEXT NOT NULL DEFAULT '',
                        current_url TEXT NOT NULL DEFAULT '',
                        source_host TEXT NOT NULL DEFAULT '',
                        utm_source TEXT NOT NULL DEFAULT '',
                        utm_medium TEXT NOT NULL DEFAULT '',
                        utm_campaign TEXT NOT NULL DEFAULT '',
                        locale TEXT NOT NULL DEFAULT '',
                        timezone TEXT NOT NULL DEFAULT '',
                        device_type TEXT NOT NULL DEFAULT '',
                        browser TEXT NOT NULL DEFAULT '',
                        os TEXT NOT NULL DEFAULT '',
                        metadata_json TEXT NOT NULL DEFAULT '{}',
                        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS link_previews (
                        url TEXT PRIMARY KEY,
                        kind TEXT NOT NULL DEFAULT 'link',
                        provider TEXT NOT NULL DEFAULT '',
                        title TEXT NOT NULL DEFAULT '',
                        description TEXT NOT NULL DEFAULT '',
                        image_url TEXT NOT NULL DEFAULT '',
                        site_name TEXT NOT NULL DEFAULT '',
                        author_name TEXT NOT NULL DEFAULT '',
                        published_at TEXT NOT NULL DEFAULT '',
                        embed_url TEXT NOT NULL DEFAULT '',
                        metadata_json TEXT NOT NULL DEFAULT '{}',
                        fetched_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
                    CREATE INDEX IF NOT EXISTS idx_posts_author_name ON posts(author_name);
                    CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
                    CREATE INDEX IF NOT EXISTS idx_posts_updated_at ON posts(updated_at);
                    CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);
                    CREATE INDEX IF NOT EXISTS idx_post_attachments_post_id ON post_attachments(post_id, position ASC);
                    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
                    CREATE INDEX IF NOT EXISTS idx_post_revisions_post_id ON post_revisions(post_id, revision_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_analytics_post_id ON analytics_events(post_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
                    CREATE INDEX IF NOT EXISTS idx_analytics_source_host ON analytics_events(source_host);
                    '''
                )
                columns = {
                    row['name']
                    for row in connection.execute(
                        'PRAGMA table_info(posts)'
                    ).fetchall()
                }
                if 'category' not in columns:
                    connection.execute(
                        "ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT ''"
                    )
                if 'deleted_at' not in columns:
                    connection.execute(
                        "ALTER TABLE posts ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''"
                    )
                attachment_columns = {
                    row['name']
                    for row in connection.execute(
                        'PRAGMA table_info(post_attachments)'
                    ).fetchall()
                }
                if 'storage_kind' not in attachment_columns:
                    connection.execute(
                        "ALTER TABLE post_attachments ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'inline'"
                    )
                if 'blob_url' not in attachment_columns:
                    connection.execute(
                        "ALTER TABLE post_attachments ADD COLUMN blob_url TEXT NOT NULL DEFAULT ''"
                    )
                if 'blob_download_url' not in attachment_columns:
                    connection.execute(
                        "ALTER TABLE post_attachments ADD COLUMN blob_download_url TEXT NOT NULL DEFAULT ''"
                    )
                if 'blob_path' not in attachment_columns:
                    connection.execute(
                        "ALTER TABLE post_attachments ADD COLUMN blob_path TEXT NOT NULL DEFAULT ''"
                    )
                post_count = connection.execute('SELECT COUNT(*) FROM posts').fetchone()[0]
                if post_count == 0:
                    state = self._load_bootstrap_state()
                    self._import_state(connection, state)
                connection.commit()

    def _load_bootstrap_state(self) -> dict:
        if blob_storage_enabled():
            try:
                snapshot = _run_async_blocking(download_private_json, _snapshot_blob_path())
                if isinstance(snapshot, dict):
                    return snapshot
            except Exception:
                pass
        legacy_path = _legacy_json_path()
        if os.path.exists(legacy_path):
            try:
                with open(legacy_path, 'r', encoding='utf-8') as handle:
                    return json.load(handle)
            except (OSError, json.JSONDecodeError):
                return DEFAULT_STATE
        return DEFAULT_STATE

    def _import_state(self, connection: sqlite3.Connection, state: dict) -> None:
        posts = state.get('posts') if isinstance(state, dict) else []
        if not isinstance(posts, list):
            posts = []
        for post in posts:
            self._upsert_post(
                connection,
                post,
                post.get('authorName', ''),
                post.get('authorRole', ''),
                record_revision=True,
            )
            for comment in post.get('comments', []):
                connection.execute(
                    'INSERT OR IGNORE INTO comments (id, post_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    (
                        comment.get('id') or f'comment-{uuid4().hex[:10]}',
                        post.get('id'),
                        comment.get('authorName', 'Guest'),
                        comment.get('body', ''),
                        comment.get('createdAt', post.get('createdAt', _timestamp())),
                    ),
                )
            engagement = post.get('engagement', {})
            connection.execute(
                'INSERT OR REPLACE INTO engagement (post_id, likes, shares, views) VALUES (?, ?, ?, ?)',
                (
                    post.get('id'),
                    int(engagement.get('likes', 0)),
                    int(engagement.get('shares', 0)),
                    int(engagement.get('views', 0)),
                ),
            )
        for revision in state.get('revisions', []) if isinstance(state, dict) else []:
            if not isinstance(revision, dict):
                continue
            connection.execute(
                'INSERT OR IGNORE INTO post_revisions (id, post_id, actor_name, actor_role, revision_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)',
                (
                    revision.get('id') or f'rev-{uuid4().hex[:12]}',
                    revision.get('postId', ''),
                    revision.get('actorName', 'System'),
                    revision.get('actorRole', 'System'),
                    revision.get('revisionAt', _timestamp()),
                    json.dumps(revision.get('snapshot', {})),
                ),
            )
        for event in state.get('analyticsEvents', []) if isinstance(state, dict) else []:
            if not isinstance(event, dict):
                continue
            connection.execute(
                'INSERT OR IGNORE INTO analytics_events (id, post_id, event_type, created_at, viewer_name, viewer_role, authenticated, viewer_member, referrer, origin, current_url, source_host, utm_source, utm_medium, utm_campaign, locale, timezone, device_type, browser, os, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    event.get('id') or f'evt-{uuid4().hex[:14]}',
                    event.get('postId', ''),
                    event.get('eventType', 'view'),
                    event.get('createdAt', _timestamp()),
                    event.get('viewerName', ''),
                    event.get('viewerRole', ''),
                    1 if event.get('authenticated') else 0,
                    1 if event.get('viewerMember') else 0,
                    event.get('referrer', ''),
                    event.get('origin', ''),
                    event.get('currentUrl', ''),
                    event.get('sourceHost', ''),
                    event.get('utmSource', ''),
                    event.get('utmMedium', ''),
                    event.get('utmCampaign', ''),
                    event.get('locale', ''),
                    event.get('timezone', ''),
                    event.get('deviceType', ''),
                    event.get('browser', ''),
                    event.get('os', ''),
                    json.dumps(event.get('metadata', {})),
                ),
            )

    def _export_state(self, connection: sqlite3.Connection) -> dict:
        posts = [
            self._hydrate_post(connection, row)
            for row in connection.execute(
                'SELECT * FROM posts ORDER BY created_at ASC, title ASC'
            ).fetchall()
        ]
        revisions = [
            {
                'id': row['id'],
                'postId': row['post_id'],
                'actorName': row['actor_name'],
                'actorRole': row['actor_role'],
                'revisionAt': row['revision_at'],
                'snapshot': _safe_json_loads(row['snapshot_json']),
            }
            for row in connection.execute(
                'SELECT id, post_id, actor_name, actor_role, revision_at, snapshot_json FROM post_revisions ORDER BY revision_at ASC'
            ).fetchall()
        ]
        analytics_events = [
            {
                'id': row['id'],
                'postId': row['post_id'],
                'eventType': row['event_type'],
                'createdAt': row['created_at'],
                'viewerName': row['viewer_name'],
                'viewerRole': row['viewer_role'],
                'authenticated': bool(row['authenticated']),
                'viewerMember': bool(row['viewer_member']),
                'referrer': row['referrer'],
                'origin': row['origin'],
                'currentUrl': row['current_url'],
                'sourceHost': row['source_host'],
                'utmSource': row['utm_source'],
                'utmMedium': row['utm_medium'],
                'utmCampaign': row['utm_campaign'],
                'locale': row['locale'],
                'timezone': row['timezone'],
                'deviceType': row['device_type'],
                'browser': row['browser'],
                'os': row['os'],
                'metadata': _safe_json_loads(row['metadata_json']),
            }
            for row in connection.execute(
                'SELECT * FROM analytics_events ORDER BY created_at ASC'
            ).fetchall()
        ]
        return {
            'posts': posts,
            'revisions': revisions,
            'analyticsEvents': analytics_events,
        }

    def _persist_snapshot(self, connection: sqlite3.Connection) -> None:
        if not blob_storage_enabled():
            return
        try:
            _run_async_blocking(
                upload_private_json,
                _snapshot_blob_path(),
                self._export_state(connection),
            )
        except Exception:
            return

    def _build_search_text(self, normalized: dict) -> str:
        block_text = []
        for block in normalized.get('blocks', []):
            if not isinstance(block, dict):
                continue
            if str(block.get('content', '')).strip():
                block_text.append(str(block.get('content', '')).strip())
            if block.get('title'):
                block_text.append(str(block.get('title')).strip())
            if block.get('description'):
                block_text.append(str(block.get('description')).strip())
        attachment_text = []
        for attachment in normalized.get('attachments', []):
            if not isinstance(attachment, dict):
                continue
            if str(attachment.get('fileName', '')).strip():
                attachment_text.append(str(attachment.get('fileName', '')).strip())
            if str(attachment.get('kind', '')).strip():
                attachment_text.append(str(attachment.get('kind', '')).strip())
        parts = [
            normalized.get('title', ''),
            normalized.get('excerpt', ''),
            normalized.get('category', ''),
            normalized.get('authorName', ''),
            normalized.get('authorRole', ''),
            ' '.join(normalized.get('tags', [])),
            ' '.join(block_text),
            ' '.join(attachment_text),
        ]
        return ' '.join(part for part in parts if part).strip().lower()

    def _resolve_unique_slug(
        self,
        connection: sqlite3.Connection,
        desired_slug: str,
        current_post_id: str = '',
    ) -> str:
        base_slug = _slugify(desired_slug)
        slug = base_slug
        suffix = 2
        while True:
            row = connection.execute(
                'SELECT id FROM posts WHERE slug = ? LIMIT 1',
                (slug,),
            ).fetchone()
            if not row or row['id'] == current_post_id:
                return slug
            slug = f'{base_slug}-{suffix}'
            suffix += 1

    def _normalize_post(
        self,
        payload: dict,
        actor_name: str,
        actor_role: str,
        existing: dict | None = None,
    ) -> dict:
        existing = existing or {}
        now = _timestamp()
        payload_id = str(payload.get('id', '')).strip()
        title = str(payload.get('title', '')).strip()
        slug = _slugify(str(payload.get('slug', '')).strip() or title)
        blocks = payload.get('blocks') if isinstance(payload.get('blocks'), list) else []
        tags = payload.get('tags') if isinstance(payload.get('tags'), list) else []
        attachments = (
            payload.get('attachments')
            if isinstance(payload.get('attachments'), list)
            else []
        )
        members_only = bool(payload.get('membersOnly'))
        status = 'published' if payload.get('status') == 'published' else 'draft'
        normalized_blocks = []
        normalized_attachments = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get('type', '')).strip() or 'paragraph'
            content = block.get('content', '')
            url = str(block.get('url', '')).strip()
            normalized = {'type': block_type, 'url': url}
            if block_type in {'link-preview', 'video-embed'}:
                preview = {
                    key: value
                    for key, value in block.items()
                    if key not in {'type'} and value not in (None, '')
                }
                normalized['content'] = json.dumps(preview)
            else:
                normalized['content'] = str(content).strip()
            if not normalized['content'] and not normalized['url']:
                continue
            normalized_blocks.append(normalized)

        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            file_name = str(attachment.get('fileName', '')).strip()
            content_data = str(attachment.get('contentData', '')).strip()
            blob_url = str(attachment.get('blobUrl', '')).strip()
            blob_download_url = str(
                attachment.get('blobDownloadUrl', '')
            ).strip()
            blob_path = str(attachment.get('blobPath', '')).strip()
            storage_kind = str(attachment.get('storageKind', '')).strip() or 'inline'
            if not file_name or (not content_data and not blob_url and not blob_path):
                continue
            normalized_attachments.append(
                {
                    'id': str(attachment.get('id', '')).strip() or f'asset-{uuid4().hex[:12]}',
                    'kind': str(attachment.get('kind', '')).strip() or 'historical-data',
                    'storageKind': storage_kind,
                    'fileName': file_name,
                    'mimeType': str(attachment.get('mimeType', '')).strip(),
                    'sizeBytes': int(attachment.get('sizeBytes', 0) or 0),
                    'blobUrl': blob_url,
                    'blobDownloadUrl': blob_download_url,
                    'blobPath': blob_path,
                    'contentData': content_data,
                    'createdAt': str(attachment.get('createdAt', '')).strip() or now,
                }
            )

        normalized_post = {
            'id': existing.get('id') or payload_id or f'post-{uuid4().hex[:12]}',
            'slug': slug,
            'title': title,
            'excerpt': str(payload.get('excerpt', '')).strip(),
            'category': str(payload.get('category', '')).strip(),
            'authorName': str(payload.get('authorName', '')).strip() or actor_name,
            'authorRole': str(payload.get('authorRole', '')).strip() or actor_role,
            'status': status,
            'membersOnly': members_only,
            'tags': [str(tag).strip() for tag in tags if str(tag).strip()],
            'coverImage': str(payload.get('coverImage', '')).strip(),
            'coverVideo': str(payload.get('coverVideo', '')).strip(),
            'createdAt': existing.get('createdAt') or now,
            'updatedAt': now,
            'publishedAt': existing.get('publishedAt') or (now if status == 'published' else ''),
            'deletedAt': existing.get('deletedAt', ''),
            'blocks': normalized_blocks,
            'attachments': normalized_attachments,
            'engagement': existing.get('engagement') or {'likes': 0, 'shares': 0, 'views': 0},
            'comments': existing.get('comments') or [],
        }
        if status != 'published':
            normalized_post['publishedAt'] = existing.get('publishedAt', '') if existing else ''
        elif not normalized_post['publishedAt']:
            normalized_post['publishedAt'] = now
        return normalized_post

    def _decode_block(self, block_row: sqlite3.Row) -> dict:
        block = {'type': block_row['type']}
        if block_row['url']:
            block['url'] = block_row['url']
        if block_row['content']:
            if block_row['type'] in {'link-preview', 'video-embed'}:
                preview = _safe_json_loads(block_row['content'])
                if preview:
                    block.update(preview)
                    block.setdefault('url', preview.get('url', block.get('url', '')))
                else:
                    block['content'] = block_row['content']
            else:
                block['content'] = block_row['content']
        return block

    def _hydrate_post(self, connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
        post_id = row['id']
        tags = [
            tag_row['tag']
            for tag_row in connection.execute(
                'SELECT tag FROM post_tags WHERE post_id = ? ORDER BY position ASC',
                (post_id,),
            ).fetchall()
        ]
        blocks = [
            self._decode_block(block_row)
            for block_row in connection.execute(
                'SELECT type, content, url FROM post_blocks WHERE post_id = ? ORDER BY position ASC, id ASC',
                (post_id,),
            ).fetchall()
        ]
        engagement_row = connection.execute(
            'SELECT likes, shares, views FROM engagement WHERE post_id = ?',
            (post_id,),
        ).fetchone()
        comments = [
            {
                'id': comment_row['id'],
                'authorName': comment_row['author_name'],
                'body': comment_row['body'],
                'createdAt': comment_row['created_at'],
            }
            for comment_row in connection.execute(
                'SELECT id, author_name, body, created_at FROM comments WHERE post_id = ? ORDER BY created_at ASC',
                (post_id,),
            ).fetchall()
        ]
        attachments = [
            {
                'id': asset_row['id'],
                'kind': asset_row['kind'],
                'storageKind': asset_row['storage_kind'],
                'fileName': asset_row['file_name'],
                'mimeType': asset_row['mime_type'],
                'sizeBytes': int(asset_row['size_bytes']),
                'blobUrl': asset_row['blob_url'],
                'blobDownloadUrl': asset_row['blob_download_url'],
                'blobPath': asset_row['blob_path'],
                'contentData': asset_row['content_data'],
                'createdAt': asset_row['created_at'],
            }
            for asset_row in connection.execute(
                'SELECT id, kind, storage_kind, file_name, mime_type, size_bytes, blob_url, blob_download_url, blob_path, content_data, created_at FROM post_attachments WHERE post_id = ? ORDER BY position ASC, created_at ASC',
                (post_id,),
            ).fetchall()
        ]
        return {
            'id': row['id'],
            'slug': row['slug'],
            'title': row['title'],
            'excerpt': row['excerpt'],
            'category': row['category'] if 'category' in row.keys() else '',
            'authorName': row['author_name'],
            'authorRole': row['author_role'],
            'status': row['status'],
            'membersOnly': bool(row['members_only']),
            'tags': tags,
            'coverImage': row['cover_image'],
            'coverVideo': row['cover_video'],
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'publishedAt': row['published_at'],
            'deletedAt': row['deleted_at'] if 'deleted_at' in row.keys() else '',
            'blocks': blocks,
            'attachments': attachments,
            'engagement': {
                'likes': int(engagement_row['likes']) if engagement_row else 0,
                'shares': int(engagement_row['shares']) if engagement_row else 0,
                'views': int(engagement_row['views']) if engagement_row else 0,
            },
            'comments': comments,
        }

    def _get_post_by_id(self, connection: sqlite3.Connection, post_id: str) -> dict | None:
        row = connection.execute(
            'SELECT * FROM posts WHERE id = ?',
            (post_id,),
        ).fetchone()
        if not row:
            return None
        return self._hydrate_post(connection, row)

    def _upsert_post(
        self,
        connection: sqlite3.Connection,
        payload: dict,
        actor_name: str,
        actor_role: str,
        *,
        record_revision: bool,
    ) -> dict:
        post_id = str(payload.get('id', '')).strip()
        existing = self._get_post_by_id(connection, post_id) if post_id else None
        canonical_id = existing.get('id') if existing else post_id or f'post-{uuid4().hex[:12]}'
        desired_slug = str(payload.get('slug', '')).strip() or str(payload.get('title', '')).strip()
        canonical_slug = self._resolve_unique_slug(connection, desired_slug, canonical_id)
        normalized = self._normalize_post(
            {
                **payload,
                'id': canonical_id,
                'slug': canonical_slug,
            },
            actor_name,
            actor_role,
            existing,
        )
        search_text = self._build_search_text(normalized)
        connection.execute(
            '''
            INSERT INTO posts (
                id, slug, title, excerpt, category, author_name, author_role, status,
                members_only, cover_image, cover_video, created_at, updated_at,
                published_at, deleted_at, search_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                slug = excluded.slug,
                title = excluded.title,
                excerpt = excluded.excerpt,
                category = excluded.category,
                author_name = excluded.author_name,
                author_role = excluded.author_role,
                status = excluded.status,
                members_only = excluded.members_only,
                cover_image = excluded.cover_image,
                cover_video = excluded.cover_video,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                published_at = excluded.published_at,
                deleted_at = excluded.deleted_at,
                search_text = excluded.search_text
            ''',
            (
                normalized['id'],
                normalized['slug'],
                normalized['title'],
                normalized['excerpt'],
                normalized['category'],
                normalized['authorName'],
                normalized['authorRole'],
                normalized['status'],
                1 if normalized['membersOnly'] else 0,
                normalized['coverImage'],
                normalized['coverVideo'],
                normalized['createdAt'],
                normalized['updatedAt'],
                normalized['publishedAt'],
                normalized['deletedAt'],
                search_text,
            ),
        )
        connection.execute(
            'DELETE FROM post_tags WHERE post_id = ?',
            (normalized['id'],),
        )
        for position, tag in enumerate(normalized['tags']):
            connection.execute(
                'INSERT INTO post_tags (post_id, tag, position) VALUES (?, ?, ?)',
                (normalized['id'], tag, position),
            )
        connection.execute(
            'DELETE FROM post_blocks WHERE post_id = ?',
            (normalized['id'],),
        )
        for position, block in enumerate(normalized['blocks']):
            connection.execute(
                'INSERT INTO post_blocks (post_id, position, type, content, url) VALUES (?, ?, ?, ?, ?)',
                (
                    normalized['id'],
                    position,
                    block['type'],
                    block.get('content', ''),
                    block.get('url', ''),
                ),
            )
        connection.execute(
            'DELETE FROM post_attachments WHERE post_id = ?',
            (normalized['id'],),
        )
        for position, attachment in enumerate(normalized['attachments']):
            connection.execute(
                'INSERT INTO post_attachments (id, post_id, position, kind, storage_kind, file_name, mime_type, size_bytes, blob_url, blob_download_url, blob_path, content_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    attachment['id'],
                    normalized['id'],
                    position,
                    attachment.get('kind', 'historical-data'),
                    attachment.get('storageKind', 'inline'),
                    attachment.get('fileName', ''),
                    attachment.get('mimeType', ''),
                    int(attachment.get('sizeBytes', 0)),
                    attachment.get('blobUrl', ''),
                    attachment.get('blobDownloadUrl', ''),
                    attachment.get('blobPath', ''),
                    attachment.get('contentData', ''),
                    attachment.get('createdAt', normalized['updatedAt']),
                ),
            )
        connection.execute(
            'INSERT OR IGNORE INTO engagement (post_id, likes, shares, views) VALUES (?, ?, ?, ?)',
            (
                normalized['id'],
                int(normalized['engagement'].get('likes', 0)),
                int(normalized['engagement'].get('shares', 0)),
                int(normalized['engagement'].get('views', 0)),
            ),
        )
        if record_revision:
            snapshot = self._get_post_by_id(connection, normalized['id']) or normalized
            connection.execute(
                'INSERT INTO post_revisions (id, post_id, actor_name, actor_role, revision_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)',
                (
                    f'rev-{uuid4().hex[:12]}',
                    normalized['id'],
                    actor_name,
                    actor_role,
                    normalized['updatedAt'],
                    json.dumps(snapshot),
                ),
            )
        return self._get_post_by_id(connection, normalized['id']) or normalized

    def list_posts(
        self,
        *,
        include_drafts: bool,
        include_members_only: bool,
        include_deleted: bool = False,
        filters: dict | None = None,
    ) -> list[dict]:
        normalized_filters = _normalize_filters(filters)
        query = ['SELECT DISTINCT posts.* FROM posts']
        joins = []
        conditions = []
        params: list[object] = []

        if normalized_filters['tag']:
            joins.append('JOIN post_tags ON post_tags.post_id = posts.id')
            conditions.append('LOWER(post_tags.tag) = LOWER(?)')
            params.append(normalized_filters['tag'])
        if normalized_filters['category']:
            conditions.append('LOWER(posts.category) = LOWER(?)')
            params.append(normalized_filters['category'])
        if not include_deleted:
            conditions.append("COALESCE(posts.deleted_at, '') = ''")
        if not include_drafts:
            conditions.append("posts.status = 'published'")
        if normalized_filters['status'] in {'published', 'draft'}:
            conditions.append('posts.status = ?')
            params.append(normalized_filters['status'])
        if normalized_filters['audience'] == 'public':
            conditions.append('posts.members_only = 0 AND posts.status = ?')
            params.append('published')
        elif normalized_filters['audience'] == 'members':
            conditions.append('posts.members_only = 1')
        elif normalized_filters['audience'] == 'private':
            conditions.append("posts.status = 'draft'")
        if normalized_filters['q']:
            conditions.append('posts.search_text LIKE ?')
            params.append(f"%{normalized_filters['q'].lower()}%")
        if normalized_filters['title']:
            conditions.append('LOWER(posts.title) LIKE ?')
            params.append(f"%{normalized_filters['title'].lower()}%")
        if normalized_filters['author']:
            conditions.append('LOWER(posts.author_name) LIKE ?')
            params.append(f"%{normalized_filters['author'].lower()}%")

        date_from = _date_filter_to_timestamp(
            normalized_filters['date_from'],
            end_of_day=False,
        )
        if date_from:
            conditions.append(
                "COALESCE(NULLIF(posts.published_at, ''), posts.updated_at, posts.created_at) >= ?"
            )
            params.append(date_from)
        date_to = _date_filter_to_timestamp(
            normalized_filters['date_to'],
            end_of_day=True,
        )
        if date_to:
            conditions.append(
                "COALESCE(NULLIF(posts.published_at, ''), posts.updated_at, posts.created_at) <= ?"
            )
            params.append(date_to)

        if joins:
            query.extend(joins)
        if conditions:
            query.append('WHERE ' + ' AND '.join(conditions))
        query.append(
            "ORDER BY COALESCE(NULLIF(posts.published_at, ''), posts.updated_at, posts.created_at) DESC, posts.title DESC"
        )

        with self.lock:
            with self._connect() as connection:
                rows = connection.execute(' '.join(query), params).fetchall()
                visible: list[dict] = []
                for row in rows:
                    post = self._hydrate_post(connection, row)
                    if post.get('membersOnly') and not include_members_only:
                        locked_post = dict(post)
                        locked_post['locked'] = True
                        locked_post['blocks'] = []
                        visible.append(locked_post)
                        continue
                    post['locked'] = False
                    visible.append(post)
                return visible

    def list_feed_items(
        self,
        *,
        include_members_only: bool,
        limit: int = 12,
    ) -> list[dict]:
        posts = self.list_posts(
            include_drafts=False,
            include_members_only=include_members_only,
            filters=None,
        )
        items = []
        for post in posts[:limit]:
            items.append(
                {
                    'id': post['id'],
                    'slug': post['slug'],
                    'type': 'article',
                    'title': post['title'],
                    'excerpt': post['excerpt'],
                    'category': post.get('category', ''),
                    'authorName': post['authorName'],
                    'authorRole': post['authorRole'],
                    'coverImage': post['coverImage'],
                    'publishedAt': post['publishedAt'],
                    'tags': post['tags'],
                    'visibility': 'members' if post.get('membersOnly') else 'public',
                    'engagement': post['engagement'],
                    'locked': bool(post.get('locked')),
                    'url': f"/think-tank?post={post['slug']}",
                }
            )
        return items

    def get_post(self, slug_or_id: str) -> dict | None:
        with self.lock:
            with self._connect() as connection:
                row = connection.execute(
                    'SELECT * FROM posts WHERE slug = ? OR id = ? LIMIT 1',
                    (slug_or_id, slug_or_id),
                ).fetchone()
                if not row:
                    return None
                return self._hydrate_post(connection, row)

    def list_revisions(self, post_id: str, limit: int = 50) -> list[dict]:
        with self.lock:
            with self._connect() as connection:
                rows = connection.execute(
                    '''
                    SELECT id, actor_name, actor_role, revision_at, snapshot_json
                    FROM post_revisions
                    WHERE post_id = ?
                    ORDER BY revision_at DESC
                    LIMIT ?
                    ''',
                    (post_id, limit),
                ).fetchall()
                revisions = []
                for row in rows:
                    snapshot = json.loads(row['snapshot_json'])
                    revisions.append(
                        {
                            'id': row['id'],
                            'postId': post_id,
                            'actorName': row['actor_name'],
                            'actorRole': row['actor_role'],
                            'revisionAt': row['revision_at'],
                            'title': snapshot.get('title', ''),
                            'status': snapshot.get('status', 'draft'),
                            'membersOnly': bool(snapshot.get('membersOnly')),
                            'excerpt': snapshot.get('excerpt', ''),
                        }
                    )
                return revisions

    def save_post(self, payload: dict, actor_name: str, actor_role: str) -> dict:
        with self.lock:
            with self._connect() as connection:
                saved = self._upsert_post(
                    connection,
                    payload,
                    actor_name,
                    actor_role,
                    record_revision=True,
                )
                connection.commit()
                self._persist_snapshot(connection)
                return saved

    def _insert_revision(
        self,
        connection: sqlite3.Connection,
        snapshot: dict,
        actor_name: str,
        actor_role: str,
        revision_at: str,
    ) -> None:
        connection.execute(
            'INSERT INTO post_revisions (id, post_id, actor_name, actor_role, revision_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)',
            (
                f'rev-{uuid4().hex[:12]}',
                snapshot['id'],
                actor_name,
                actor_role,
                revision_at,
                json.dumps(snapshot),
            ),
        )

    def archive_post(
        self,
        post_id: str,
        actor_name: str,
        actor_role: str,
    ) -> dict | None:
        with self.lock:
            with self._connect() as connection:
                existing = self._get_post_by_id(connection, post_id)
                if not existing:
                    return None
                now = _timestamp()
                connection.execute(
                    'UPDATE posts SET deleted_at = ?, updated_at = ?, status = ? WHERE id = ?',
                    (now, now, 'draft', post_id),
                )
                archived = self._get_post_by_id(connection, post_id)
                if archived:
                    self._insert_revision(
                        connection,
                        archived,
                        actor_name,
                        actor_role,
                        now,
                    )
                connection.commit()
                self._persist_snapshot(connection)
                return archived

    def restore_post(
        self,
        post_id: str,
        actor_name: str,
        actor_role: str,
    ) -> dict | None:
        with self.lock:
            with self._connect() as connection:
                existing = self._get_post_by_id(connection, post_id)
                if not existing:
                    return None
                now = _timestamp()
                connection.execute(
                    "UPDATE posts SET deleted_at = '', updated_at = ? WHERE id = ?",
                    (now, post_id),
                )
                restored = self._get_post_by_id(connection, post_id)
                if restored:
                    self._insert_revision(
                        connection,
                        restored,
                        actor_name,
                        actor_role,
                        now,
                    )
                connection.commit()
                self._persist_snapshot(connection)
                return restored

    def get_attachment(self, post_id: str, attachment_id: str) -> dict | None:
        post = self.get_post(post_id)
        if not post:
            return None
        for attachment in post.get('attachments', []):
            if attachment.get('id') == attachment_id:
                return attachment
        return None

    def record_engagement(self, post_id: str, action: str) -> dict:
        field_map = {'like': 'likes', 'share': 'shares', 'view': 'views'}
        field = field_map.get(action)
        if not field:
            raise ValueError('Invalid engagement action')

        with self.lock:
            with self._connect() as connection:
                exists = connection.execute(
                    'SELECT id FROM posts WHERE id = ?',
                    (post_id,),
                ).fetchone()
                if not exists:
                    raise KeyError(post_id)
                connection.execute(
                    'INSERT OR IGNORE INTO engagement (post_id, likes, shares, views) VALUES (?, 0, 0, 0)',
                    (post_id,),
                )
                connection.execute(
                    f'UPDATE engagement SET {field} = {field} + 1 WHERE post_id = ?',
                    (post_id,),
                )
                connection.execute(
                    'UPDATE posts SET updated_at = ? WHERE id = ?',
                    (_timestamp(), post_id),
                )
                connection.commit()
                self._persist_snapshot(connection)
                saved = self._get_post_by_id(connection, post_id)
                if not saved:
                    raise KeyError(post_id)
                return saved

    def add_comment(self, post_id: str, author_name: str, body: str) -> dict:
        with self.lock:
            with self._connect() as connection:
                exists = connection.execute(
                    'SELECT id FROM posts WHERE id = ?',
                    (post_id,),
                ).fetchone()
                if not exists:
                    raise KeyError(post_id)
                comment = {
                    'id': f'comment-{uuid4().hex[:10]}',
                    'authorName': author_name,
                    'body': body,
                    'createdAt': _timestamp(),
                }
                connection.execute(
                    'INSERT INTO comments (id, post_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    (
                        comment['id'],
                        post_id,
                        comment['authorName'],
                        comment['body'],
                        comment['createdAt'],
                    ),
                )
                connection.execute(
                    'UPDATE posts SET updated_at = ? WHERE id = ?',
                    (_timestamp(), post_id),
                )
                connection.commit()
                self._persist_snapshot(connection)
                return comment

    def record_event(self, post_id: str, event_type: str, actor: dict, context: dict | None) -> None:
        payload = context if isinstance(context, dict) else {}
        referrer = str(payload.get('referrer', '')).strip()
        origin = str(payload.get('origin', '')).strip()
        current_url = str(payload.get('currentUrl', '')).strip()
        source_host = str(payload.get('sourceHost', '')).strip() or _host_from_url(referrer) or _host_from_url(current_url)
        metadata = {
            key: value
            for key, value in payload.items()
            if key not in {
                'referrer',
                'origin',
                'currentUrl',
                'sourceHost',
                'utmSource',
                'utmMedium',
                'utmCampaign',
                'locale',
                'timezone',
                'deviceType',
                'browser',
                'os',
            }
        }
        with self.lock:
            with self._connect() as connection:
                connection.execute(
                    '''
                    INSERT INTO analytics_events (
                        id, post_id, event_type, created_at, viewer_name,
                        viewer_role, authenticated, viewer_member, referrer,
                        origin, current_url, source_host, utm_source,
                        utm_medium, utm_campaign, locale, timezone,
                        device_type, browser, os, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        f'evt-{uuid4().hex[:14]}',
                        post_id,
                        event_type,
                        _timestamp(),
                        str(actor.get('name', '')).strip(),
                        str(actor.get('role', '')).strip(),
                        1 if actor.get('authenticated') else 0,
                        1 if actor.get('capabilities', {}).get('canAccessMembersOnly') else 0,
                        referrer,
                        origin,
                        current_url,
                        source_host,
                        str(payload.get('utmSource', '')).strip(),
                        str(payload.get('utmMedium', '')).strip(),
                        str(payload.get('utmCampaign', '')).strip(),
                        str(payload.get('locale', '')).strip(),
                        str(payload.get('timezone', '')).strip(),
                        str(payload.get('deviceType', '')).strip(),
                        str(payload.get('browser', '')).strip(),
                        str(payload.get('os', '')).strip(),
                        json.dumps(metadata),
                    ),
                )
                connection.commit()
                self._persist_snapshot(connection)

    def get_dashboard(self, post_id: str | None = None) -> dict:
        post_filter = 'WHERE posts.id = ?' if post_id else ''
        event_filter = 'WHERE analytics_events.post_id = ?' if post_id else ''
        comment_filter = 'WHERE comments.post_id = ?' if post_id else ''
        params = (post_id,) if post_id else ()
        with self.lock:
            with self._connect() as connection:
                summary = connection.execute(
                    f'''
                    SELECT
                        COUNT(*) AS total_posts,
                        SUM(CASE WHEN posts.status = 'published' THEN 1 ELSE 0 END) AS published_posts,
                        SUM(CASE WHEN posts.status != 'published' THEN 1 ELSE 0 END) AS draft_posts,
                        SUM(COALESCE(engagement.likes, 0)) AS likes,
                        SUM(COALESCE(engagement.shares, 0)) AS shares,
                        SUM(COALESCE(engagement.views, 0)) AS views
                    FROM posts
                    LEFT JOIN engagement ON engagement.post_id = posts.id
                    {post_filter}
                    ''',
                    params,
                ).fetchone()
                comment_count = connection.execute(
                    f'SELECT COUNT(*) AS total FROM comments {comment_filter}',
                    params,
                ).fetchone()['total']
                event_summary = connection.execute(
                    f'''
                    SELECT
                        COUNT(*) AS total_events,
                        SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS read_events,
                        SUM(CASE WHEN authenticated = 1 THEN 1 ELSE 0 END) AS authenticated_events,
                        SUM(CASE WHEN viewer_member = 1 THEN 1 ELSE 0 END) AS member_events,
                        COUNT(DISTINCT CASE WHEN TRIM(viewer_name) != '' THEN viewer_name ELSE current_url END) AS distinct_readers
                    FROM analytics_events
                    {event_filter}
                    ''',
                    params,
                ).fetchone()
                top_referrers = [
                    {
                        'source': row['source'],
                        'reads': row['reads'],
                    }
                    for row in connection.execute(
                        f'''
                        SELECT
                            CASE
                                WHEN TRIM(source_host) != '' THEN source_host
                                WHEN TRIM(origin) != '' THEN origin
                                WHEN TRIM(referrer) != '' THEN referrer
                                ELSE 'direct'
                            END AS source,
                            COUNT(*) AS reads
                        FROM analytics_events
                        {event_filter}
                        AND event_type = 'view'
                        GROUP BY source
                        ORDER BY reads DESC, source ASC
                        LIMIT 8
                        ''' if post_id else '''
                        SELECT
                            CASE
                                WHEN TRIM(source_host) != '' THEN source_host
                                WHEN TRIM(origin) != '' THEN origin
                                WHEN TRIM(referrer) != '' THEN referrer
                                ELSE 'direct'
                            END AS source,
                            COUNT(*) AS reads
                        FROM analytics_events
                        WHERE event_type = 'view'
                        GROUP BY source
                        ORDER BY reads DESC, source ASC
                        LIMIT 8
                        ''',
                        params,
                    ).fetchall()
                ]
                recent_readers = [
                    {
                        'eventId': row['id'],
                        'name': row['viewer_name'] or 'Guest Reader',
                        'role': row['viewer_role'] or 'Public',
                        'authenticated': bool(row['authenticated']),
                        'member': bool(row['viewer_member']),
                        'source': row['source_host'] or row['origin'] or row['referrer'] or 'direct',
                        'locale': row['locale'],
                        'timezone': row['timezone'],
                        'deviceType': row['device_type'],
                        'browser': row['browser'],
                        'os': row['os'],
                        'createdAt': row['created_at'],
                    }
                    for row in connection.execute(
                        f'''
                        SELECT id, viewer_name, viewer_role, authenticated,
                               viewer_member, source_host, origin, referrer,
                               locale, timezone, device_type, browser, os,
                               created_at
                        FROM analytics_events
                        {event_filter}
                        ORDER BY created_at DESC
                        LIMIT 12
                        ''' if post_id else '''
                        SELECT id, viewer_name, viewer_role, authenticated,
                               viewer_member, source_host, origin, referrer,
                               locale, timezone, device_type, browser, os,
                               created_at
                        FROM analytics_events
                        ORDER BY created_at DESC
                        LIMIT 12
                        ''',
                        params,
                    ).fetchall()
                ]
                top_posts = [
                    {
                        'postId': row['id'],
                        'title': row['title'],
                        'slug': row['slug'],
                        'reads': row['reads'],
                        'likes': row['likes'],
                        'shares': row['shares'],
                        'comments': row['comments'],
                    }
                    for row in connection.execute(
                        '''
                        SELECT
                            posts.id,
                            posts.slug,
                            posts.title,
                            SUM(CASE WHEN analytics_events.event_type = 'view' THEN 1 ELSE 0 END) AS reads,
                            COALESCE(engagement.likes, 0) AS likes,
                            COALESCE(engagement.shares, 0) AS shares,
                            COUNT(DISTINCT comments.id) AS comments
                        FROM posts
                        LEFT JOIN analytics_events ON analytics_events.post_id = posts.id
                        LEFT JOIN engagement ON engagement.post_id = posts.id
                        LEFT JOIN comments ON comments.post_id = posts.id
                        GROUP BY posts.id, posts.slug, posts.title, engagement.likes, engagement.shares
                        ORDER BY reads DESC, posts.updated_at DESC
                        LIMIT 8
                        '''
                    ).fetchall()
                ]
                top_locales = [
                    {
                        'locale': row['locale'],
                        'reads': row['reads'],
                    }
                    for row in connection.execute(
                        f'''
                        SELECT locale, COUNT(*) AS reads
                        FROM analytics_events
                        {event_filter}
                        AND event_type = 'view' AND TRIM(locale) != ''
                        GROUP BY locale
                        ORDER BY reads DESC, locale ASC
                        LIMIT 8
                        ''' if post_id else '''
                        SELECT locale, COUNT(*) AS reads
                        FROM analytics_events
                        WHERE event_type = 'view' AND TRIM(locale) != ''
                        GROUP BY locale
                        ORDER BY reads DESC, locale ASC
                        LIMIT 8
                        ''',
                        params,
                    ).fetchall()
                ]
                top_timezones = [
                    {
                        'timezone': row['timezone'],
                        'reads': row['reads'],
                    }
                    for row in connection.execute(
                        f'''
                        SELECT timezone, COUNT(*) AS reads
                        FROM analytics_events
                        {event_filter}
                        AND event_type = 'view' AND TRIM(timezone) != ''
                        GROUP BY timezone
                        ORDER BY reads DESC, timezone ASC
                        LIMIT 8
                        ''' if post_id else '''
                        SELECT timezone, COUNT(*) AS reads
                        FROM analytics_events
                        WHERE event_type = 'view' AND TRIM(timezone) != ''
                        GROUP BY timezone
                        ORDER BY reads DESC, timezone ASC
                        LIMIT 8
                        ''',
                        params,
                    ).fetchall()
                ]
                return {
                    'summary': {
                        'totalPosts': int(summary['total_posts'] or 0),
                        'publishedPosts': int(summary['published_posts'] or 0),
                        'draftPosts': int(summary['draft_posts'] or 0),
                        'views': int(summary['views'] or 0),
                        'likes': int(summary['likes'] or 0),
                        'shares': int(summary['shares'] or 0),
                        'comments': int(comment_count or 0),
                        'readEvents': int(event_summary['read_events'] or 0),
                        'authenticatedReads': int(event_summary['authenticated_events'] or 0),
                        'memberReads': int(event_summary['member_events'] or 0),
                        'distinctReaders': int(event_summary['distinct_readers'] or 0),
                    },
                    'topReferrers': top_referrers,
                    'recentReaders': recent_readers,
                    'topPosts': top_posts,
                    'topLocales': top_locales,
                    'topTimezones': top_timezones,
                }

    def get_link_preview(self, url: str) -> dict | None:
        with self.lock:
            with self._connect() as connection:
                row = connection.execute(
                    'SELECT * FROM link_previews WHERE url = ?',
                    (url,),
                ).fetchone()
                if not row:
                    return None
                preview = _safe_json_loads(row['metadata_json'])
                preview.update(
                    {
                        'url': url,
                        'kind': row['kind'],
                        'provider': row['provider'],
                        'title': row['title'],
                        'description': row['description'],
                        'imageUrl': row['image_url'],
                        'siteName': row['site_name'],
                        'authorName': row['author_name'],
                        'publishedAt': row['published_at'],
                        'embedUrl': row['embed_url'],
                        'fetchedAt': row['fetched_at'],
                    }
                )
                return preview

    def save_link_preview(self, url: str, preview: dict) -> dict:
        record = {
            'url': url,
            'kind': str(preview.get('kind', 'link')).strip() or 'link',
            'provider': str(preview.get('provider', '')).strip(),
            'title': str(preview.get('title', '')).strip(),
            'description': str(preview.get('description', '')).strip(),
            'imageUrl': str(preview.get('imageUrl', '')).strip(),
            'siteName': str(preview.get('siteName', '')).strip(),
            'authorName': str(preview.get('authorName', '')).strip(),
            'publishedAt': str(preview.get('publishedAt', '')).strip(),
            'embedUrl': str(preview.get('embedUrl', '')).strip(),
            'fetchedAt': _timestamp(),
        }
        metadata = {
            key: value
            for key, value in preview.items()
            if key not in record
        }
        with self.lock:
            with self._connect() as connection:
                connection.execute(
                    '''
                    INSERT INTO link_previews (
                        url, kind, provider, title, description, image_url,
                        site_name, author_name, published_at, embed_url,
                        metadata_json, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(url) DO UPDATE SET
                        kind = excluded.kind,
                        provider = excluded.provider,
                        title = excluded.title,
                        description = excluded.description,
                        image_url = excluded.image_url,
                        site_name = excluded.site_name,
                        author_name = excluded.author_name,
                        published_at = excluded.published_at,
                        embed_url = excluded.embed_url,
                        metadata_json = excluded.metadata_json,
                        fetched_at = excluded.fetched_at
                    ''',
                    (
                        record['url'],
                        record['kind'],
                        record['provider'],
                        record['title'],
                        record['description'],
                        record['imageUrl'],
                        record['siteName'],
                        record['authorName'],
                        record['publishedAt'],
                        record['embedUrl'],
                        json.dumps(metadata),
                        record['fetchedAt'],
                    ),
                )
                connection.commit()
        result = dict(record)
        result.update(metadata)
        return result
