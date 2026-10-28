import json
import re
from html import unescape
from urllib import error, parse, request


USER_AGENT = (
    'Mozilla/5.0 (compatible; PICEUSLinkPreview/1.0; '
    '+https://piceus.com)'
)


def _fetch_json(url: str) -> dict | None:
    outgoing = request.Request(
        url,
        headers={
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
        },
        method='GET',
    )
    try:
        with request.urlopen(outgoing, timeout=8) as response:
            raw = response.read().decode('utf-8', errors='ignore')
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
    except (error.URLError, error.HTTPError, json.JSONDecodeError):
        return None


def _fetch_text(url: str) -> str:
    outgoing = request.Request(
        url,
        headers={
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': USER_AGENT,
        },
        method='GET',
    )
    with request.urlopen(outgoing, timeout=8) as response:
        return response.read().decode('utf-8', errors='ignore')


def _clean(value: str) -> str:
    return re.sub(r'\s+', ' ', unescape(value or '')).strip()


def _meta(html: str, names: list[str]) -> str:
    for name in names:
        pattern = re.compile(
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\']'
            rf'[^>]+content=["\']([^"\']+)["\']',
            re.IGNORECASE,
        )
        match = pattern.search(html)
        if match:
            return _clean(match.group(1))
        reverse_pattern = re.compile(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+'
            rf'(?:property|name)=["\']{re.escape(name)}["\']',
            re.IGNORECASE,
        )
        reverse_match = reverse_pattern.search(html)
        if reverse_match:
            return _clean(reverse_match.group(1))
    return ''


def _title(html: str) -> str:
    match = re.search(
        r'<title[^>]*>(.*?)</title>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ''
    return _clean(match.group(1))


def _youtube_embed(parsed: parse.ParseResult) -> tuple[str, str]:
    video_id = ''
    if parsed.netloc.endswith('youtu.be'):
        video_id = parsed.path.strip('/')
    else:
        params = parse.parse_qs(parsed.query)
        video_id = params.get('v', [''])[0]
        if not video_id and parsed.path.startswith('/embed/'):
            video_id = parsed.path.split('/embed/', 1)[1].split('/')[0]
    if not video_id:
        return '', ''
    return (
        f'https://www.youtube.com/embed/{video_id}',
        f'https://img.youtube.com/vi/{video_id}/hqdefault.jpg',
    )


def _vimeo_embed(parsed: parse.ParseResult) -> str:
    match = re.search(r'/(\d+)$', parsed.path)
    if not match:
        return ''
    return f'https://player.vimeo.com/video/{match.group(1)}'


def fetch_link_preview(url: str) -> dict:
    parsed = parse.urlparse(url)
    if parsed.scheme not in {'http', 'https'}:
        raise ValueError('Preview URLs must start with http:// or https://')

    host = parsed.netloc.lower()
    if 'youtube.com' in host or 'youtu.be' in host:
        oembed = _fetch_json(
            'https://www.youtube.com/oembed?format=json&url='
            + parse.quote(url, safe='')
        )
        embed_url, image_url = _youtube_embed(parsed)
        return {
            'url': url,
            'kind': 'video',
            'provider': 'youtube',
            'title': _clean((oembed or {}).get('title', 'YouTube video')),
            'description': 'Embedded YouTube source',
            'imageUrl': image_url,
            'siteName': 'YouTube',
            'authorName': _clean((oembed or {}).get('author_name', '')),
            'publishedAt': '',
            'embedUrl': embed_url,
        }

    if 'vimeo.com' in host:
        oembed = _fetch_json(
            'https://vimeo.com/api/oembed.json?url='
            + parse.quote(url, safe='')
        )
        return {
            'url': url,
            'kind': 'video',
            'provider': 'vimeo',
            'title': _clean((oembed or {}).get('title', 'Vimeo video')),
            'description': _clean(
                (oembed or {}).get('description', 'Embedded Vimeo source')
            ),
            'imageUrl': _clean((oembed or {}).get('thumbnail_url', '')),
            'siteName': 'Vimeo',
            'authorName': _clean((oembed or {}).get('author_name', '')),
            'publishedAt': '',
            'embedUrl': _vimeo_embed(parsed),
        }

    html = _fetch_text(url)
    og_type = _meta(html, ['og:type'])
    return {
        'url': url,
        'kind': 'video' if 'video' in og_type else 'link',
        'provider': host,
        'title': _meta(html, ['og:title', 'twitter:title']) or _title(html),
        'description': _meta(
            html,
            ['og:description', 'description', 'twitter:description'],
        ),
        'imageUrl': _meta(html, ['og:image', 'twitter:image']),
        'siteName': _meta(html, ['og:site_name']) or host,
        'authorName': _meta(html, ['author', 'article:author']),
        'publishedAt': _meta(
            html,
            ['article:published_time', 'og:published_time'],
        ),
        'embedUrl': '',
    }
