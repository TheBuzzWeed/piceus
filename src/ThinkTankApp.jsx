import { useEffect, useMemo, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';


const EMPTY_EDITOR = {
  id: '',
  slug: '',
  title: '',
  excerpt: '',
  category: '',
  tags: '',
  audience: 'public',
  heroImage: '',
  heroVideo: '',
  supportingImage: '',
  sourceUrl: '',
  sourcePreview: null,
  videoSourceUrl: '',
  videoPreview: null,
  quote: '',
  attachments: [],
  bodyHtml: '<p>Start writing here...</p>',
};

const EMPTY_FILTERS = {
  title: '',
  author: '',
  status: 'all',
  audience: 'all',
  category: 'all',
  dateFrom: '',
  dateTo: '',
};

const DEFAULT_VIEWER = {
  authenticated: false,
  name: 'Guest Reader',
  role: 'Public',
  capabilities: {
    canAccessMembersOnly: false,
    canManagePosts: false,
  },
};

const THINK_TANK_NAV_ITEMS = [
  { id: 'home', label: 'Home', href: '/#home' },
  { id: 'about', label: 'About', href: '/#about' },
  { id: 'platform', label: 'Platform', href: '/#platform' },
  { id: 'work', label: 'Our Work', href: '/#work' },
  { id: 'research', label: 'Research', href: '/#research' },
  { id: 'thinktank', label: 'ThinkTank', href: '/think-tank' },
  { id: 'contact', label: 'Contact', href: '/#contact', className: 'nav-contact' },
];

const BUZZVIBE_LIKE_ICON_URL = 'https://imagedelivery.net/mEHe7vWpwEHOhne-YSqzMw/1d169027-443a-4f85-8c7d-707000933f00/public';
const BUZZVIBE_LIKED_ICON_URL = 'https://imagedelivery.net/mEHe7vWpwEHOhne-YSqzMw/b0d6f7b5-d727-4f1d-cda5-a1cf207eae00/public';
const BUZZVIBE_SHARE_ICON_URL = 'https://imagedelivery.net/mEHe7vWpwEHOhne-YSqzMw/91301ff3-393c-42b0-6a3f-f4790206be00/public';

const COMPOSER_TOOLS = [
  { id: 'heading1', icon: 'H1', label: 'Heading 1', description: 'Drop a big section break into the story.', hint: 'Use this for the major chapter title inside the article.' },
  { id: 'heading2', icon: 'H2', label: 'Heading 2', description: 'Add a tighter section header for subsections.', hint: 'Best for the internal article rhythm and navigation.' },
  { id: 'quote', icon: '"', label: 'Quote', description: 'Highlight a line worth pulling forward.', hint: 'Paste or type the quote and drop it straight into the canvas.' },
  { id: 'callout', icon: '[]', label: 'Callout', description: 'Drop a highlighted bracket-box note into the story.', hint: 'Use this for editor notes, key takeaways, or emphasized side commentary.' },
  { id: 'image', icon: 'Img', label: 'Image', description: 'Insert an inline image with caption or alt text.', hint: 'Upload first or paste a direct image URL.' },
  { id: 'video', icon: 'Vid', label: 'Video', description: 'Embed a hosted video or attach an MP4 link.', hint: 'YouTube and Vimeo links become embeds automatically.' },
  { id: 'source', icon: 'Src', label: 'Source', description: 'Drop a cited reference or outbound reading link.', hint: 'Use a short label if the raw URL is messy.' },
];

const DEFAULT_COMPOSER_DRAFTS = {
  heading1: 'New section title',
  heading2: 'Section heading',
  quote: 'Pull quote or key line',
  calloutTitle: 'Editor note',
  calloutBody: 'Highlight a key point, context note, or guided takeaway here.',
  imageUrl: '',
  imageAlt: '',
  imageAlignment: 'center',
  videoUrl: '',
  sourceUrl: '',
  sourceLabel: '',
};

const HERO_IMAGE_ASPECT = 16 / 9;
const INLINE_ATTACHMENT_LIMIT_BYTES = 1024 * 1024;


function normalizeImageAlignment(value) {
  return ['left', 'center', 'right'].includes(value) ? value : 'center';
}


function readRequestedPostSlug() {
  if (typeof window === 'undefined') {
    return '';
  }
  return new URLSearchParams(window.location.search).get('post') || '';
}


function syncThinkTankUrl(slug, { push = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = '/think-tank';
  if (slug) {
    url.searchParams.set('post', slug);
  } else {
    url.searchParams.delete('post');
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (push) {
    window.history.pushState({}, '', nextUrl);
  } else {
    window.history.replaceState({}, '', nextUrl);
  }
}


function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the selected image for cropping.'));
    image.src = src;
  });
}


async function getCroppedImageDataUrl(imageSrc, cropAreaPixels) {
  const image = await loadImageElement(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropAreaPixels.width));
  canvas.height = Math.max(1, Math.round(cropAreaPixels.height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to prepare the image editor canvas.');
  }
  context.drawImage(
    image,
    cropAreaPixels.x,
    cropAreaPixels.y,
    cropAreaPixels.width,
    cropAreaPixels.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL('image/jpeg', 0.92);
}


function getUserInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'PI';
}


function BuzzVibeCommentIcon({ className = 'tt-action-icon' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M5 5.75h14a2.25 2.25 0 0 1 2.25 2.25v7.4A2.35 2.35 0 0 1 18.9 17.75H11.1l-4.55 3.4c-.67.5-1.55.02-1.55-.8v-2.6A2.27 2.27 0 0 1 2.75 15.5V8A2.25 2.25 0 0 1 5 5.75Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function ThinkTankAccountMenu({
  accountSelfServiceEnabled,
  authError,
  authenticated,
  loading,
  matrixProductName,
  onClearError,
  onLogin,
  onLogout,
  platformLinks,
  showAdminLink,
  user,
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    onClearError();
    try {
      await onLogin(identifier, password);
      setPassword('');
    } catch {
      // Error state is surfaced from the auth hook.
    }
  };

  return (
    <div id="account-dropdown" className="account-dropdown">
      <div className="account-dropdown-header">
        <span className="matrix-badge">{authenticated ? 'Connected' : 'Connected platforms'}</span>
        <h3>{authenticated ? 'Ecosystem hub' : `${matrixProductName} sign in`}</h3>
        <p>
          {authenticated
            ? 'Use one profile across PICEUS systems, jump into the article engine, or sign out when you are done.'
            : 'Sign in with your assigned MATRIX credentials to access PICEUS ThinkTank and the connected platform ecosystem.'}
        </p>
        {!authenticated && !accountSelfServiceEnabled ? (
          <p className="auth-note">
            Password reset is not available from this shell right now. Use your existing credentials or contact the platform owner through PICEUS for account help.
          </p>
        ) : null}
      </div>
      <div className="platform-list">
        {platformLinks.map((platform) => (
          <a key={`${platform.label}-${platform.href}`} className="platform-link" href={platform.href}>
            <span>
              <strong>{platform.label}</strong>
              <small>{platform.description}</small>
            </span>
            <b>Enter</b>
          </a>
        ))}
      </div>
      {authenticated ? (
        <div className="account-session">
          <p>{user?.role || 'Authenticated user'}</p>
          {showAdminLink ? <a className="button primary" href="#tt-admin">Admin Studio</a> : null}
          <button type="button" className="button outline dark-outline" onClick={onLogout}>Log out</button>
        </div>
      ) : (
        <form className="matrix-auth-form compact-auth-form" autoComplete="off" onSubmit={handleSubmit}>
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
          />
          <label htmlFor="matrix-identifier">Email, handle, or unique ID</label>
          <input
            id="matrix-identifier"
            type="text"
            name="matrix-access-identifier"
            autoComplete="username"
            spellCheck="false"
            autoCapitalize="none"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
            placeholder="you@example.com or dubsthecreator"
          />
          <label htmlFor="matrix-password-thinktank">Password</label>
          <input
            id="matrix-password-thinktank"
            type="password"
            name="matrix-access-password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            placeholder="••••••••"
          />
          {authError ? <p className="auth-error">{authError}</p> : null}
          <div className="auth-actions compact-auth-actions">
            <button type="submit" className="button primary" disabled={loading}>{loading ? 'Signing in...' : 'Log in'}</button>
          </div>
        </form>
      )}
    </div>
  );
}


function parseBrowserInfo() {
  if (typeof navigator === 'undefined') {
    return {
      locale: '',
      timezone: '',
      deviceType: '',
      browser: '',
      os: '',
    };
  }

  const userAgent = navigator.userAgent || '';
  const browser = /Chrome/i.test(userAgent)
    ? 'Chrome'
    : /Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)
      ? 'Safari'
      : /Firefox/i.test(userAgent)
        ? 'Firefox'
        : /Edg/i.test(userAgent)
          ? 'Edge'
          : 'Other';
  const os = /Mac OS X/i.test(userAgent)
    ? 'macOS'
    : /Windows/i.test(userAgent)
      ? 'Windows'
      : /iPhone|iPad|iPod/i.test(userAgent)
        ? 'iOS'
        : /Android/i.test(userAgent)
          ? 'Android'
          : 'Other';
  const width = typeof window !== 'undefined' ? window.innerWidth : 0;
  return {
    locale: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    deviceType: width && width < 760 ? 'mobile' : width && width < 1080 ? 'tablet' : 'desktop',
    browser,
    os,
  };
}


function buildAnalyticsContext() {
  if (typeof window === 'undefined') {
    return {};
  }
  const url = new URL(window.location.href);
  let sourceHost = url.host;
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      sourceHost = new URL(document.referrer).host;
    } catch {
      sourceHost = url.host;
    }
  }
  return {
    currentUrl: url.toString(),
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    origin: window.location.origin,
    sourceHost,
    utmSource: url.searchParams.get('utm_source') || '',
    utmMedium: url.searchParams.get('utm_medium') || '',
    utmCampaign: url.searchParams.get('utm_campaign') || '',
    ...parseBrowserInfo(),
  };
}


function splitTags(value) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}


function truncatePreview(value, limit = 300) {
  const text = String(value || '').trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit).trimEnd()}…`;
}


function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function videoEmbedUrl(value = '') {
  try {
    const url = new URL(value);
    if (/youtu\.be$/i.test(url.hostname)) {
      const videoId = url.pathname.split('/').filter(Boolean)[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
    }
    if (/youtube\.com$/i.test(url.hostname) || /youtube-nocookie\.com$/i.test(url.hostname)) {
      const videoId = url.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
    }
    if (/vimeo\.com$/i.test(url.hostname)) {
      const videoId = url.pathname.split('/').filter(Boolean)[0];
      return videoId ? `https://player.vimeo.com/video/${videoId}` : '';
    }
  } catch {
    return '';
  }
  return '';
}


function buildComposerSnippet(tool, drafts) {
  const heading1 = escapeHtml(drafts.heading1 || 'New section title');
  const heading2 = escapeHtml(drafts.heading2 || 'Section heading');
  const quote = escapeHtml(drafts.quote || 'Pull quote or key line');
  const calloutTitle = escapeHtml(drafts.calloutTitle || 'Editor note');
  const calloutBody = escapeHtml(drafts.calloutBody || 'Highlight a key point, context note, or guided takeaway here.');
  const imageUrl = escapeHtml(drafts.imageUrl || '');
  const imageAlt = escapeHtml(drafts.imageAlt || 'Inline image');
  const imageAlignment = normalizeImageAlignment(drafts.imageAlignment);
  const videoUrl = escapeHtml(drafts.videoUrl || '');
  const sourceUrl = escapeHtml(drafts.sourceUrl || '');
  const sourceLabel = escapeHtml(drafts.sourceLabel || drafts.sourceUrl || 'Linked source');

  switch (tool) {
    case 'heading1':
      return `<h1>${heading1}</h1><p></p>`;
    case 'heading2':
      return `<h2>${heading2}</h2><p></p>`;
    case 'quote':
      return `<blockquote>${quote}</blockquote><p></p>`;
    case 'callout':
      return `<aside class="tt-callout"><span class="tt-callout-mark" aria-hidden="true">[]</span><div class="tt-callout-copy"><strong>${calloutTitle}</strong><p>${calloutBody}</p></div></aside><p></p>`;
    case 'image':
      return imageUrl
        ? `<figure class="tt-editor-figure tt-image-align-${imageAlignment}" data-image-align="${imageAlignment}"><img src="${imageUrl}" alt="${imageAlt}" /><figcaption>${imageAlt}</figcaption></figure><p></p>`
        : '';
    case 'video': {
      if (!videoUrl) {
        return '';
      }
      const embedUrl = videoEmbedUrl(videoUrl);
      if (embedUrl) {
        return `<div class="tt-editor-embed"><iframe src="${embedUrl}" title="Embedded video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><p></p>`;
      }
      return `<div class="tt-editor-inline-video"><video controls src="${videoUrl}"></video></div><p></p>`;
    }
    case 'source':
      return sourceUrl
        ? `<p><a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a></p>`
        : '';
    default:
      return '';
  }
}


function blogRequest(path, options = {}) {
  return fetch(path, options).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || body.message || `Request failed: ${response.status}`);
    }
    return body;
  });
}


function isInlineImageDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}


function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}


function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}


function headersForToken(accessToken) {
  return accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
      }
    : {};
}


function audienceFromPost(post) {
  if (post?.status !== 'published') {
    return 'private';
  }
  return post?.membersOnly ? 'members' : 'public';
}


function blocksToEditor(post) {
  const bodyParts = [];
  let supportingImage = '';
  let quote = '';
  let heroVideo = post?.coverVideo || '';
  let sourcePreview = null;
  let videoPreview = null;

  (post?.blocks || []).forEach((block) => {
    if (block.type === 'html' && block.content) {
      bodyParts.push(block.content);
    }
    if (block.type === 'paragraph' && block.content) {
      bodyParts.push(`<p>${block.content}</p>`);
    }
    if (block.type === 'quote' && block.content) {
      quote = block.content;
    }
    if (block.type === 'image' && block.url) {
      supportingImage = block.url;
    }
    if (block.type === 'video' && block.url) {
      heroVideo = block.url;
    }
    if (block.type === 'link-preview') {
      sourcePreview = block;
    }
    if (block.type === 'video-embed') {
      videoPreview = block;
    }
  });

  return {
    id: post?.id || '',
    slug: post?.slug || '',
    title: post?.title || '',
    excerpt: post?.excerpt || '',
    category: post?.category || '',
    tags: (post?.tags || []).join(', '),
    audience: audienceFromPost(post),
    heroImage: post?.coverImage || '',
    heroVideo,
    supportingImage,
    sourceUrl: sourcePreview?.url || '',
    sourcePreview,
    videoSourceUrl: videoPreview?.url || '',
    videoPreview,
    quote,
    attachments: Array.isArray(post?.attachments) ? post.attachments : [],
    bodyHtml: bodyParts.join('') || '<p>Start writing here...</p>',
  };
}


function setImageAlignmentInEditor(editorElement, alignment) {
  const nextAlignment = normalizeImageAlignment(alignment);
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const anchorNode = selection?.anchorNode || null;
  const activeElement = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement || null;
  const figure = activeElement?.closest?.('.tt-editor-figure') || null;
  if (!editorElement || !figure || !editorElement.contains(figure)) {
    return false;
  }
  figure.dataset.imageAlign = nextAlignment;
  figure.classList.remove('tt-image-align-left', 'tt-image-align-center', 'tt-image-align-right');
  figure.classList.add(`tt-image-align-${nextAlignment}`);
  return true;
}


function editorToPayload(editor, user) {
  const blocks = [];
  const sourceUrl = editor.sourceUrl.trim();
  const videoSourceUrl = editor.videoSourceUrl.trim();
  if (editor.bodyHtml.trim()) {
    blocks.push({ type: 'html', content: editor.bodyHtml });
  }
  if (editor.supportingImage.trim()) {
    blocks.push({ type: 'image', url: editor.supportingImage.trim() });
  }
  if (editor.heroVideo.trim()) {
    blocks.push({ type: 'video', url: editor.heroVideo.trim() });
  }
  if (editor.quote.trim()) {
    blocks.push({ type: 'quote', content: editor.quote.trim() });
  }
  if (sourceUrl) {
    blocks.push({
      type: 'link-preview',
      ...(editor.sourcePreview?.url === sourceUrl ? editor.sourcePreview : {}),
      url: sourceUrl,
      title: editor.sourcePreview?.url === sourceUrl
        ? (editor.sourcePreview.title || sourceUrl)
        : sourceUrl,
    });
  }
  if (videoSourceUrl) {
    const embedUrl = videoEmbedUrl(videoSourceUrl);
    blocks.push({
      type: 'video-embed',
      ...(editor.videoPreview?.url === videoSourceUrl ? editor.videoPreview : {}),
      url: videoSourceUrl,
      ...(embedUrl ? { embedUrl } : {}),
      title: editor.videoPreview?.url === videoSourceUrl
        ? (editor.videoPreview.title || videoSourceUrl)
        : videoSourceUrl,
    });
  }

  return {
    id: editor.id,
    slug: editor.slug,
    title: editor.title.trim(),
    excerpt: editor.excerpt.trim(),
    category: editor.category.trim(),
    tags: splitTags(editor.tags),
    status: editor.audience === 'private' ? 'draft' : 'published',
    membersOnly: editor.audience === 'members',
    authorName: user?.name || 'PICEUS Admin',
    authorRole: user?.role || 'Editorial Admin',
    coverImage: editor.heroImage.trim(),
    coverVideo: editor.heroVideo.trim(),
    attachments: Array.isArray(editor.attachments) ? editor.attachments : [],
    blocks,
  };
}


function formatFileSize(sizeBytes) {
  const amount = Number(sizeBytes || 0);
  if (!amount) {
    return '0 B';
  }
  if (amount < 1024) {
    return `${amount} B`;
  }
  if (amount < 1024 * 1024) {
    return `${(amount / 1024).toFixed(1)} KB`;
  }
  return `${(amount / (1024 * 1024)).toFixed(1)} MB`;
}


function buildAttachmentDownloadUrl(postId, attachmentId) {
  return `/api/blog/posts/${postId}/attachments/${attachmentId}`;
}


function visibilityLabel(post) {
  const audience = audienceFromPost(post);
  if (audience === 'members') {
    return 'Members';
  }
  if (audience === 'private') {
    return 'Private';
  }
  return 'Public';
}


function categoryLabel(post) {
  return String(post?.category || '').trim() || 'Uncategorized';
}


function upsertPostInList(posts, savedPost) {
  const nextPost = savedPost || null;
  if (!nextPost?.id) {
    return Array.isArray(posts) ? posts : [];
  }
  const currentPosts = Array.isArray(posts) ? posts : [];
  const remaining = currentPosts.filter((post) => post.id !== nextPost.id);
  return [nextPost, ...remaining];
}


function buildPostUrl(slug) {
  if (typeof window === 'undefined') {
    return `/think-tank?post=${slug}`;
  }
  const url = new URL(window.location.href);
  url.pathname = '/think-tank';
  url.searchParams.set('post', slug);
  url.hash = '';
  return url.toString();
}


async function sharePostFromCard(post) {
  if (!post?.slug) {
    return;
  }
  const shareUrl = buildPostUrl(post.slug);
  const sharePayload = {
    title: post.title || 'ThinkTank article',
    text: truncatePreview(post.excerpt || post.title || 'Open this ThinkTank article.', 160),
    url: shareUrl,
  };
  if (navigator.share) {
    await navigator.share(sharePayload);
    return;
  }
  await navigator.clipboard.writeText(shareUrl);
}


function savePostAsPdf(post) {
  if (!post?.slug || typeof window === 'undefined') {
    return;
  }
  const articleUrl = buildPostUrl(post.slug);
  const printWindow = window.open(articleUrl, '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    throw new Error('Unable to open the article window for PDF export.');
  }
  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener('load', triggerPrint, { once: true });
}


function buildPostListQuery(accessToken, filters) {
  const params = new URLSearchParams();
  if (accessToken) {
    params.set('include_drafts', 'true');
    params.set('include_deleted', 'true');
  }
  if (filters.title) {
    params.set('title', filters.title);
  }
  if (filters.author) {
    params.set('author', filters.author);
  }
  if (filters.status !== 'all') {
    params.set('status', filters.status);
  }
  if (filters.audience !== 'all') {
    params.set('audience', filters.audience);
  }
  if (filters.category !== 'all') {
    params.set('category', filters.category);
  }
  if (filters.dateFrom) {
    params.set('date_from', filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set('date_to', filters.dateTo);
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}


function normalizeEditorState(editor) {
  return {
    ...editor,
    bodyHtml: String(editor?.bodyHtml || '').trim(),
    title: String(editor?.title || '').trim(),
    slug: String(editor?.slug || '').trim(),
    excerpt: String(editor?.excerpt || '').trim(),
    category: String(editor?.category || '').trim(),
    tags: String(editor?.tags || '').trim(),
    heroImage: String(editor?.heroImage || '').trim(),
    heroVideo: String(editor?.heroVideo || '').trim(),
    supportingImage: String(editor?.supportingImage || '').trim(),
    sourceUrl: String(editor?.sourceUrl || '').trim(),
    videoSourceUrl: String(editor?.videoSourceUrl || '').trim(),
    quote: String(editor?.quote || '').trim(),
    sourcePreview: editor?.sourcePreview || null,
    videoPreview: editor?.videoPreview || null,
    attachments: Array.isArray(editor?.attachments)
      ? editor.attachments.map((attachment) => ({
        id: String(attachment?.id || '').trim(),
        kind: String(attachment?.kind || '').trim(),
        fileName: String(attachment?.fileName || '').trim(),
        mimeType: String(attachment?.mimeType || '').trim(),
        sizeBytes: Number(attachment?.sizeBytes || 0),
        contentData: String(attachment?.contentData || '').trim(),
      }))
      : [],
  };
}


function formatTimestamp(value) {
  if (!value) {
    return 'Unscheduled';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return new Date(numeric * 1000).toLocaleString();
}


function renderBlock(block) {
  if (block.type === 'html' && block.content) {
    return <div className="tt-richtext" dangerouslySetInnerHTML={{ __html: block.content }} />;
  }
  if (block.type === 'paragraph' && block.content) {
    return <p>{block.content}</p>;
  }
  if (block.type === 'quote' && block.content) {
    return <blockquote>{block.content}</blockquote>;
  }
  if (block.type === 'image' && block.url) {
    return <img className="tt-inline-image" src={block.url} alt="Article visual" />;
  }
  if (block.type === 'video' && block.url) {
    return (
      <div className="tt-video-shell">
        <video controls src={block.url} />
      </div>
    );
  }
  if (block.type === 'link-preview' && block.url) {
    return (
      <a className="tt-source-card" href={block.url} target="_blank" rel="noreferrer">
        {block.imageUrl ? <img className="tt-source-thumb" src={block.imageUrl} alt={block.title || 'Source preview'} /> : null}
        <div className="tt-source-copy">
          <span className="tt-source-site">{block.siteName || block.provider || 'Source'}</span>
          <strong>{block.title || block.url}</strong>
          {block.description ? <p>{block.description}</p> : null}
          <small>{block.authorName || block.publishedAt || block.url}</small>
        </div>
      </a>
    );
  }
  if (block.type === 'video-embed' && block.url) {
    return (
      <div className="tt-source-card tt-video-card">
        {block.embedUrl ? (
          <div className="tt-embed-frame-shell">
            <iframe src={block.embedUrl} title={block.title || 'Embedded video'} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
          </div>
        ) : block.imageUrl ? <img className="tt-source-thumb" src={block.imageUrl} alt={block.title || 'Video preview'} /> : null}
        <div className="tt-source-copy">
          <span className="tt-source-site">{block.siteName || block.provider || 'Video source'}</span>
          <strong>{block.title || block.url}</strong>
          {block.description ? <p>{block.description}</p> : null}
          <small>{block.authorName || block.publishedAt || block.url}</small>
        </div>
      </div>
    );
  }
  return null;
}


export default function ThinkTankApp({
  accountSelfServiceEnabled = false,
  session,
  sessionState,
  matrixProductName,
  piceusLogoUrl,
  onLogin,
  onLogout,
}) {
  const [posts, setPosts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [articleSlug, setArticleSlug] = useState(readRequestedPostSlug);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(DEFAULT_VIEWER);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [commentBody, setCommentBody] = useState('');
  const [editor, setEditor] = useState(EMPTY_EDITOR);
  const [editorBaseline, setEditorBaseline] = useState(EMPTY_EDITOR);
  const [editorMode, setEditorMode] = useState('idle');
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [archiveCanScrollBack, setArchiveCanScrollBack] = useState(false);
  const [archiveCanScrollNext, setArchiveCanScrollNext] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState('');
  const [activeComposerTool, setActiveComposerTool] = useState('heading2');
  const [composerDrafts, setComposerDrafts] = useState(DEFAULT_COMPOSER_DRAFTS);
  const [heroCropSource, setHeroCropSource] = useState('');
  const [heroCropOpen, setHeroCropOpen] = useState(false);
  const [heroCropPosition, setHeroCropPosition] = useState({ x: 0, y: 0 });
  const [heroCropZoom, setHeroCropZoom] = useState(1);
  const [heroCropAreaPixels, setHeroCropAreaPixels] = useState(null);
  const editorRef = useRef(null);
  const accountMenuRef = useRef(null);
  const commentInputRef = useRef(null);
  const archiveListRef = useRef(null);
  const viewedPostIdRef = useRef('');

  const accessToken = sessionState.accessToken;
  const canManagePosts = !!viewer.capabilities?.canManagePosts;
  const canAccessMembersOnly = !!viewer.capabilities?.canAccessMembersOnly;
  const canInteract = viewer.authenticated && canAccessMembersOnly;
  const isCreating = editorMode === 'create';
  const isEditorOpen = editorMode !== 'idle';
  const isEditorDirty = JSON.stringify(normalizeEditorState(editor)) !== JSON.stringify(normalizeEditorState(editorBaseline));
  const platformLinks = [
    {
      label: 'PICEUS',
      href: '/',
      description: 'Return to the primary PICEUS site shell.',
    },
    {
      label: 'ThinkTank',
      href: '/think-tank',
      description: 'Open the editorial and article engine workspace.',
    },
  ];

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) || null,
    [posts, selectedId],
  );
  const activePosts = useMemo(
    () => posts.filter((post) => !post.deletedAt),
    [posts],
  );
  const adminArchivedPosts = useMemo(
    () => posts.filter((post) => !!post.deletedAt),
    [posts],
  );
  const publicFeedPosts = useMemo(
    () => activePosts.filter((post) => post.status === 'published' && !post.membersOnly),
    [activePosts],
  );

  const featuredPost = useMemo(() => publicFeedPosts[0] || null, [publicFeedPosts]);
  const recentPosts = useMemo(() => publicFeedPosts.slice(1, 7), [publicFeedPosts]);
  const sidebarFeedPosts = useMemo(() => publicFeedPosts.slice(0, 2), [publicFeedPosts]);
  const archivePosts = useMemo(() => publicFeedPosts.slice(0, 8), [publicFeedPosts]);
  const landingGridPosts = useMemo(() => publicFeedPosts.slice(1, 7), [publicFeedPosts]);
  const recommendedPosts = useMemo(
    () => publicFeedPosts.filter((post) => post.id !== featuredPost?.id).slice(0, 3),
    [featuredPost?.id, publicFeedPosts],
  );
  const visualPosts = useMemo(
    () => publicFeedPosts.filter((post) => post.coverImage).slice(0, 4),
    [publicFeedPosts],
  );
  const adminDraftPosts = useMemo(
    () => activePosts.filter((post) => post.status !== 'published' || post.membersOnly),
    [activePosts],
  );
  const adminPublishedPosts = useMemo(
    () => activePosts.filter((post) => post.status === 'published' && !post.membersOnly),
    [activePosts],
  );
  const isArticleRoute = !!articleSlug && articleSlug === selectedPost?.slug;
  const showAdminOverviewPanels = canManagePosts && !isEditorOpen && !isArticleRoute;
  const showRecommendedPanel = false;
  const syncArchiveRailState = () => {
    const rail = archiveListRef.current;
    if (!rail) {
      setArchiveCanScrollBack(false);
      setArchiveCanScrollNext(false);
      return;
    }
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    setArchiveCanScrollBack(rail.scrollLeft > 4);
    setArchiveCanScrollNext(rail.scrollLeft < maxScrollLeft - 4);
  };
  const scrollArchiveRail = (direction) => {
    const rail = archiveListRef.current;
    if (!rail) {
      return;
    }
    const card = rail.querySelector('.tt-post-card');
    const step = card ? card.getBoundingClientRect().width + 14 : rail.clientWidth * 0.85;
    rail.scrollBy({ left: direction * step, behavior: 'smooth' });
  };
  const categories = useMemo(() => {
    const seen = new Set();
    activePosts.forEach((post) => {
      const value = String(post?.category || '').trim();
      if (value) {
        seen.add(value);
      }
    });
    return Array.from(seen).sort((left, right) => left.localeCompare(right));
  }, [activePosts]);
  const selectedComposerTool = useMemo(
    () => COMPOSER_TOOLS.find((tool) => tool.id === activeComposerTool) || COMPOSER_TOOLS[1],
    [activeComposerTool],
  );

  const snapshotEditorState = (currentEditor) => ({
    ...currentEditor,
    bodyHtml: editorRef.current?.innerHTML || currentEditor.bodyHtml,
  });

  useEffect(() => {
    if (!selectedPost || isEditorOpen) {
      return;
    }
    const nextEditor = blocksToEditor(selectedPost);
    setEditor(nextEditor);
    setEditorBaseline(nextEditor);
  }, [isEditorOpen, selectedPost]);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== editor.bodyHtml) {
      editorRef.current.innerHTML = editor.bodyHtml;
    }
  }, [editor.bodyHtml]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const query = buildPostListQuery(accessToken, filters);
        const result = await blogRequest(`/api/blog/posts${query}`, {
          headers: headersForToken(accessToken),
        });
        if (ignore) {
          return;
        }
        setPosts(result.items || []);
        setViewer(result.viewer || DEFAULT_VIEWER);
        const requested = (result.items || []).find((item) => item.slug === articleSlug);
        const existingSelection = (result.items || []).find((item) => item.id === selectedId);
        const nextSelected = requested?.id || existingSelection?.id || '';
        setSelectedId(nextSelected);
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [accessToken, articleSlug, filters]);

  useEffect(() => {
    if (!canManagePosts || !selectedPost || isCreating) {
      setHistoryEntries([]);
      return;
    }

    let ignore = false;

    async function loadHistory() {
      try {
        const result = await blogRequest(`/api/blog/posts/${selectedPost.id}/history?limit=20`, {
          headers: headersForToken(accessToken),
        });
        if (!ignore) {
          setHistoryEntries(result.items || []);
        }
      } catch {
        if (!ignore) {
          setHistoryEntries([]);
        }
      }
    }

    loadHistory();

    return () => {
      ignore = true;
    };
  }, [accessToken, canManagePosts, isCreating, selectedPost]);

  useEffect(() => {
    if (!canManagePosts) {
      setDashboard(null);
      return;
    }

    let ignore = false;

    async function loadDashboard() {
      try {
        const suffix = selectedPost && !isCreating ? `?post_id=${selectedPost.id}` : '';
        const result = await blogRequest(`/api/blog/dashboard${suffix}`, {
          headers: headersForToken(accessToken),
        });
        if (!ignore) {
          setDashboard(result.dashboard || null);
        }
      } catch {
        if (!ignore) {
          setDashboard(null);
        }
      }
    }

    loadDashboard();

    return () => {
      ignore = true;
    };
  }, [accessToken, canManagePosts, isCreating, selectedPost]);

  useEffect(() => {
    if (!isArticleRoute || !selectedPost || selectedPost.locked) {
      viewedPostIdRef.current = '';
      return;
    }
    if (viewedPostIdRef.current === selectedPost.id) {
      return;
    }
    viewedPostIdRef.current = selectedPost.id;
    engage('view', buildAnalyticsContext());
  }, [isArticleRoute, selectedPost?.id, selectedPost?.locked]);

  useEffect(() => {
    syncArchiveRailState();
  }, [archivePosts.length]);

  useEffect(() => {
    const rail = archiveListRef.current;
    if (!rail) {
      return undefined;
    }

    const handleArchiveScroll = () => {
      syncArchiveRailState();
    };

    syncArchiveRailState();
    rail.addEventListener('scroll', handleArchiveScroll, { passive: true });
    window.addEventListener('resize', handleArchiveScroll);

    return () => {
      rail.removeEventListener('scroll', handleArchiveScroll);
      window.removeEventListener('resize', handleArchiveScroll);
    };
  }, [archivePosts.length]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false);
      }
      if (!event.target.closest('.header-right')) {
        setMenuOpen(false);
      }
      if (!event.target.closest('.tt-action-menu-shell')) {
        setOpenActionMenu('');
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setAccountMenuOpen(false);
        setOpenActionMenu('');
      }
    };

    const handlePopState = () => {
      setArticleSlug(readRequestedPostSlug());
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!isEditorOpen || !isEditorDirty) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isEditorDirty, isEditorOpen]);

  const confirmDiscardUnsavedChanges = () => {
    if (!isEditorOpen || !isEditorDirty) {
      return true;
    }
    return window.confirm('You have unsaved article changes. Discard them and continue?');
  };

  const handleEditorInput = () => {
    setEditor((current) => ({
      ...current,
      bodyHtml: editorRef.current?.innerHTML || '',
    }));
  };

  const applyFormat = (command) => {
    editorRef.current?.focus();
    if (command === 'createLink') {
      const href = window.prompt('Paste the link URL');
      if (!href) {
        return;
      }
      document.execCommand(command, false, href);
    } else if (command === 'formatBlock') {
      document.execCommand(command, false, 'blockquote');
    } else {
      document.execCommand(command, false);
    }
    handleEditorInput();
  };

  const alignSelectedImage = (alignment) => {
    editorRef.current?.focus();
    if (!setImageAlignmentInEditor(editorRef.current, alignment)) {
      setError('Place the cursor inside an inline image block before changing its alignment.');
      return;
    }
    handleEditorInput();
    setError('');
  };

  const beginNewPost = () => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
    const nextEditor = {
      ...EMPTY_EDITOR,
      bodyHtml: '<p>Start writing here...</p>',
    };
    setEditorMode('create');
    setArticleSlug('');
    setSelectedId('');
    setOpenActionMenu('');
    setEditor(nextEditor);
    setEditorBaseline(nextEditor);
    syncThinkTankUrl('');
  };

  const selectPost = (postId, options = {}) => {
    const { closeEditor = true } = options;
    if (closeEditor && !confirmDiscardUnsavedChanges()) {
      return;
    }
    setSelectedId(postId);
    if (closeEditor) {
      setEditorMode('idle');
    }
    setOpenActionMenu('');
  };

  const openPost = (post, options = {}) => {
    const { closeEditor = true } = options;
    if (!post?.id || !post?.slug) {
      return;
    }
    if (closeEditor && !confirmDiscardUnsavedChanges()) {
      return;
    }
    setSelectedId(post.id);
    setArticleSlug(post.slug);
    if (closeEditor) {
      setEditorMode('idle');
    }
    setOpenActionMenu('');
    syncThinkTankUrl(post.slug, { push: true });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const closeArticleView = () => {
    setArticleSlug('');
    setSelectedId('');
    setOpenActionMenu('');
    syncThinkTankUrl('', { push: true });
    window.requestAnimationFrame(() => {
      document.querySelector('.tt-bento-board, .tt-empty-state')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const openEditorForPost = (post) => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
    const nextEditor = blocksToEditor(post);
    setSelectedId(post.id);
    setEditorMode('edit');
    setOpenActionMenu('');
    setEditor(nextEditor);
    setEditorBaseline(nextEditor);
    window.requestAnimationFrame(() => {
      document.getElementById('tt-admin')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const updateTags = (nextTags) => {
    setEditor((current) => ({
      ...current,
      tags: nextTags.join(', '),
    }));
  };

  const removeTag = (tagToRemove) => {
    updateTags(splitTags(editor.tags).filter((tag) => tag !== tagToRemove));
  };

  const fetchPreview = async (url, target) => {
    if (!url) {
      return;
    }
    try {
      const result = await blogRequest(`/api/blog/link-preview?url=${encodeURIComponent(url)}`);
      setEditor((current) => ({
        ...current,
        [target]: result.item,
      }));
    } catch (previewError) {
      setError(previewError.message);
    }
  };

  const handleHeroImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Select an image file for the hero artwork.');
      return;
    }
    try {
      const imageDataUrl = await readImageFileAsDataUrl(file);
      setHeroCropSource(imageDataUrl);
      setHeroCropPosition({ x: 0, y: 0 });
      setHeroCropZoom(1);
      setHeroCropAreaPixels(null);
      setHeroCropOpen(true);
      setError('');
    } catch (uploadError) {
      setError(uploadError.message);
    }
  };

  const handleAttachmentUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selectedFiles.length) {
      return;
    }
    try {
      const uploadedAttachments = await Promise.all(
        selectedFiles.map(async (file) => {
          const attachmentId = `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const mimeType = file.type || 'application/octet-stream';
          if (file.size > INLINE_ATTACHMENT_LIMIT_BYTES) {
            const result = await blogRequest(
              `/api/blog/uploads?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(mimeType)}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': mimeType,
                  ...headersForToken(accessToken),
                },
                body: file,
              },
            );
            return {
              id: attachmentId,
              createdAt: new Date().toISOString(),
              ...result.item,
            };
          }
          return {
            id: attachmentId,
            kind: 'historical-data',
            storageKind: 'inline',
            fileName: file.name,
            mimeType,
            sizeBytes: file.size || 0,
            blobUrl: '',
            blobDownloadUrl: '',
            blobPath: '',
            contentData: await readFileAsDataUrl(file),
            createdAt: new Date().toISOString(),
          };
        }),
      );
      setEditor((current) => ({
        ...current,
        attachments: [...(Array.isArray(current.attachments) ? current.attachments : []), ...uploadedAttachments],
      }));
      setError('');
    } catch (uploadError) {
      setError(uploadError.message || 'Unable to store the selected attachment.');
    }
  };

  const removeAttachment = (attachmentId) => {
    setEditor((current) => ({
      ...current,
      attachments: (Array.isArray(current.attachments) ? current.attachments : []).filter((attachment) => attachment.id !== attachmentId),
    }));
  };

  const saveHeroCrop = async () => {
    if (!heroCropSource || !heroCropAreaPixels) {
      setError('Move and crop the uploaded image before saving it.');
      return;
    }
    try {
      const croppedDataUrl = await getCroppedImageDataUrl(heroCropSource, heroCropAreaPixels);
      setEditor((current) => ({
        ...current,
        heroImage: croppedDataUrl,
      }));
      setHeroCropOpen(false);
      setHeroCropSource('');
      setHeroCropAreaPixels(null);
      setError('');
    } catch (cropError) {
      setError(cropError.message);
    }
  };

  const cancelHeroCrop = () => {
    setHeroCropOpen(false);
    setHeroCropSource('');
    setHeroCropAreaPixels(null);
    setHeroCropPosition({ x: 0, y: 0 });
    setHeroCropZoom(1);
  };

  const handleComposerImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Select an image file for the composer image block.');
      return;
    }
    try {
      const imageDataUrl = await readImageFileAsDataUrl(file);
      setComposerDrafts((current) => ({
        ...current,
        imageUrl: imageDataUrl,
        imageAlt: current.imageAlt || file.name.replace(/\.[^.]+$/, ''),
      }));
      setActiveComposerTool('image');
      setError('');
    } catch (uploadError) {
      setError(uploadError.message);
    }
  };

  const resetComposerDraft = (tool = activeComposerTool) => {
    setComposerDrafts((current) => {
      switch (tool) {
        case 'heading1':
          return { ...current, heading1: DEFAULT_COMPOSER_DRAFTS.heading1 };
        case 'heading2':
          return { ...current, heading2: DEFAULT_COMPOSER_DRAFTS.heading2 };
        case 'quote':
          return { ...current, quote: DEFAULT_COMPOSER_DRAFTS.quote };
        case 'callout':
          return {
            ...current,
            calloutTitle: DEFAULT_COMPOSER_DRAFTS.calloutTitle,
            calloutBody: DEFAULT_COMPOSER_DRAFTS.calloutBody,
          };
        case 'image':
          return { ...current, imageUrl: '', imageAlt: '', imageAlignment: DEFAULT_COMPOSER_DRAFTS.imageAlignment };
        case 'video':
          return { ...current, videoUrl: '' };
        case 'source':
          return { ...current, sourceUrl: '', sourceLabel: '' };
        default:
          return current;
      }
    });
  };

  const insertEditorSnippet = (snippet) => {
    if (!snippet) {
      setError('Add content or a URL before inserting that block.');
      return;
    }
    if (editorRef.current) {
      editorRef.current.focus();
      const inserted = document.execCommand('insertHTML', false, snippet);
      if (!inserted) {
        editorRef.current.innerHTML = `${editorRef.current.innerHTML}${snippet}`;
      }
      handleEditorInput();
      setError('');
    }
  };

  const handleComposerInsert = (tool = activeComposerTool) => {
    const snippet = buildComposerSnippet(tool, composerDrafts);
    if (!snippet) {
      insertEditorSnippet(snippet);
      return;
    }
    insertEditorSnippet(snippet);
    resetComposerDraft(tool);
  };

  const handleComposerDragStart = (event, tool) => {
    event.dataTransfer.setData('text/piceus-composer-tool', tool);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const handleComposerDrop = (event) => {
    event.preventDefault();
    const tool = event.dataTransfer.getData('text/piceus-composer-tool');
    if (!tool) {
      return;
    }
    insertEditorSnippet(buildComposerSnippet(tool, composerDrafts));
  };

  const handleComposerDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const persistEditorState = async (nextEditor) => {
    setSaving(true);
    setError('');
    try {
      const payload = editorToPayload(nextEditor, session.user);
      const isEditingExisting = editorMode === 'edit' && !!payload.id;
      const requestPayload = isEditingExisting ? payload : { ...payload, id: '' };
      const method = isEditingExisting ? 'PUT' : 'POST';
      const path = isEditingExisting ? `/api/blog/posts/${payload.id}` : '/api/blog/posts';
      const result = await blogRequest(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headersForToken(accessToken),
        },
        body: JSON.stringify(requestPayload),
      });
      const refreshed = await blogRequest('/api/blog/posts?include_drafts=true', {
        headers: headersForToken(accessToken),
      });
      setPosts(upsertPostInList(refreshed.items, result.item));
      setViewer(refreshed.viewer || DEFAULT_VIEWER);
      setSelectedId(result.item.id);
      setEditorMode('idle');
      setOpenActionMenu('');
      const refreshedEditor = blocksToEditor(result.item);
      setEditor(refreshedEditor);
      setEditorBaseline(refreshedEditor);
      return result.item;
    } catch (saveError) {
      setError(saveError.message);
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const savePost = async () => {
    try {
      const nextEditor = snapshotEditorState(editor);
      setEditor(nextEditor);
      await persistEditorState(nextEditor);
    } catch {
      // Error is already surfaced in state.
    }
  };

  const updatePostAudience = async (post, audience) => {
    const nextEditor = {
      ...snapshotEditorState(blocksToEditor(post)),
      audience,
    };
    setEditor(nextEditor);
    try {
      await persistEditorState(nextEditor);
    } catch {
      // Error is already surfaced in state.
    }
  };

  const deletePostById = async (post) => {
    if (!post?.id || !window.confirm(`Archive ${post.title || 'this article'}? It will be removed from live shelves but kept for recovery.`)) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      await blogRequest(`/api/blog/posts/${post.id}`, {
        method: 'DELETE',
        headers: headersForToken(accessToken),
      });
      const refreshed = await blogRequest('/api/blog/posts?include_drafts=true', {
        headers: headersForToken(accessToken),
      });
      setPosts(refreshed.items || []);
      setViewer(refreshed.viewer || DEFAULT_VIEWER);
      setSelectedId('');
      setEditorMode('idle');
      setOpenActionMenu('');
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const restorePostById = async (post) => {
    if (!post?.id) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await blogRequest(`/api/blog/posts/${post.id}/restore`, {
        method: 'POST',
        headers: headersForToken(accessToken),
      });
      const refreshed = await blogRequest('/api/blog/posts?include_drafts=true&include_deleted=true', {
        headers: headersForToken(accessToken),
      });
      setPosts(upsertPostInList(refreshed.items, result.item));
      setViewer(refreshed.viewer || DEFAULT_VIEWER);
      setSelectedId(result.item.id);
      setOpenActionMenu('');
    } catch (restoreError) {
      setError(restoreError.message);
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    if (isEditorDirty && !window.confirm('Discard your unsaved article changes and close the editor?')) {
      return;
    }
    if (isCreating) {
      if (selectedPost) {
        const nextEditor = blocksToEditor(selectedPost);
        setEditor(nextEditor);
        setEditorBaseline(nextEditor);
        setEditorMode('idle');
        return;
      }
      const nextEditor = {
        ...EMPTY_EDITOR,
        bodyHtml: '<p>Start writing here...</p>',
      };
      setEditor(nextEditor);
      setEditorBaseline(nextEditor);
      setEditorMode('idle');
      return;
    }
    setEditor(editorBaseline);
    setEditorMode('idle');
    setOpenActionMenu('');
  };

  const engage = async (action, context = {}) => {
    if (!selectedPost) {
      return;
    }
    if (action !== 'view' && !canInteract) {
      setError('Member access is required to like, share, or comment. Use the avatar menu in the top right to sign in.');
      return;
    }
    try {
      const result = await blogRequest(`/api/blog/posts/${selectedPost.id}/engagement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersForToken(accessToken),
        },
        body: JSON.stringify({ action, context }),
      });
      setPosts((current) => current.map((post) => (post.id === result.item.id ? result.item : post)));
      if (action === 'share') {
        const shareUrl = buildPostUrl(selectedPost.slug);
        if (navigator.share) {
          await navigator.share({ title: selectedPost.title, url: shareUrl });
        } else {
          await navigator.clipboard.writeText(shareUrl);
        }
      }
    } catch (engageError) {
      setError(engageError.message);
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    if (!selectedPost) {
      return;
    }
    if (!canInteract) {
      setError('Member access is required to join the conversation. Use the avatar menu in the top right to sign in.');
      return;
    }
    try {
      const result = await blogRequest(`/api/blog/posts/${selectedPost.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersForToken(accessToken),
        },
        body: JSON.stringify({
          authorName: viewer.name,
          body: commentBody,
          context: buildAnalyticsContext(),
        }),
      });
      setPosts((current) => current.map((post) => (post.id === result.item.id ? result.item : post)));
      setCommentBody('');
    } catch (commentError) {
      setError(commentError.message);
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters(draftFilters);
  };

  const applyCategoryFilter = (category) => {
    const nextCategory = category === 'All' ? 'all' : category;
    setDraftFilters((current) => ({ ...current, category: nextCategory }));
    setFilters((current) => ({ ...current, category: nextCategory }));
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  };

  const jumpToConversation = () => {
    if (!selectedPost || selectedPost.locked) {
      return;
    }
    document.getElementById('tt-conversation')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    commentInputRef.current?.focus();
  };

  const handleSharePost = async (post) => {
    try {
      await sharePostFromCard(post);
      setOpenActionMenu('');
    } catch (shareError) {
      if (shareError?.name === 'AbortError') {
        return;
      }
      setError(shareError.message || 'Unable to share this article right now.');
    }
  };

  const handleSavePdf = (post) => {
    try {
      savePostAsPdf(post);
      setOpenActionMenu('');
    } catch (pdfError) {
      setError(pdfError.message || 'Unable to open the article for PDF export.');
    }
  };

  const renderArticleActions = (post, menuKey) => {
    if (!post) {
      return null;
    }
    const isOpen = openActionMenu === menuKey;
    return (
      <div className="tt-action-menu-shell" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="tt-action-menu-trigger"
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={() => setOpenActionMenu((current) => (current === menuKey ? '' : menuKey))}
        >
          <span aria-hidden="true">•••</span>
          <span className="tt-action-menu-label">Open actions menu</span>
        </button>
        {isOpen ? (
          <div className="tt-action-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => openPost(post)}>Open article</button>
            {!post.deletedAt ? <button type="button" role="menuitem" onClick={() => handleSharePost(post)}>Share article</button> : null}
            {!post.deletedAt ? <button type="button" role="menuitem" onClick={() => handleSavePdf(post)}>Save PDF / Print</button> : null}
            {!post.deletedAt ? <button type="button" role="menuitem" onClick={() => window.open(buildPostUrl(post.slug), '_blank', 'noopener,noreferrer')}>Open live</button> : null}
            {canManagePosts ? <button type="button" role="menuitem" onClick={() => openEditorForPost(post)}>Edit Article</button> : null}
            {canManagePosts ? <button type="button" role="menuitem" onClick={beginNewPost}>New Article</button> : null}
            {canManagePosts && !post.deletedAt ? <button type="button" role="menuitem" onClick={() => updatePostAudience(post, 'public')}>Privacy: Public</button> : null}
            {canManagePosts && !post.deletedAt ? <button type="button" role="menuitem" onClick={() => updatePostAudience(post, 'members')}>Privacy: Members only</button> : null}
            {canManagePosts && !post.deletedAt ? <button type="button" role="menuitem" onClick={() => updatePostAudience(post, 'private')}>Privacy: Private</button> : null}
            {canManagePosts && post.deletedAt ? (
              <button type="button" role="menuitem" onClick={() => restorePostById(post)}>Restore article</button>
            ) : null}
            {canManagePosts && !post.deletedAt ? (
              <button type="button" role="menuitem" className="danger" onClick={() => deletePostById(post)}>Archive article</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="tt-shell">
      <a className="skip" href="#main">Skip to content</a>
      <header>
        <a className="brand" href="/#home" aria-label="PICEUS Home"><img src={piceusLogoUrl} alt="PICEUS" /></a>
        <div className="header-right">
          <button
            type="button"
            className="menu"
            aria-expanded={menuOpen}
            aria-controls="navigation"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span aria-hidden="true">|||</span>
            Menu
          </button>
          <nav id="navigation" className={menuOpen ? 'open' : ''} aria-label="Main navigation">
            {THINK_TANK_NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`${item.className || ''}${item.id === 'thinktank' ? `${item.className ? ' ' : ''}active` : ''}`}
                aria-current={item.id === 'thinktank' ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {canManagePosts ? <a className="button outline dark-outline tt-admin-jump" href="#tt-admin">Admin</a> : null}
          <div className="account-menu" ref={accountMenuRef}>
            <button
              type="button"
              className={`account-trigger${accountMenuOpen ? ' open' : ''}`}
              aria-expanded={accountMenuOpen}
              aria-controls="account-dropdown"
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              <span className="account-avatar">{getUserInitials(session.user?.name || 'PICEUS')}</span>
              <span className="account-meta">
                <strong>{session.authenticated ? (session.user?.name || 'PICEUS account') : 'Ecosystem Access'}</strong>
                <small>{session.authenticated ? 'Connected' : `${matrixProductName} Sign In`}</small>
              </span>
            </button>
            {accountMenuOpen ? (
              <ThinkTankAccountMenu
                accountSelfServiceEnabled={accountSelfServiceEnabled}
                authError={sessionState.error}
                authenticated={session.authenticated}
                loading={sessionState.loading}
                matrixProductName={matrixProductName}
                onClearError={sessionState.clearError}
                onLogin={async (identifier, password) => {
                  setError('');
                  await onLogin(identifier, password);
                  setAccountMenuOpen(false);
                }}
                onLogout={async () => {
                  setAccountMenuOpen(false);
                  await onLogout();
                }}
                platformLinks={platformLinks}
                showAdminLink={canManagePosts}
                user={session.user}
              />
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" className="tt-main">
        <aside className="tt-sidebar">
          <div className="tt-sidebar-head">
            <span className="tt-kicker">Blog Journal</span>
            {canManagePosts ? <button type="button" className="button primary tt-nowrap-button" onClick={beginNewPost}>New article</button> : null}
          </div>
          <h1 className="tt-sidebar-title">ThinkTank</h1>
          <form className="tt-filter-panel" onSubmit={applyFilters}>
            <span className="tt-kicker">Archive search</span>
            <div className="tt-filter-grid">
              <label>
                Title
                <input value={draftFilters.title} onChange={(event) => setDraftFilters((current) => ({ ...current, title: event.target.value }))} placeholder="Search article titles" />
              </label>
              <label>
                Author
                <input value={draftFilters.author} onChange={(event) => setDraftFilters((current) => ({ ...current, author: event.target.value }))} placeholder="Author name" />
              </label>
              <label>
                Status
                <select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="all">All</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              <label>
                Audience
                <select value={draftFilters.audience} onChange={(event) => setDraftFilters((current) => ({ ...current, audience: event.target.value }))}>
                  <option value="all">All</option>
                  <option value="public">Public</option>
                  <option value="members">Members only</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label>
                Category
                <select value={draftFilters.category} onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value }))}>
                  <option value="all">All</option>
                  {categories.map((category) => (
                    <option key={`filter-category-${category}`} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Date from
                <input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
              </label>
              <label>
                Date to
                <input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} />
              </label>
            </div>
            <div className="tt-filter-actions">
              <button type="submit" className="button primary">Apply filters</button>
              <button type="button" className="button outline dark-outline" onClick={resetFilters}>Reset</button>
            </div>
          </form>
          <div className="tt-sidebar-section-head">
            <div className="tt-sidebar-section-meta">
              <span className="tt-kicker">Archive stack</span>
              <strong>{posts.length} saved articles</strong>
            </div>
            <div className="tt-archive-nav" aria-label="Archive navigation controls">
              <button type="button" className="tt-archive-nav-button" aria-label="Scroll archive back" onClick={() => scrollArchiveRail(-1)} disabled={!archiveCanScrollBack}>
                <span className="tt-archive-nav-glyph" aria-hidden="true">&lt;</span>
              </button>
              <button type="button" className="tt-archive-nav-button" aria-label="Scroll archive next" onClick={() => scrollArchiveRail(1)} disabled={!archiveCanScrollNext}>
                <span className="tt-archive-nav-glyph" aria-hidden="true">&gt;</span>
              </button>
            </div>
          </div>
          <div className="tt-post-list" ref={archiveListRef}>
            {archivePosts.map((post) => (
              <article
                key={post.id}
                className={`tt-post-card${selectedPost?.id === post.id ? ' active' : ''}`}
              >
                {renderArticleActions(post, `list-${post.id}`)}
                <button
                  type="button"
                  className="tt-card-hit"
                  onClick={() => openPost(post)}
                >
                <span className="tt-post-meta">{visibilityLabel(post)} · {post.status === 'published' ? 'Published' : 'Draft'}</span>
                <span className="tt-category-pill">{categoryLabel(post)}</span>
                <strong>{post.title}</strong>
                <span>{truncatePreview(post.excerpt)}</span>
                </button>
              </article>
            ))}
          </div>
        </aside>

        <section className="tt-stage">
          {loading ? <p className="tt-state">Loading the think tank…</p> : null}
          {!loading && error ? <p className="tt-error tt-state">{error}</p> : null}
          {!loading && !posts.length && !isCreating ? (
            <section className="tt-empty-state tt-bento-board">
              <div>
                <span className="tt-kicker">ThinkTank landing</span>
                <h2>The feed is ready for its first story.</h2>
              </div>
              <p>
                {canManagePosts
                  ? 'This page is live and waiting for its first published article. Start a new piece now, or open an existing draft and publish when it is ready.'
                  : 'New research, essays, and editorial pieces will appear here soon. Check back as the ThinkTank begins publishing.'}
              </p>
              {canManagePosts ? (
                <div className="tt-admin-library-actions">
                  <button type="button" className="button primary tt-nowrap-button" onClick={beginNewPost}>New article</button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!loading && !isCreating && featuredPost && !isArticleRoute ? (
            <section className="tt-bento-board tt-landing-board">
              <div className="tt-bento-head">
                <div>
                  <span className="tt-kicker">Latest and recent</span>
                  <h2>ThinkTank Feed</h2>
                </div>
                {canManagePosts ? <button type="button" className="button primary tt-nowrap-button" onClick={beginNewPost}>New article</button> : null}
              </div>
              <div className="tt-category-row" role="tablist" aria-label="Article categories">
                <button type="button" className={`tt-category-chip${filters.category === 'all' ? ' active' : ''}`} onClick={() => applyCategoryFilter('All')}>All</button>
                {categories.map((category) => (
                  <button key={`category-chip-${category}`} type="button" className={`tt-category-chip${filters.category === category ? ' active' : ''}`} onClick={() => applyCategoryFilter(category)}>{category}</button>
                ))}
              </div>
              <article
                className="tt-landing-hero"
                style={featuredPost.coverImage ? { backgroundImage: `linear-gradient(135deg, rgba(16,18,24,0.58), rgba(16,18,24,0.24)), url(${featuredPost.coverImage})` } : undefined}
              >
                {renderArticleActions(featuredPost, `landing-hero-${featuredPost.id}`)}
                <button type="button" className="tt-landing-hero-hit" onClick={() => openPost(featuredPost)}>
                  <div className="tt-landing-hero-copy">
                    <span className="tt-post-meta">Latest post · {visibilityLabel(featuredPost)}</span>
                    <span className="tt-category-pill">{categoryLabel(featuredPost)}</span>
                    <strong>{featuredPost.title}</strong>
                    <p>{truncatePreview(featuredPost.excerpt, 220)}</p>
                    {featuredPost.tags?.length ? <div className="tt-tag-row">{featuredPost.tags.slice(0, 3).map((tag) => <span key={`${featuredPost.id}-hero-${tag}`} className="tt-tag-pill">{tag}</span>)}</div> : null}
                    <small>{featuredPost.authorName} · {formatTimestamp(featuredPost.publishedAt || featuredPost.updatedAt)}</small>
                  </div>
                </button>
              </article>
            </section>
          ) : null}

          {!loading && !isCreating && !isArticleRoute && landingGridPosts.length ? (
            <section className="tt-library-board">
              <div className="tt-bento-head">
                <div>
                  <span className="tt-kicker">Recommended</span>
                  <h2 className="tt-library-title">Recommended Articles</h2>
                </div>
                <p className="tt-library-copy">Get updates on recent PICEUS ThinkTank Activity.</p>
              </div>
              <div className="tt-library-grid">
                {landingGridPosts.map((post) => (
                  <article key={`library-${post.id}`} className="tt-feed-card tt-library-card">
                    {renderArticleActions(post, `library-${post.id}`)}
                    <button type="button" className={`tt-card-hit${post.coverImage ? '' : ' tt-card-hit-no-cover'}`} onClick={() => openPost(post)}>
                      {post.coverImage ? <div className="tt-feed-cover" style={{ backgroundImage: `url(${post.coverImage})` }} /> : null}
                      <div className="tt-feed-content">
                        <span className="tt-post-meta">Recent · {visibilityLabel(post)}</span>
                        <span className="tt-category-pill">{categoryLabel(post)}</span>
                        <strong>{post.title}</strong>
                        <p>{truncatePreview(post.excerpt, 180)}</p>
                        {post.tags?.length ? <div className="tt-tag-row">{post.tags.slice(0, 3).map((tag) => <span key={`${post.id}-library-${tag}`} className="tt-tag-pill">{tag}</span>)}</div> : null}
                        <small>{post.authorName} · {formatTimestamp(post.publishedAt || post.updatedAt)}</small>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {!loading && !isCreating && !isArticleRoute && showRecommendedPanel && recommendedPosts.length ? (
            <section className="tt-widget-board">
              <div className="tt-widget-column">
                <div className="tt-sidebar-section-head">
                  <span className="tt-kicker">Recommended</span>
                  <strong>{recommendedPosts.length} picks</strong>
                </div>
                <div className="tt-widget-list">
                  {recommendedPosts.map((post) => (
                    <article key={`recommended-${post.id}`} className="tt-widget-card">
                      {renderArticleActions(post, `recommended-${post.id}`)}
                      <button type="button" className={`tt-card-hit${post.coverImage ? '' : ' tt-card-hit-no-cover'}`} onClick={() => openPost(post)}>
                        {post.coverImage ? <div className="tt-feed-cover" style={{ backgroundImage: `url(${post.coverImage})` }} /> : null}
                        <div className="tt-feed-content">
                          <span className="tt-post-meta">Recommended · {visibilityLabel(post)}</span>
                          <span className="tt-category-pill">{categoryLabel(post)}</span>
                          <strong>{post.title}</strong>
                          <p>{truncatePreview(post.excerpt, 140)}</p>
                        </div>
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {showAdminOverviewPanels && dashboard ? (
            <section className="tt-dashboard-panel">
              <div className="tt-dashboard-head">
                <div>
                  <span className="tt-kicker">Analytics dashboard</span>
                  <h2>Views, audience, and feed signals</h2>
                </div>
              </div>
              <div className="tt-dashboard-grid">
                <article className="tt-metric-card"><span>Views</span><strong>{dashboard.summary?.views || 0}</strong></article>
                <article className="tt-metric-card"><span>Distinct readers</span><strong>{dashboard.summary?.distinctReaders || 0}</strong></article>
                <article className="tt-metric-card"><span>Member reads</span><strong>{dashboard.summary?.memberReads || 0}</strong></article>
                <article className="tt-metric-card"><span>Authenticated reads</span><strong>{dashboard.summary?.authenticatedReads || 0}</strong></article>
                <article className="tt-metric-card"><span>Likes</span><strong>{dashboard.summary?.likes || 0}</strong></article>
                <article className="tt-metric-card"><span>Comments</span><strong>{dashboard.summary?.comments || 0}</strong></article>
              </div>
              <div className="tt-dashboard-columns">
                <div className="tt-dashboard-card">
                  <span className="tt-kicker">Top sources</span>
                  <div className="tt-dashboard-list">
                    {(dashboard.topReferrers || []).map((item) => (
                      <article key={`${item.source}-${item.reads}`} className="tt-dashboard-item">
                        <strong>{item.source}</strong>
                        <span>{item.reads} reads</span>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="tt-dashboard-card">
                  <span className="tt-kicker">Recent readers</span>
                  <div className="tt-dashboard-list">
                    {(dashboard.recentReaders || []).map((item) => (
                      <article key={item.eventId} className="tt-dashboard-item">
                        <strong>{item.name}</strong>
                        <span>{item.member ? 'Member' : item.authenticated ? 'Authenticated' : 'Guest'} · {item.source}</span>
                        <small>{item.locale || 'Unknown locale'} · {item.deviceType || 'Unknown device'} · {formatTimestamp(item.createdAt)}</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {showAdminOverviewPanels ? (
            <section className="tt-admin-library">
              <div className="tt-admin-library-head">
                <div>
                  <span className="tt-kicker">Admin library</span>
                  <h2>All posts and article history</h2>
                  <p>Use this grid to inspect titles, status, audience, last updates, and jump straight into view or edit flows. Private and members-only saves stay in the admin shelves even when they do not appear in the public feed.</p>
                  <p className="tt-admin-note">Use the visible ellipsis menu on each card or row for edit, archive, restore, and privacy changes.</p>
                </div>
                <div className="tt-admin-library-actions">
                  <button type="button" className="button primary tt-nowrap-button" onClick={beginNewPost}>New article</button>
                  {selectedPost ? <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={() => openEditorForPost(selectedPost)}>Edit selected</button> : null}
                </div>
              </div>
              <div className="tt-admin-shelf-grid">
                <section className="tt-admin-shelf">
                  <div className="tt-sidebar-section-head">
                    <span className="tt-kicker">Draft shelf</span>
                    <strong>{adminDraftPosts.length} saved off-feed</strong>
                  </div>
                  {adminDraftPosts.length ? (
                    <div className="tt-admin-library-grid" role="list">
                      {adminDraftPosts.map((post) => (
                        <article key={`admin-draft-${post.id}`} className={`tt-admin-row${selectedPost?.id === post.id ? ' active' : ''}`} role="listitem">
                          {renderArticleActions(post, `admin-draft-${post.id}`)}
                          <div className="tt-admin-row-main">
                            <button type="button" className="tt-admin-row-title" onClick={() => selectPost(post.id)}>
                              {post.title || 'Untitled article'}
                            </button>
                            <p>{truncatePreview(post.excerpt, 180) || 'No excerpt written yet.'}</p>
                          </div>
                          <div className="tt-admin-row-meta">
                            <span><strong>Category</strong>{categoryLabel(post)}</span>
                            <span><strong>Status</strong>{post.status === 'published' ? 'Live' : 'Draft'}</span>
                            <span><strong>Audience</strong>{visibilityLabel(post)}</span>
                            <span><strong>Updated</strong>{formatTimestamp(post.updatedAt)}</span>
                            <span><strong>Published</strong>{post.publishedAt ? formatTimestamp(post.publishedAt) : 'Not published'}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="tt-history-empty">No private, members-only, or draft articles are currently saved.</p>
                  )}
                </section>

                <section className="tt-admin-shelf">
                  <div className="tt-sidebar-section-head">
                    <span className="tt-kicker">Public feed shelf</span>
                    <strong>{adminPublishedPosts.length} live articles</strong>
                  </div>
                  {adminPublishedPosts.length ? (
                    <div className="tt-admin-library-grid" role="list">
                      {adminPublishedPosts.map((post) => (
                        <article key={`admin-published-${post.id}`} className={`tt-admin-row${selectedPost?.id === post.id ? ' active' : ''}`} role="listitem">
                          {renderArticleActions(post, `admin-published-${post.id}`)}
                          <div className="tt-admin-row-main">
                            <button type="button" className="tt-admin-row-title" onClick={() => selectPost(post.id)}>
                              {post.title || 'Untitled article'}
                            </button>
                            <p>{truncatePreview(post.excerpt, 180) || 'No excerpt written yet.'}</p>
                          </div>
                          <div className="tt-admin-row-meta">
                            <span><strong>Category</strong>{categoryLabel(post)}</span>
                            <span><strong>Status</strong>{post.status === 'published' ? 'Live' : 'Draft'}</span>
                            <span><strong>Audience</strong>{visibilityLabel(post)}</span>
                            <span><strong>Updated</strong>{formatTimestamp(post.updatedAt)}</span>
                            <span><strong>Published</strong>{post.publishedAt ? formatTimestamp(post.publishedAt) : 'Not published'}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="tt-history-empty">No public published articles are live yet.</p>
                  )}
                </section>

                <section className="tt-admin-shelf">
                  <div className="tt-sidebar-section-head">
                    <span className="tt-kicker">Archived shelf</span>
                    <strong>{adminArchivedPosts.length} recoverable articles</strong>
                  </div>
                  {adminArchivedPosts.length ? (
                    <div className="tt-admin-library-grid" role="list">
                      {adminArchivedPosts.map((post) => (
                        <article key={`admin-archived-${post.id}`} className={`tt-admin-row${selectedPost?.id === post.id ? ' active' : ''}`} role="listitem">
                          {renderArticleActions(post, `admin-archived-${post.id}`)}
                          <div className="tt-admin-row-main">
                            <button type="button" className="tt-admin-row-title" onClick={() => selectPost(post.id)}>
                              {post.title || 'Untitled article'}
                            </button>
                            <p>{truncatePreview(post.excerpt, 180) || 'No excerpt written yet.'}</p>
                          </div>
                          <div className="tt-admin-row-meta">
                            <span><strong>Category</strong>{categoryLabel(post)}</span>
                            <span><strong>Status</strong>Archived</span>
                            <span><strong>Audience</strong>{visibilityLabel(post)}</span>
                            <span><strong>Updated</strong>{formatTimestamp(post.updatedAt)}</span>
                            <span><strong>Archived</strong>{formatTimestamp(post.deletedAt)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="tt-history-empty">No archived articles are waiting for recovery.</p>
                  )}
                </section>
              </div>
              <div className="tt-admin-library-grid" role="list">
                {posts.map((post) => (
                  <article key={`admin-library-${post.id}`} className={`tt-admin-row${selectedPost?.id === post.id ? ' active' : ''}`} role="listitem">
                    {renderArticleActions(post, `admin-${post.id}`)}
                    <div className="tt-admin-row-main">
                      <button type="button" className="tt-admin-row-title" onClick={() => selectPost(post.id)}>
                        {post.title || 'Untitled article'}
                      </button>
                      <p>{truncatePreview(post.excerpt, 180) || 'No excerpt written yet.'}</p>
                    </div>
                    <div className="tt-admin-row-meta">
                      <span><strong>Category</strong>{categoryLabel(post)}</span>
                      <span><strong>Status</strong>{post.deletedAt ? 'Archived' : post.status === 'published' ? 'Live' : 'Draft'}</span>
                      <span><strong>Audience</strong>{visibilityLabel(post)}</span>
                      <span><strong>Updated</strong>{formatTimestamp(post.updatedAt)}</span>
                      <span><strong>Published</strong>{post.publishedAt ? formatTimestamp(post.publishedAt) : 'Not published'}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {selectedPost && !isCreating && isArticleRoute ? (
            <article className="tt-article">
              <div className="tt-hero" style={selectedPost.coverImage ? { backgroundImage: `linear-gradient(135deg, rgba(16,18,24,0.56), rgba(16,18,24,0.22)), url(${selectedPost.coverImage})` } : undefined}>
                {renderArticleActions(selectedPost, `hero-${selectedPost.id}`)}
                <div className="tt-hero-inner">
                  <button type="button" className="button outline tt-article-back" onClick={closeArticleView}>Back to feed</button>
                  <div className="tt-hero-meta">
                    <span>{categoryLabel(selectedPost)}</span>
                    <span>{visibilityLabel(selectedPost)}</span>
                    <span>{selectedPost.authorName}</span>
                    <span>{selectedPost.authorRole}</span>
                  </div>
                  <h2>{selectedPost.title}</h2>
                  <p>{selectedPost.excerpt}</p>
                  {selectedPost.tags?.length ? <div className="tt-tag-row">{selectedPost.tags.map((tag) => <span key={`${selectedPost.id}-tag-${tag}`} className="tt-tag-pill">{tag}</span>)}</div> : null}
                </div>
              </div>
              {selectedPost.locked ? (
                <div className="tt-locked">
                  <h3>Members-only article</h3>
                  <p>This article follows the existing MATRIX membership lane. Sign in through your current access path to unlock it without changing memberships.</p>
                </div>
              ) : (
                <div className="tt-article-body tt-story-body">
                  {(selectedPost.blocks || []).map((block, index) => (
                    <div key={`${selectedPost.id}-block-${index}`} className="tt-story-block">{renderBlock(block)}</div>
                  ))}
                </div>
              )}

              {selectedPost?.attachments?.length ? (
                <section className="tt-attachments-panel">
                  <div className="tt-sidebar-section-head">
                    <span className="tt-kicker">Archive files</span>
                    <strong>{selectedPost.attachments.length} historical file{selectedPost.attachments.length === 1 ? '' : 's'}</strong>
                  </div>
                  <div className="tt-attachment-list">
                    {selectedPost.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        className="tt-attachment-item"
                        href={buildAttachmentDownloadUrl(selectedPost.id, attachment.id)}
                        download={attachment.fileName}
                      >
                        <div>
                          <strong>{attachment.fileName}</strong>
                          <small>{attachment.kind} · {attachment.storageKind === 'blob' ? 'Blob archive' : 'Inline archive'} · {formatFileSize(attachment.sizeBytes)}</small>
                        </div>
                        <span>Download</span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="tt-engagement-bar">
                <button type="button" className="tt-engagement-button" onClick={() => engage('like')} disabled={!canInteract}>
                  <img
                    src={selectedPost.engagement?.likes ? BUZZVIBE_LIKED_ICON_URL : BUZZVIBE_LIKE_ICON_URL}
                    alt=""
                    aria-hidden="true"
                    className="tt-action-icon tt-action-icon-image"
                  />
                  <span>Like</span>
                  <strong>{selectedPost.engagement?.likes || 0}</strong>
                </button>
                <button type="button" className="tt-engagement-button" onClick={jumpToConversation}>
                  <BuzzVibeCommentIcon />
                  <span>Conversation</span>
                  <strong>{selectedPost.comments?.length || 0}</strong>
                </button>
                <button type="button" className="tt-engagement-button" onClick={() => engage('share')} disabled={!canInteract}>
                  <img
                    src={BUZZVIBE_SHARE_ICON_URL}
                    alt=""
                    aria-hidden="true"
                    className="tt-action-icon tt-action-icon-image"
                  />
                  <span>Share</span>
                  <strong>{selectedPost.engagement?.shares || 0}</strong>
                </button>
              </div>

              <section id="tt-conversation" className="tt-comments">
                <h3>Conversation</h3>
                {canInteract ? (
                  <form onSubmit={submitComment} className="tt-comment-form">
                    <p className="tt-comment-identity">Commenting as {viewer.name || session.user?.name || 'Authenticated member'}</p>
                    <textarea
                      ref={commentInputRef}
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="Add a comment"
                      required
                    />
                    <button type="submit" className="button primary">Comment</button>
                  </form>
                ) : (
                  <p className="tt-comment-gate">Member access is required to like, share, and join the conversation. Use the avatar menu in the top right to sign in.</p>
                )}
                <div className="tt-comment-list">
                  {(selectedPost.comments || []).map((comment) => (
                    <article key={comment.id} className="tt-comment">
                      <strong>{comment.authorName}</strong>
                      <p>{comment.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            </article>
          ) : null}

          {canManagePosts ? (
            <section id="tt-admin" className={`tt-editor-panel${isEditorOpen ? ' tt-editor-panel-priority' : ''}`}>
              <div className="tt-editor-head">
                <div>
                  <span className="tt-kicker">Admin Studio</span>
                  <h2>{isCreating ? 'Create Article' : isEditorOpen ? 'Edit Article' : 'Article Editor'}</h2>
                  {!isEditorOpen ? <p className="tt-editor-idle-copy">Select an article from the admin library and choose edit, or create a new article to open the editor.</p> : null}
                </div>
                <div className="tt-editor-actions">
                  <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={savePost} disabled={saving || !isEditorOpen}>{saving ? 'Saving…' : 'Save / Publish'}</button>
                  <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={cancelEditing} disabled={saving}>Cancel</button>
                  <button type="button" className="button primary tt-nowrap-button" onClick={beginNewPost} disabled={saving}>New Article</button>
                </div>
              </div>

              {!isEditorOpen ? (
                <div className="tt-editor-idle-state">
                  <p>The editor is ready. Open a post from the admin library to load its full content into the body editor, or start a new article.</p>
                </div>
              ) : null}

              {isEditorOpen ? (
              <>
              <div className="tt-wysiwyg-toolbar" aria-label="Article formatting tools">
                <button type="button" onClick={() => applyFormat('bold')}>Bold</button>
                <button type="button" onClick={() => applyFormat('italic')}>Italic</button>
                <button type="button" onClick={() => applyFormat('insertUnorderedList')}>List</button>
                <button type="button" onClick={() => applyFormat('formatBlock')}>Quote</button>
                <button type="button" onClick={() => alignSelectedImage('left')}>Image left</button>
                <button type="button" onClick={() => alignSelectedImage('center')}>Image center</button>
                <button type="button" onClick={() => alignSelectedImage('right')}>Image right</button>
                <button type="button" onClick={() => handleComposerInsert('callout')}>Callout</button>
                <button type="button" onClick={() => applyFormat('createLink')}>Link</button>
              </div>

              <div className="tt-editor-grid">
                <label>
                  Title
                  <input value={editor.title} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} placeholder="Article title" />
                </label>
                <label>
                  Slug
                  <input value={editor.slug} onChange={(event) => setEditor((current) => ({ ...current, slug: event.target.value }))} placeholder="article-slug" />
                </label>
                <div className="tt-span-2">
                  <label>
                    Add or replace hero image
                    <input type="file" accept="image/*" onChange={handleHeroImageUpload} />
                  </label>
                  <p className="form-note">Upload is primary here. Use a direct URL only if you do not want to attach an image file.</p>
                  {editor.heroImage ? (
                    <div className="tt-source-card tt-editor-image-preview">
                      <img className="tt-source-thumb" src={editor.heroImage} alt="Hero preview" />
                      <div className="tt-source-copy">
                        <span className="tt-source-site">Hero image</span>
                        <strong>{isInlineImageDataUrl(editor.heroImage) ? 'Uploaded image ready' : 'Remote image URL set'}</strong>
                        <small>{isInlineImageDataUrl(editor.heroImage) ? 'This image will save directly with the article.' : editor.heroImage}</small>
                      </div>
                      {isInlineImageDataUrl(editor.heroImage) ? (
                        <button
                          type="button"
                          className="button outline dark-outline"
                          onClick={() => {
                            setHeroCropSource(editor.heroImage);
                            setHeroCropPosition({ x: 0, y: 0 });
                            setHeroCropZoom(1);
                            setHeroCropAreaPixels(null);
                            setHeroCropOpen(true);
                          }}
                        >
                          Edit crop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button outline dark-outline"
                        onClick={() => setEditor((current) => ({ ...current, heroImage: '' }))}
                      >
                        Clear image
                      </button>
                    </div>
                  ) : null}
                  <label>
                    Hero image URL fallback
                    <input
                      value={isInlineImageDataUrl(editor.heroImage) ? '' : editor.heroImage}
                      onChange={(event) => setEditor((current) => ({ ...current, heroImage: event.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                </div>
                <label className="tt-span-2">
                  Hero / inline video URL
                  <input value={editor.heroVideo} onChange={(event) => setEditor((current) => ({ ...current, heroVideo: event.target.value }))} placeholder="https://...mp4" />
                </label>
                <label>
                  Visibility
                  <select value={editor.audience} onChange={(event) => setEditor((current) => ({ ...current, audience: event.target.value }))}>
                    <option value="public">Public</option>
                    <option value="members">Members only</option>
                    <option value="private">Private</option>
                  </select>
                </label>
                <label>
                  Historical data files
                  <input type="file" multiple onChange={handleAttachmentUpload} />
                  <small className="form-note">Upload source files, archive data, PDFs, or spreadsheets to store them directly with this article.</small>
                </label>
                <label>
                  Category
                  <input value={editor.category} onChange={(event) => setEditor((current) => ({ ...current, category: event.target.value }))} placeholder="Research, Strategy, Roadmap" />
                </label>
                <div className="tt-span-2">
                  {editor.attachments?.length ? (
                    <div className="tt-attachment-list tt-attachment-list-editor">
                      {editor.attachments.map((attachment) => (
                        <div key={attachment.id} className="tt-attachment-item">
                          <div>
                            <strong>{attachment.fileName}</strong>
                            <small>{attachment.kind} · {attachment.storageKind === 'blob' ? 'Blob archive' : 'Inline archive'} · {formatFileSize(attachment.sizeBytes)}</small>
                          </div>
                          <button type="button" className="button ghost" onClick={() => removeAttachment(attachment.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="tt-history-empty">No historical files attached yet.</p>
                  )}
                </div>
                <label>
                  Tags
                  <div className="tt-tag-creator">
                    <div className="tt-tag-list">
                      {splitTags(editor.tags).map((tag) => (
                        <span key={tag} className="tt-tag-chip">
                          {tag}
                          <button type="button" onClick={() => removeTag(tag)}>Remove</button>
                        </span>
                      ))}
                    </div>
                    <input value={editor.tags} onChange={(event) => setEditor((current) => ({ ...current, tags: event.target.value }))} placeholder="think tank, product, governance" />
                  </div>
                </label>
                <label className="tt-span-2">
                  Excerpt
                  <textarea value={editor.excerpt} onChange={(event) => setEditor((current) => ({ ...current, excerpt: event.target.value }))} rows="3" placeholder="A short synopsis shown in card and hero surfaces" />
                </label>
                <label className="tt-span-2">
                  Supporting image URL
                  <input value={editor.supportingImage} onChange={(event) => setEditor((current) => ({ ...current, supportingImage: event.target.value }))} placeholder="Optional supporting image" />
                </label>
                <label className="tt-span-2">
                  Source link
                  <div className="tt-preview-control">
                    <input value={editor.sourceUrl} onChange={(event) => setEditor((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://source.example.com/article" />
                    <button type="button" className="button outline dark-outline" onClick={() => fetchPreview(editor.sourceUrl, 'sourcePreview')} disabled={!editor.sourceUrl}>Load source card</button>
                  </div>
                </label>
                {editor.sourcePreview ? <div className="tt-span-2">{renderBlock({ type: 'link-preview', ...editor.sourcePreview })}</div> : null}
                <label className="tt-span-2">
                  External video link
                  <div className="tt-preview-control">
                    <input value={editor.videoSourceUrl} onChange={(event) => setEditor((current) => ({ ...current, videoSourceUrl: event.target.value }))} placeholder="https://youtube.com/... or https://vimeo.com/..." />
                    <button type="button" className="button outline dark-outline" onClick={() => fetchPreview(editor.videoSourceUrl, 'videoPreview')} disabled={!editor.videoSourceUrl}>Load video card</button>
                  </div>
                </label>
                {editor.videoPreview ? <div className="tt-span-2">{renderBlock({ type: 'video-embed', ...editor.videoPreview })}</div> : null}
                <label className="tt-span-2">
                  Pull quote
                  <textarea value={editor.quote} onChange={(event) => setEditor((current) => ({ ...current, quote: event.target.value }))} rows="2" placeholder="Optional pull quote" />
                </label>
              </div>

              <div className="tt-composer-shell">
                <div className="tt-wysiwyg">
                <div
                  ref={editorRef}
                  className="tt-wysiwyg-canvas"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={handleEditorInput}
                  onDrop={handleComposerDrop}
                  onDragOver={handleComposerDragOver}
                />
                </div>
                <aside className="tt-composer-rail" aria-label="Composer tools">
                  {COMPOSER_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={`tt-composer-tool${activeComposerTool === tool.id ? ' active' : ''}`}
                      draggable
                      onDragStart={(event) => handleComposerDragStart(event, tool.id)}
                      onClick={() => setActiveComposerTool(tool.id)}
                      title={tool.label}
                    >
                      <span>{tool.icon}</span>
                    </button>
                  ))}
                </aside>
              </div>

              <div className="tt-composer-panel">
                <div className="tt-composer-panel-head">
                  <span className="tt-kicker">Drop or insert blocks</span>
                  <h3>{selectedComposerTool.label}</h3>
                  <p>{selectedComposerTool.description}</p>
                </div>
                <div className="tt-composer-hint">{selectedComposerTool.hint}</div>
                {activeComposerTool === 'heading1' ? (
                  <label>
                    Heading text
                    <input value={composerDrafts.heading1} onChange={(event) => setComposerDrafts((current) => ({ ...current, heading1: event.target.value }))} placeholder="Type a large section title" />
                  </label>
                ) : null}
                {activeComposerTool === 'heading2' ? (
                  <label>
                    Section heading
                    <input value={composerDrafts.heading2} onChange={(event) => setComposerDrafts((current) => ({ ...current, heading2: event.target.value }))} placeholder="Type a section heading" />
                  </label>
                ) : null}
                {activeComposerTool === 'quote' ? (
                  <label>
                    Pull quote
                    <textarea value={composerDrafts.quote} onChange={(event) => setComposerDrafts((current) => ({ ...current, quote: event.target.value }))} rows="3" placeholder="Paste or type a highlighted quote" />
                  </label>
                ) : null}
                {activeComposerTool === 'callout' ? (
                  <>
                    <label>
                      Callout title
                      <input value={composerDrafts.calloutTitle} onChange={(event) => setComposerDrafts((current) => ({ ...current, calloutTitle: event.target.value }))} placeholder="Editor note" />
                    </label>
                    <label className="tt-composer-span-2">
                      Callout body
                      <textarea value={composerDrafts.calloutBody} onChange={(event) => setComposerDrafts((current) => ({ ...current, calloutBody: event.target.value }))} rows="4" placeholder="Write the highlighted note or commentary" />
                    </label>
                    <div className="tt-callout tt-composer-span-2">
                      <span className="tt-callout-mark" aria-hidden="true">[]</span>
                      <div className="tt-callout-copy">
                        <strong>{composerDrafts.calloutTitle || DEFAULT_COMPOSER_DRAFTS.calloutTitle}</strong>
                        <p>{composerDrafts.calloutBody || DEFAULT_COMPOSER_DRAFTS.calloutBody}</p>
                      </div>
                    </div>
                  </>
                ) : null}
                {activeComposerTool === 'image' ? (
                  <>
                    <label className="tt-composer-span-2">
                      Image upload
                      <input type="file" accept="image/*" onChange={handleComposerImageUpload} />
                    </label>
                    <label>
                      Image URL
                      <input value={composerDrafts.imageUrl} onChange={(event) => setComposerDrafts((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="Paste an image URL" />
                    </label>
                    <label>
                      Alt text / caption
                      <input value={composerDrafts.imageAlt} onChange={(event) => setComposerDrafts((current) => ({ ...current, imageAlt: event.target.value }))} placeholder="Describe the image" />
                    </label>
                    <label>
                      Alignment
                      <select value={composerDrafts.imageAlignment} onChange={(event) => setComposerDrafts((current) => ({ ...current, imageAlignment: event.target.value }))}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    {composerDrafts.imageUrl ? (
                      <div className="tt-composer-preview tt-composer-span-2">
                        <img src={composerDrafts.imageUrl} alt={composerDrafts.imageAlt || 'Selected inline image'} />
                        <div>
                          <strong>{composerDrafts.imageAlt || 'Inline image ready'}</strong>
                          <small>{isInlineImageDataUrl(composerDrafts.imageUrl) ? 'Uploaded image stored inline and ready to drop.' : composerDrafts.imageUrl}</small>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {activeComposerTool === 'video' ? (
                  <label className="tt-composer-span-2">
                    Video URL
                    <input value={composerDrafts.videoUrl} onChange={(event) => setComposerDrafts((current) => ({ ...current, videoUrl: event.target.value }))} placeholder="Paste YouTube, Vimeo, or MP4 URL" />
                  </label>
                ) : null}
                {activeComposerTool === 'source' ? (
                  <>
                    <label>
                      Source URL
                      <input value={composerDrafts.sourceUrl} onChange={(event) => setComposerDrafts((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="Paste a reference URL" />
                    </label>
                    <label>
                      Link label
                      <input value={composerDrafts.sourceLabel} onChange={(event) => setComposerDrafts((current) => ({ ...current, sourceLabel: event.target.value }))} placeholder="Optional title for the link" />
                    </label>
                    {composerDrafts.sourceUrl ? (
                      <div className="tt-composer-hint tt-composer-span-2">Reference ready: {composerDrafts.sourceLabel || composerDrafts.sourceUrl}</div>
                    ) : null}
                  </>
                ) : null}
                <div className="tt-composer-actions">
                  <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={() => handleComposerInsert(activeComposerTool)}>Insert block</button>
                  <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={() => resetComposerDraft(activeComposerTool)}>Clear tool</button>
                  <small>Drag a tool onto the editor canvas or paste/type into the fields here and insert directly.</small>
                </div>
              </div>
              </>
              ) : null}

              {heroCropOpen ? (
                <div className="tt-crop-overlay" role="dialog" aria-modal="true" aria-label="Hero image editor">
                  <div className="tt-crop-dialog">
                    <div className="tt-crop-head">
                      <div>
                        <span className="tt-kicker">Hero image editor</span>
                        <h3>Move the crop until the focal area is framed correctly.</h3>
                      </div>
                    </div>
                    <div className="tt-crop-stage">
                      <Cropper
                        image={heroCropSource}
                        crop={heroCropPosition}
                        zoom={heroCropZoom}
                        aspect={HERO_IMAGE_ASPECT}
                        onCropChange={setHeroCropPosition}
                        onZoomChange={setHeroCropZoom}
                        onCropComplete={(_, croppedAreaPixels) => setHeroCropAreaPixels(croppedAreaPixels)}
                      />
                    </div>
                    <label className="tt-crop-zoom">
                      Zoom
                      <input type="range" min="1" max="3" step="0.05" value={heroCropZoom} onChange={(event) => setHeroCropZoom(Number(event.target.value))} />
                    </label>
                    <div className="tt-editor-actions tt-crop-actions">
                      <button type="button" className="button outline dark-outline tt-nowrap-button" onClick={cancelHeroCrop}>Cancel</button>
                      <button type="button" className="button primary tt-nowrap-button" onClick={saveHeroCrop}>Save crop</button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="tt-history-panel">
                <div className="tt-history-head">
                  <span className="tt-kicker">Revision history</span>
                  {isEditorOpen && isEditorDirty ? <p className="tt-editor-warning">Unsaved changes are currently open in the editor. Save before leaving if you want them reflected live.</p> : null}
                  <p>Searchable storage is now backed by the blog database, and each save writes a new editorial snapshot.</p>
                </div>
                {historyEntries.length ? (
                  <div className="tt-history-list">
                    {historyEntries.map((entry) => (
                      <article key={entry.id} className="tt-history-item">
                        <strong>{entry.title || 'Untitled revision'}</strong>
                        <span>{visibilityLabel(entry)} · {entry.status === 'published' ? 'Published' : 'Draft'}</span>
                        <span>{entry.actorName} · {entry.actorRole}</span>
                        <span>{formatTimestamp(entry.revisionAt)}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="tt-history-empty">No revisions recorded yet for this article.</p>
                )}
              </div>
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}