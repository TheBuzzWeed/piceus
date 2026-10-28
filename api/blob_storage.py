import json
import os


def blob_storage_enabled() -> bool:
    return bool(os.getenv('BLOB_READ_WRITE_TOKEN', '').strip())


async def upload_private_blob(
    pathname: str,
    content: bytes,
    content_type: str,
    *,
    add_random_suffix: bool = True,
    overwrite: bool = False,
) -> dict:
    if not blob_storage_enabled():
        raise RuntimeError('Blob storage is not configured for this project.')

    from vercel.blob import AsyncBlobClient

    client = AsyncBlobClient()
    uploaded = await client.put(
        pathname,
        content,
        access='private',
        add_random_suffix=add_random_suffix,
        overwrite=overwrite,
        content_type=content_type or 'application/octet-stream',
        multipart=len(content) >= 5 * 1024 * 1024,
    )
    return {
        'pathname': uploaded.pathname,
        'contentType': uploaded.content_type,
        'url': uploaded.url,
        'downloadUrl': uploaded.download_url,
        'etag': getattr(uploaded, 'etag', None),
    }


async def download_private_blob(url_or_path: str) -> tuple[bytes, dict[str, str]]:
    if not blob_storage_enabled():
        raise RuntimeError('Blob storage is not configured for this project.')

    from vercel.blob import AsyncBlobClient

    client = AsyncBlobClient()
    result = await client.get(url_or_path, access='private', use_cache=False)
    if result is None or result.status_code != 200 or result.content is None:
        raise FileNotFoundError(url_or_path)

    return result.content, {
        'content_type': result.content_type or 'application/octet-stream',
        'download_url': result.download_url,
        'pathname': result.pathname,
    }


async def upload_private_json(pathname: str, payload: dict) -> dict:
    return await upload_private_blob(
        pathname,
        json.dumps(payload).encode('utf-8'),
        'application/json',
        add_random_suffix=False,
        overwrite=True,
    )


async def download_private_json(pathname: str) -> dict | None:
    try:
        payload, _ = await download_private_blob(pathname)
    except FileNotFoundError:
        return None
    return json.loads(payload.decode('utf-8'))