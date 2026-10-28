import { useEffect, useMemo, useRef, useState } from 'react';

import piceusAnimatedSymbolUrl from '../PICEUS_Animated_Symbol_Transparent.svg';
import agentWolfProfileUrl from '../assets/piceus-agents/Agent_Wolf.png';
import agentBettyPortraitUrl from '../assets/piceus-agents/Agent_Betty_Portrait.png';
import pieMakerLifePiesAnimatedUrl from '../assets/PieMaker-Life-Pies-Animated (1).svg';
import piceusLogoUrl from '../assets/piceus-logo.svg';
import ThinkTankApp from './ThinkTankApp.jsx';
import { projects } from './content/projects.js';

const disciplines = [
  'Agentic Intelligence',
  'Secure Identity',
  'Multimodal Systems',
  'Machine-Native Communication',
  'Creative Technology',
];

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

const fallbackContext = {
  matrixProductName: 'MATRIX',
  matrixSigninUrl: 'https://www.piceus.com',
  authenticatedHomePath: '#home',
  contactEnabled: false,
  legacyOriginUrl: '',
  legacyOriginLabel: 'Current MATRIX Shell',
  matrixApiBaseUrl: 'https://membershipbackend.buzzvibe.com',
  matrixLoginPath: '/login',
  accountSelfServiceEnabled: false,
  vercelProject: {
    scope: 'buzz-corp',
    projectName: 'piceus',
    primaryDomain: 'www.piceus.com',
    secondaryDomain: 'piceus.com',
  },
  integrationStatus: 'PICEUS is wired to the ThinkTank content surface and BuzzVibe membership auth through FastAPI proxy endpoints and is intended for the BuzzCorp www.piceus.com Vercel project.',
  session: {
    authenticated: false,
    user: {
      name: 'Guest',
      role: 'Public visitor',
    },
  },
};

function BrandLockup({
  as: Tag = 'div',
  className = '',
  primary,
  primaryClassName = '',
  secondary,
  secondaryClassName = '',
}) {
  return (
    <Tag className={`brand-lockup ${className}`.trim()}>
      <span className={`brand-lockup-line ${primaryClassName}`.trim()}>{primary}</span>
      <span className={`brand-lockup-line ${secondaryClassName}`.trim()}>{secondary}</span>
    </Tag>
  );
}

function readStoredTokens() {
  if (typeof window === 'undefined') {
    return { accessToken: '', refreshToken: '' };
  }

  return {
    accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? '',
    refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY) ?? '',
  };
}

function clearTokens() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function matrixRequest(path, options = {}) {
  const describeError = (value) => {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(describeError).filter(Boolean).join(', ');
    }
    if (value && typeof value === 'object') {
      if (typeof value.msg === 'string' && value.msg.trim()) {
        const location = Array.isArray(value.loc)
          ? value.loc.filter((part) => part !== 'body').join('.')
          : '';
        return location ? `${location}: ${value.msg}` : value.msg;
      }
      if (value.ctx && typeof value.ctx === 'object') {
        const reason = describeError(value.ctx.reason);
        if (reason) {
          return reason;
        }
      }
      return (
        describeError(value.detail)
        || describeError(value.message)
        || describeError(value.error)
        || Object.entries(value)
          .map(([key, nested]) => {
            if (['input', 'password', 'token', 'access_token', 'refresh_token'].includes(key)) {
              return '';
            }
            const described = describeError(nested);
            return described ? `${key}: ${described}` : '';
          })
          .filter(Boolean)
          .join(', ')
      );
    }
    if (value == null) {
      return '';
    }
    return String(value);
  };

  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      message = describeError(body.detail) || describeError(body.message) || describeError(body.error) || message;
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    throw new Error(message);
  }

  return response.json();
}

function createMatrixUrl(origin, path) {
  return `${origin}${path}`;
}

function useMatrixSession(siteContext) {
  const [state, setState] = useState({
    ready: false,
    authenticated: false,
    user: null,
    accessToken: '',
    refreshToken: '',
    error: '',
    loading: false,
  });

  useEffect(() => {
    let ignore = false;
    const { accessToken, refreshToken } = readStoredTokens();

    async function bootstrap() {
      if (!accessToken) {
        if (!ignore) {
          setState((current) => ({
            ...current,
            ready: true,
            authenticated: false,
            user: null,
            accessToken: '',
            refreshToken,
          }));
        }
        return;
      }

      try {
        const user = await matrixRequest('/api/matrix/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!ignore) {
          setState({
            ready: true,
            authenticated: true,
            user,
            accessToken,
            refreshToken,
            error: '',
            loading: false,
          });
        }
      } catch (error) {
        if (!refreshToken) {
          clearTokens();
          if (!ignore) {
            setState({
              ready: true,
              authenticated: false,
              user: null,
              accessToken: '',
              refreshToken: '',
              error: '',
              loading: false,
            });
          }
          return;
        }

        try {
          const refreshed = await matrixRequest('/api/matrix/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          storeTokens(refreshed.access_token, refreshed.refresh_token);
          if (!ignore) {
            setState({
              ready: true,
              authenticated: true,
              user: refreshed.user,
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              error: '',
              loading: false,
            });
          }
        } catch {
          clearTokens();
          if (!ignore) {
            setState({
              ready: true,
              authenticated: false,
              user: null,
              accessToken: '',
              refreshToken: '',
              error: '',
              loading: false,
            });
          }
        }
      }
    }

    bootstrap();

    return () => {
      ignore = true;
    };
  }, [siteContext.matrixApiBaseUrl]);

  const login = async (identifier, password) => {
    setState((current) => ({ ...current, error: '', loading: true }));
    try {
      const normalizedIdentifier = identifier.trim();

      const result = await matrixRequest('/api/matrix/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: normalizedIdentifier,
          password,
        }),
      });
      storeTokens(result.access_token, result.refresh_token);
      setState({
        ready: true,
        authenticated: true,
        user: result.user,
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        error: '',
        loading: false,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        ready: true,
        authenticated: false,
        user: null,
        accessToken: '',
        refreshToken: '',
        error: error.message,
        loading: false,
      }));
      throw error;
    }
  };

  const logout = async () => {
    const token = state.accessToken;
    try {
      if (token) {
        await matrixRequest('/api/matrix/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // Clear local session even if upstream logout fails.
    }

    clearTokens();
    setState({
      ready: true,
      authenticated: false,
      user: null,
      accessToken: '',
      refreshToken: '',
      error: '',
      loading: false,
    });
  };

  return {
    ...state,
    login,
    logout,
    clearError: () => setState((current) => ({ ...current, error: '' })),
  };
}

function useMatrixOverview(authenticated, accessToken) {
  const [state, setState] = useState({
    metrics: null,
    status: null,
    alerts: [],
    loading: false,
    error: '',
  });

  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!authenticated || !accessToken) {
        setState({ metrics: null, status: null, alerts: [], loading: false, error: '' });
        return;
      }

      setState((current) => ({ ...current, loading: true, error: '' }));

      try {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [metrics, status, alerts] = await Promise.all([
          matrixRequest('/api/matrix/widgets/metrics', { headers }),
          matrixRequest('/api/matrix/widgets/status', { headers }),
          matrixRequest('/api/matrix/widgets/alerts?limit=3', { headers }),
        ]);

        if (!ignore) {
          setState({
            metrics,
            status,
            alerts: Array.isArray(alerts) ? alerts : alerts?.items || [],
            loading: false,
            error: '',
          });
        }
      } catch (error) {
        if (!ignore) {
          setState({ metrics: null, status: null, alerts: [], loading: false, error: error.message });
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [authenticated, accessToken]);

  return state;
}

const legal = {
  privacy: {
    title: 'Privacy',
    body: [
      'This website does not include analytics trackers. When contact routing is enabled, inquiry details are relayed through the PICEUS contact service to the designated inbox; when routing is unavailable, the draft stays local to your browser.',
      'Any delivered inquiry may be processed by the designated email or messaging provider behind that contact relay. The website hosting service may process technical request information needed to serve and secure the site.',
      'For privacy questions, use the PICEUS contact section.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      'This website provides an overview of PICEUS work, product directions, and research. Descriptions do not constitute a service agreement or guarantee of availability, performance, certification, or grant funding.',
      'Experimental concepts are identified as research. Any engagement, licensing, or delivery terms must be agreed separately in writing.',
      'PICEUS branding and original website content are reserved to their respective owners. Referenced third-party names remain the property of their owners.',
    ],
  },
};

const navigationItems = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'platform', label: 'Platform' },
  { id: 'work', label: 'Our Work' },
  { id: 'research', label: 'Research' },
  { id: 'thinktank', label: 'ThinkTank', href: '/think-tank' },
  { id: 'contact', label: 'Contact', className: 'nav-contact' },
];

function App() {
  const isThinkTankRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/think-tank');
  const [filter, setFilter] = useState('All');
  const [modal, setModal] = useState(null);
  const [activeSection, setActiveSection] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [siteContext, setSiteContext] = useState(fallbackContext);
  const [contactStatus, setContactStatus] = useState('');
  const [contactStartedAt, setContactStartedAt] = useState(() => Date.now());
  const [latestThinkTankPosts, setLatestThinkTankPosts] = useState([]);
  const accountMenuRef = useRef(null);
  const dialogRef = useRef(null);
  const lastFocusRef = useRef(null);
  const thinkTankRailRef = useRef(null);
  const sessionState = useMatrixSession(siteContext);

  const filteredProjects = useMemo(
    () => projects.filter((project) => filter === 'All' || project.category === filter),
    [filter],
  );

  useEffect(() => {
    let ignore = false;

    fetch('/api/site-context')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load site context');
        }

        return response.json();
      })
      .then((data) => {
        if (!ignore) {
          setSiteContext({ ...fallbackContext, ...data });
        }
      })
      .catch(() => {
        if (!ignore) {
          setSiteContext(fallbackContext);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    fetch('/api/blog/feed?limit=6')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load latest ThinkTank article');
        }
        return response.json();
      })
      .then((data) => {
        if (!ignore) {
          setLatestThinkTankPosts(Array.isArray(data?.items) ? data.items : []);
        }
      })
      .catch(() => {
        if (!ignore) {
          setLatestThinkTankPosts([]);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return undefined;
    }

    const handleCancel = (event) => {
      event.preventDefault();
      setModal(null);
    };

    dialog.addEventListener('cancel', handleCancel);

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (modal) {
      lastFocusRef.current = document.activeElement;
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }

    if (lastFocusRef.current instanceof HTMLElement) {
      lastFocusRef.current.focus();
    }
  }, [modal]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const sectionIds = navigationItems.map((item) => item.id);
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!sections.length) {
      return undefined;
    }

    let ticking = false;

    const updateFromScroll = () => {
      const headerOffset = window.innerWidth <= 760 ? 110 : 140;
      const currentSection = sections.reduce((activeId, section) => {
        if (section.getBoundingClientRect().top - headerOffset <= 0) {
          return section.id;
        }
        return activeId;
      }, sectionIds[0]);

      setActiveSection(currentSection);
    };

    const handleScroll = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        updateFromScroll();
        ticking = false;
      });
    };

    const syncFromHash = () => {
      const hashId = window.location.hash.replace('#', '');
      if (sectionIds.includes(hashId)) {
        setActiveSection(hashId);
        window.requestAnimationFrame(updateFromScroll);
        return;
      }

      updateFromScroll();
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('hashchange', syncFromHash);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  const staticSession = siteContext.session || fallbackContext.session;
  const session = sessionState.ready
    ? {
        authenticated: sessionState.authenticated,
        user: sessionState.user || staticSession.user,
      }
    : staticSession;
  const matrixProductName = siteContext.matrixProductName || fallbackContext.matrixProductName;
  const matrixSignInUrl = siteContext.matrixSigninUrl || fallbackContext.matrixSigninUrl;
  const contactEnabled = Boolean(siteContext.contactEnabled);
  const accountSelfServiceEnabled = Boolean(siteContext.accountSelfServiceEnabled);
  const platformLinks = [
    { label: 'PICEUS', description: 'Public experience', href: '#home' },
    {
      label: siteContext.legacyOriginLabel || matrixProductName,
      description: 'Private Workspace',
      href: siteContext.legacyOriginUrl || matrixSignInUrl,
    },
  ];

  const handleContactSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (contactEnabled) {
      setContactStatus('Sending your inquiry to PICEUS...');
      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: form.get('name'),
            email: form.get('email'),
            interest: form.get('interest'),
            message: form.get('message'),
            company: form.get('company'),
            pageUrl: window.location.href,
            startedAt: Number(form.get('startedAt')),
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.detail || result.error || 'Unable to send your inquiry right now.');
        }

        event.currentTarget.reset();
        setContactStartedAt(Date.now());
        setContactStatus('Sent. PICEUS received your inquiry.');
      } catch (error) {
        setContactStatus(error.message || 'Unable to send your inquiry right now.');
      }
      return;
    }

    const draft = [
      `PICEUS inquiry: ${form.get('interest')}`,
      '',
      `Name: ${form.get('name')}`,
      `Email: ${form.get('email')}`,
      `Interest: ${form.get('interest')}`,
      '',
      `${form.get('message')}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(draft);
      setContactStatus('Inquiry draft copied. Contact routing is being finalized, so no email address is exposed on this page.');
      event.currentTarget.reset();
      setContactStartedAt(Date.now());
    } catch {
      setContactStatus('Inquiry draft could not be copied automatically. Your details remain local to this browser.');
    }
  };

  useEffect(() => {
    setContactStatus(
      contactEnabled
        ? 'Your inquiry is sent securely through the PICEUS contact relay.'
        : '',
    );
    setContactStartedAt(Date.now());
  }, [contactEnabled]);

  const openProject = (project) => setModal({ type: 'project', project });
  const openLegal = (key) => setModal({ type: 'legal', key });
  const toggleAccountMenu = () => setAccountMenuOpen((current) => !current);
  const toggleMenu = () => setMenuOpen((current) => !current);

  const scrollThinkTankRail = (direction) => {
    const rail = thinkTankRailRef.current;

    if (!rail) {
      return;
    }

    rail.scrollBy({
      left: direction * Math.max(rail.clientWidth * 0.88, 280),
      behavior: 'smooth',
    });
  };

  const handleAccountLogin = async (email, password) => {
    await sessionState.login(email, password);
    setAccountMenuOpen(false);
  };

  const handleAccountLogout = async () => {
    await sessionState.logout();
    setAccountMenuOpen(false);
  };

  if (isThinkTankRoute) {
    return (
      <ThinkTankApp
        accountSelfServiceEnabled={accountSelfServiceEnabled}
        session={session}
        sessionState={sessionState}
        matrixProductName={matrixProductName}
        piceusLogoUrl={piceusLogoUrl}
        onLogin={handleAccountLogin}
        onLogout={handleAccountLogout}
      />
    );
  }

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header>
        <a className="brand" href="#home" aria-label="PICEUS Home"><img src={piceusLogoUrl} alt="PICEUS" /></a>
        <div className="header-right">
          <button
            type="button"
            className="menu"
            aria-expanded={menuOpen}
            aria-controls="navigation"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={toggleMenu}
          >
            <span aria-hidden="true">|||</span>
            Menu
          </button>
          <nav id="navigation" className={menuOpen ? 'open' : ''} aria-label="Main navigation">
            {navigationItems.map((item) => (
              <a
                key={item.id}
                href={item.href || `#${item.id}`}
                className={`${item.className || ''}${!item.href && activeSection === item.id ? `${item.className ? ' ' : ''}active` : ''}`}
                aria-current={!item.href && activeSection === item.id ? 'page' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  if (!item.href) {
                    setActiveSection(item.id);
                  }
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="account-menu" ref={accountMenuRef}>
            <button
              type="button"
              className={`account-trigger${accountMenuOpen ? ' open' : ''}`}
              aria-expanded={accountMenuOpen}
              aria-controls="account-dropdown"
              onClick={toggleAccountMenu}
            >
              <span className="account-avatar">{getUserInitials(session.user?.name || 'PICEUS')}</span>
              <span className="account-meta">
                <strong>{session.authenticated ? (session.user?.name || 'PICEUS account') : 'Ecosystem Access'}</strong>
                <small>{session.authenticated ? 'Connected' : `${matrixProductName} Sign In`}</small>
              </span>
            </button>
            {accountMenuOpen ? (
              <AccountMenu
                accountSelfServiceEnabled={accountSelfServiceEnabled}
                authError={sessionState.error}
                authenticated={session.authenticated}
                loading={sessionState.loading}
                matrixProductName={matrixProductName}
                onClearError={sessionState.clearError}
                onLogin={handleAccountLogin}
                onLogout={handleAccountLogout}
                platformLinks={platformLinks}
                user={session.user}
              />
            ) : null}
          </div>
        </div>
      </header>
      <main id="main">
        <section id="home" className="hero">
          <div className="hero-glow"></div>
          <div className="hero-art" aria-hidden="true">
            <img src={piceusAnimatedSymbolUrl} alt="" />
          </div>
          <div className="hero-inner">
            <div className="eyebrow"><span className="line"></span> HUMAN EXPERIENCE / AGENTIC AI</div>
            <BrandLockup
              as="h1"
              className="hero-title"
              primary="HUMAN VISION."
              primaryClassName="hero-title-line hero-title-line-primary"
              secondary="MACHINE INTELLIGENCE."
              secondaryClassName="hero-title-line hero-title-line-secondary"
            />
            <p className="hero-copy">Where human imagination and machine intelligence come together to explore, invent, and create technology.</p>
            <div className="actions">
              <a className="button primary" href="#work">Explore our work</a>
              <a className="button outline" href="#platform">Explore the platform</a>
            </div>
            <div className="hero-caption">INTELLIGENCE / TECHNOLOGY / HUMAN EXPERIENCE</div>
          </div>
        </section>

        <div className="disciplines">
          {disciplines.map((discipline, index) => (
            <FragmentWithDivider key={discipline} label={discipline} hidden={index === disciplines.length - 1} />
          ))}
        </div>

        {latestThinkTankPosts.length ? (
          <section className="home-thinktank-strip" aria-labelledby="home-thinktank-strip-title">
            <div className="home-thinktank-strip-head">
              <div>
                <span className="section-label">THINKTANK / LATEST ARTICLES</span>
                <h2 id="home-thinktank-strip-title">Latest publishing from ThinkTank.</h2>
              </div>
              <p>Swipe or scroll through the newest articles, then open any post directly into the ThinkTank reader.</p>
            </div>
            <div className="home-thinktank-rail-shell">
              <div className="home-thinktank-rail-actions" aria-label="ThinkTank article navigation">
                <button type="button" className="home-thinktank-rail-arrow" aria-label="Scroll to previous articles" onClick={() => scrollThinkTankRail(-1)}>
                  <span aria-hidden="true">←</span>
                </button>
                <button type="button" className="home-thinktank-rail-arrow" aria-label="Scroll to next articles" onClick={() => scrollThinkTankRail(1)}>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              <div ref={thinkTankRailRef} className="home-thinktank-rail" role="list" aria-label="Latest ThinkTank articles">
                {latestThinkTankPosts.map((post, index) => (
                  <a key={post.id || post.slug || index} className="home-thinktank-card" href={`/think-tank?post=${post.slug}`} role="listitem">
                    {post.coverImage ? (
                      <div
                        className="home-thinktank-card-image"
                        style={{ backgroundImage: `linear-gradient(135deg, rgba(16,18,24,0.08), rgba(16,18,24,0.02)), url(${post.coverImage})` }}
                      />
                    ) : null}
                    <div className="home-thinktank-card-copy">
                      <span>{index === 0 ? 'Latest from ThinkTank' : 'ThinkTank article'}</span>
                      <strong>{post.title}</strong>
                      <p>{post.excerpt}</p>
                      <small>{post.publishedAt ? new Date(Number(post.publishedAt) * 1000).toLocaleDateString() : 'Open article'}</small>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section id="about" className="section about">
          <div className="about-surface">
            <div className="about-glow" aria-hidden="true"></div>
            <div className="about-inner">
              <div className="section-label">00 / ABOUT PICEUS</div>
              <div className="about-grid">
                <div className="about-visual">
                  <div className="about-animation-label" aria-hidden="true">
                    <strong>PIE MAKER PRO</strong>
                    <span>INTELLIGENCE FOR LIFE</span>
                  </div>
                  <div className="about-animation-shell" aria-hidden="true">
                    <img src={pieMakerLifePiesAnimatedUrl} alt="" className="about-animation" />
                  </div>
                </div>
                <div className="about-copy">
                  <h2>Today's Decisions Become Tomorrow's Reality.</h2>
                  <p>PICEUS connects human imagination, machine intelligence, and the systems that shape our world. Through original research, design, and engineering, we build intelligence to solve complex problems, address today&apos;s technological challenges, and create new opportunities for humans and AI to work together.</p>
                  <p>Our vision is intelligence woven into society, supporting how we live, learn, create, communicate, and transact. Our mission is to bring that vision to life through connected technologies guided by a moral compass, preserving human agency, protecting privacy, expanding access, and holding intelligent systems accountable for their actions and impact.</p>
                  <blockquote className="about-quote">
                    <p>
                      Intelligence gives vision <strong>clarity</strong>. Vision gives intelligence <strong>purpose</strong>. Purpose drives <strong>innovation</strong>.
                    </p>
                  </blockquote>
                  <div className="founder">
                    <img className="founder-mark founder-photo" src={agentBettyPortraitUrl} alt="Betty Baker" />
                    <div>
                      <strong>Betty Baker</strong>
                      <small>Chief Data Forensics Agent</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="principles">
            <article><span>01</span><h3>Human Purpose</h3><p>Technology should serve the people and decisions behind it.</p></article>
            <article><span>02</span><h3>Connected By Design</h3><p>Shared intelligence across products, channels, and environments.</p></article>
            <article><span>03</span><h3>Governed From The Core</h3><p>Identity, access, privacy, and traceability built into the architecture.</p></article>
          </div>
        </section>

        <section id="platform" className="section platform">
          <div className="section-label">01 / THE PLATFORM</div>
          <div className="heading-row platform-heading-row">
            <div className="platform-heading-copy">
              <h2>A WorkForce Where<br />Agents Are Coworkers.</h2>
            </div>
            <blockquote className="platform-intro">
              <strong>WorkForce Intelligence</strong> is a seamless intelligence layer where people, agents, and systems work together with identity, context, and governance.
            </blockquote>
          </div>
          <div className="platform-agent-row">
            <article className="platform-agent-card" aria-label="Wolf Bronson, Chief Intelligence Agent">
              <figure className="platform-agent-avatar">
                <img src={agentWolfProfileUrl} alt="Wolf Bronson" />
              </figure>
              <div className="platform-agent-profile">
                <p className="platform-agent-eyebrow">PICEUS / SECURITY &amp; INTELLIGENCE</p>
                <h3 className="platform-agent-name">Wolf Bronson</h3>
                <p className="platform-agent-title">Chief Intelligence Agent</p>
                <ul className="platform-agent-tags" aria-label="Security specialties">
                  <li>Cybersecurity</li>
                  <li>Data Forensics</li>
                  <li>Fraud Prevention</li>
                  <li>Threat Detection</li>
                  <li>Agent Defense</li>
                  <li>Antivirus</li>
                  <li>System Integrity</li>
                </ul>
                <p className="platform-agent-summary">Coordinates security agents to detect threats, contain malicious activity, and protect the PICEUS ecosystem.</p>
              </div>
              <div className="platform-agent-footer">
                <p className="platform-agent-credentials"><span className="platform-agent-badge-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 2.25 4.5 5.5v5.73c0 4.72 3.18 9.09 7.5 10.52 4.32-1.43 7.5-5.8 7.5-10.52V5.5L12 2.25Zm0 3.03 4.75 2.06v3.89c0 3.34-2.13 6.46-4.75 7.72-2.62-1.26-4.75-4.38-4.75-7.72V7.34L12 5.28Z" /></svg></span>Security Clearance Badge.</p>
                <p className="platform-agent-permission">Protecting systems from fraud, scams, and infiltration.</p>
              </div>
            </article>
            <article className="platform-agent-card" aria-label="Betty Baker, Chief Data Forensics Agent">
              <figure className="platform-agent-avatar">
                <img src={agentBettyPortraitUrl} alt="Betty Baker" />
              </figure>
              <div className="platform-agent-profile">
                <p className="platform-agent-eyebrow">PICEUS / RESEARCH &amp; INTELLIGENCE</p>
                <h3 className="platform-agent-name">Betty Baker</h3>
                <p className="platform-agent-title">Chief Data Forensics Agent</p>
                <ul className="platform-agent-tags" aria-label="Research specialties">
                  <li>Science</li>
                  <li>Data Science</li>
                  <li>Mathematics</li>
                  <li>Art</li>
                  <li>History</li>
                  <li>Healthcare</li>
                  <li>Specialist Agent Research</li>
                </ul>
                <p className="platform-agent-summary">Specialized in Data Science, Data Forensics, and Intelligence Research.</p>
              </div>
              <div className="platform-agent-footer">
                <p className="platform-agent-credentials"><span className="platform-agent-badge-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 2.25 4.5 5.5v5.73c0 4.72 3.18 9.09 7.5 10.52 4.32-1.43 7.5-5.8 7.5-10.52V5.5L12 2.25Zm0 3.03 4.75 2.06v3.89c0 3.34-2.13 6.46-4.75 7.72-2.62-1.26-4.75-4.38-4.75-7.72V7.34L12 5.28Z" /></svg></span>Security Clearance Badge.</p>
                <p className="platform-agent-permission">Simulates predictive models to forecast trends and anticipate future outcomes.</p>
              </div>
            </article>
          </div>
          <div className="architecture">
            <div className="arch-core">
              <img src={piceusLogoUrl} alt="PICEUS" />
              <p>Governed Agentic Ecosystem</p>
            </div>
            <div className="arch-layers">
              <article><b>01</b><div><h3>Intelligence & Orchestration</h3><p>Core Coordinator · AI Workforce · Multimodal Reasoning</p></div></article>
              <article><b>02</b><div><h3>Trust & Secure Data</h3><p>Secure Data Fabric · Identity & Access · Auditability</p></div></article>
              <article><b>03</b><div><h3>Experiences & Applications</h3><p>Console · Wallets · Connected Devices · Creative Platforms</p></div></article>
            </div>
          </div>
          <div className="platform-foot">
            <span>Enterprise / Private Cloud / Edge / Mobile / Connected Devices</span>
            <a href="#capabilities">Explore Our Capabilities</a>
          </div>
        </section>

        <section id="work" className="section work">
          <div className="section-label">02 / OUR WORK</div>
          <div className="heading-row">
            <h2 className="work-heading">
              <span className="work-heading-title">PICEUS LABS:</span>
              <span className="work-heading-subtitle">INTELLIGENCE / TECHNOLOGY / HUMAN EXPERIENCE</span>
            </h2>
          </div>
          <div className="filter-row" role="group" aria-label="Filter portfolio">
            {['All', 'Platforms', 'Experiences', 'Research'].map((value) => (
              <button key={value} className={filter === value ? 'selected' : ''} data-filter={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {value === 'All' ? 'All work' : value}
              </button>
            ))}
            <span id="result-count" aria-live="polite">{filteredProjects.length} projects</span>
          </div>
          <div id="project-grid" className="project-grid">
            {filteredProjects.map((project) => (
              <article key={project.title} className="project">
                <div className="project-visual" style={{ '--accent': project.color }}>
                  <span className="visual-label">PICEUS / {project.label.toUpperCase()}</span>
                  <span className="project-code">{project.code}</span>
                </div>
                <div className="project-body">
                  <div className="meta">{project.category} / {project.label}</div>
                  <h3>{project.title}</h3>
                  <p>{project.summary}</p>
                  <button onClick={() => openProject(project)} aria-label={`Explore ${project.title}`}>Explore project</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="research" className="section research">
          <div className="research-intro">
            <div className="section-label">03 / RESEARCH & DEVELOPMENT</div>
            <h2>Intelligence Takes<br /><em>New Form.</em></h2>
            <p>Exploring mathematics, frequency, light, sound, time, and touch as pathways for people, machines, and systems to connect.</p>
            <a className="button outline" href="#contact">Discuss research collaboration</a>
          </div>
          <div className="research-list">
            <article><span>01 / COMMUNICATION</span><h3>Telepathy + NAIL</h3><p>Exploring machine-native representations of state, context, and intent through mathematical, spatial, temporal, and signal-based channels.</p></article>
            <article><span>02 / HUMAN–MACHINE INTERACTION</span><h3>Light. Sound. Touch. Time.</h3><p>Braille Lightning and Morse Lightning explore accessible, multimodal communication through haptics, optical signals, frequency, and audio.</p></article>
            <article><span>03 / PUBLIC SAFETY & HEALTH</span><h3>Intelligence in the Field.</h3><p>StarMetal research connects wearable identity, a dedicated agent, sensing, and coordinated response, with health-related telemetry and evidence governance in view.</p></article>
            <article><span>04 / DISTRIBUTED INFRASTRUCTURE</span><h3>Rethinking Where Intelligence Lives.</h3><p>Research directions include distributed AI, adaptive energy systems, and environments that support intelligence beyond the conventional data center.</p></article>
            <p className="research-note">Research programs include work being developed for SBIR/STTR pathways and agency-specific proposals. Experimental directions are under investigation; inclusion here does not imply a grant award or validated performance.</p>
          </div>
        </section>

        <section id="capabilities" className="section capabilities">
          <div className="section-label">04 / CAPABILITIES</div>
          <div className="heading-row">
            <h2><span className="capabilities-title-primary">Bold Ideas.</span><br /><em>Endless Possibilities.</em></h2>
            <p>Strategy, design, architecture, and engineering working together to bring your vision to life.</p>
          </div>
          <div className="cap-grid">
            <article><span>01</span><h3>AI & Systems</h3><p>Agentic architectures, AI integration, model training, automation, and enterprise orchestration.</p></article>
            <article><span>02</span><h3>Product & Experience</h3><p>Product strategy, human factors, UX/UI, design systems, and connected device experiences.</p></article>
            <article><span>03</span><h3>Data & Intelligence</h3><p>Data pipelines, modeling, analytics, visualization, and decision intelligence.</p></article>
            <article><span>04</span><h3>Trust & Governance</h3><p>Privacy by design, Zero Trust, identity, permissions, and auditable system behavior.</p></article>
          </div>
          <div className="industries"><strong>Across industries & disciplines</strong><p>Healthcare & Life Sciences · FinTech & Financial Systems · Insurance · Legal · Public Sector & Safety · Education · Automotive · Travel · Sports & Gaming · Media & Entertainment · Marketing & MarTech · Retail & Commerce · Telecommunications · Energy & Industrial Systems · Scientific Research · Conservation · Enterprise · Cybersecurity · Identity & Security · Geospatial Intelligence · Autonomous Systems</p></div>
        </section>

        <section id="contact" className="section contact">
          <div>
            <div className="section-label">05 / CONTACT</div>
            <h2>Let’s build<br /><em>Together.</em></h2>
            <p>Have a project, a research question, or a partnership in mind? Start a conversation with PICEUS.</p>
            <a className="email-link" href="#contact-form">Contact PICEUS</a>
            <span className="contact-location">Atlanta, Georgia · Working across industries and borders</span>
          </div>
          <form id="contact-form" onSubmit={handleContactSubmit}>
            <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
              <label htmlFor="company">Company</label>
              <input id="company" name="company" tabIndex="-1" autoComplete="off" />
            </div>
            <input type="hidden" name="startedAt" value={contactStartedAt} readOnly />
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" autoComplete="name" required placeholder="Full name" />
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
            <label htmlFor="interest">I’m interested in</label>
            <select id="interest" name="interest" defaultValue="Project or partnership">
              <option>Project or partnership</option>
              <option>Platform & AI integration</option>
              <option>Research collaboration</option>
              <option>Product design & strategy</option>
              <option>General inquiry</option>
            </select>
            <label htmlFor="message">Tell us a little about it</label>
            <textarea id="message" name="message" required rows="3" placeholder="What would you like to explore?"></textarea>
            <button type="submit" className="button primary">{contactEnabled ? 'Send inquiry' : 'Prepare inquiry'}</button>
            <p className="form-note" id="form-status" role="status">{contactStatus}</p>
          </form>
        </section>
      </main>
      <footer>
        <div className="footer-main">
          <div className="footer-brand">
            <img src={piceusLogoUrl} alt="PICEUS" />
            <BrandLockup
              className="footer-brand-copy"
              primary="Human Vision."
              primaryClassName="footer-brand-line footer-brand-line-primary"
              secondary="Machine Intelligence."
              secondaryClassName="footer-brand-line footer-brand-line-secondary"
            />
          </div>
          <div><h3>Company</h3><a href="#home">Home</a><a href="#about">About</a><a href="#work">Our Work</a><a href="#contact">Contact</a></div>
          <div><h3>Explore</h3><a href="#platform">The Platform</a><a href="#research">Research & Development</a><a href="#capabilities">Capabilities</a><a href="/think-tank">ThinkTank</a></div>
          <div><h3>Connect</h3><a href="#contact-form">Contact PICEUS</a><span>Atlanta, Georgia</span></div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} PICEUS. All rights reserved.</span>
          <div><button onClick={() => openLegal('privacy')}>Privacy</button><button onClick={() => openLegal('terms')}>Terms</button><a href="#home">Back to top ↑</a></div>
        </div>
      </footer>

      <dialog id="detail" ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <button className="dialog-close" aria-label="Close details" onClick={() => setModal(null)}>×</button>
        <div id="dialog-content">
          {modal?.type === 'project' ? (
            <>
              <div className="dialog-meta">{modal.project.category.toUpperCase()} / {modal.project.label.toUpperCase()}</div>
              <h2>{modal.project.title}</h2>
              <p>{modal.project.detail}</p>
              <ul>{modal.project.points.map((point) => <li key={point}>{point}</li>)}</ul>
              <a className="button primary" href="#contact" onClick={() => setModal(null)}>Discuss this work</a>
            </>
          ) : null}
          {modal?.type === 'legal' ? (
            <>
              <div className="dialog-meta">PICEUS / WEBSITE {modal.key.toUpperCase()}</div>
              <h2>{legal[modal.key].title}</h2>
              {legal[modal.key].body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

function getUserInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'PI';
}

function AccountMenu({
  accountSelfServiceEnabled,
  authError,
  authenticated,
  loading,
  matrixProductName,
  onClearError,
  onLogin,
  onLogout,
  platformLinks,
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
      // Error state is already surfaced by the hook.
    }
  };

  return (
    <div id="account-dropdown" className="account-dropdown">
      <div className="account-dropdown-header">
        <span className="matrix-badge">{authenticated ? 'Connected' : 'Connected platforms'}</span>
        <h3>{authenticated ? 'Ecosystem hub' : `${matrixProductName} sign in`}</h3>
        <p>
          {authenticated
            ? 'Move between PICEUS and your connected workspace from one place, or sign out when you are done.'
            : 'Sign in with your assigned MATRIX credentials to access PICEUS and the connected platform ecosystem.'}
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
          <button type="button" className="button outline dark-outline" onClick={onLogout}>Sign out</button>
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
          <label htmlFor="matrix-email">Email, handle, or unique ID</label>
          <input
            id="matrix-email"
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
          <label htmlFor="matrix-password">Password</label>
          <input
            id="matrix-password"
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
            <button type="submit" className="button primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function FragmentWithDivider({ label, hidden }) {
  return (
    <>
      <span>{label}</span>
      {!hidden ? <i></i> : null}
    </>
  );
}

export default App;
