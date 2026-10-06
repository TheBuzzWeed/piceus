import { useEffect, useMemo, useRef, useState } from 'react';

import { projects } from './content/projects.js';

const disciplines = [
  'Agentic intelligence',
  'Secure identity',
  'Multimodal systems',
  'Machine-native communication',
  'Creative technology',
];

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

const fallbackContext = {
  matrixProductName: 'MATRIX',
  matrixSigninUrl: 'https://www.piceus.com',
  authenticatedHomePath: '#matrix-home',
  contactEmail: 'william.weems@gmail.com',
  legacyOriginUrl: '',
  legacyOriginLabel: 'Current MATRIX shell',
  matrixApiBaseUrl: 'https://merlin-theme-api-deploy.vercel.app',
  matrixLoginPath: '/login',
  matrixRegisterPath: '/register',
  matrixForgotPasswordPath: '/forgot-password',
  vercelProject: {
    scope: 'buzz-corp',
    projectName: 'piceus',
    primaryDomain: 'www.piceus.com',
    secondaryDomain: 'piceus.com',
  },
  integrationStatus: 'PICEUS is wired to the existing MATRIX auth and content surface through FastAPI proxy endpoints and is intended for the BuzzCorp www.piceus.com Vercel project.',
  session: {
    authenticated: false,
    user: {
      name: 'Guest',
      role: 'Public visitor',
    },
  },
};

function readStoredTokens() {
  if (typeof window === 'undefined') {
    return { accessToken: '', refreshToken: '' };
  }

  return {
    accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY) || '',
    refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY) || '',
  };
}

function storeTokens(accessToken, refreshToken) {
  if (typeof window === 'undefined') {
    return;
  }

  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

function clearTokens() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function matrixRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || body.message || message;
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

  const login = async (email, password) => {
    setState((current) => ({ ...current, error: '', loading: true }));
    try {
      const result = await matrixRequest('/api/matrix/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
      'This website does not include analytics trackers or a server-submitted contact form. Contact information entered here is used in your browser to prepare an email draft; the website does not save those entries.',
      'If you send an email, your email provider and the recipient\'s provider process that message. The website hosting service may process technical request information needed to serve and secure the site.',
      'For privacy questions, contact William Weems through the contact section.',
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

function App() {
  const [filter, setFilter] = useState('All');
  const [modal, setModal] = useState(null);
  const [siteContext, setSiteContext] = useState(fallbackContext);
  const dialogRef = useRef(null);
  const lastFocusRef = useRef(null);
  const sessionState = useMatrixSession(siteContext);
  const matrixOverview = useMatrixOverview(
    sessionState.authenticated,
    sessionState.accessToken,
  );

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

  const contactEmail = siteContext.contactEmail || fallbackContext.contactEmail;
  const staticSession = siteContext.session || fallbackContext.session;
  const session = sessionState.ready
    ? {
        authenticated: sessionState.authenticated,
        user: sessionState.user || staticSession.user,
      }
    : staticSession;
  const primaryAction = session.authenticated
    ? {
        href: siteContext.authenticatedHomePath || '#matrix-home',
        label: 'Open PICEUS home',
      }
    : {
        href: '#matrix-access',
        label: `Sign in through ${siteContext.matrixProductName || 'MATRIX'}`,
      };
  const matrixSignInUrl = siteContext.matrixSigninUrl || fallbackContext.matrixSigninUrl;
  const matrixRegisterUrl = createMatrixUrl(
    matrixSignInUrl,
    siteContext.matrixRegisterPath || fallbackContext.matrixRegisterPath,
  );
  const matrixForgotPasswordUrl = createMatrixUrl(
    matrixSignInUrl,
    siteContext.matrixForgotPasswordPath || fallbackContext.matrixForgotPasswordPath,
  );

  const handleContactSubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = `PICEUS inquiry: ${form.get('interest')}`;
    const body = `Name: ${form.get('name')}\nEmail: ${form.get('email')}\nInterest: ${form.get('interest')}\n\n${form.get('message')}`;
    window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const openProject = (project) => setModal({ type: 'project', project });
  const openLegal = (key) => setModal({ type: 'legal', key });

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="matrix-bar">
        <div>
          <span className="matrix-badge">{sessionState.ready && session.authenticated ? `${siteContext.matrixProductName} session active` : 'Public experience'}</span>
          <p>{siteContext.integrationStatus}</p>
        </div>
        <div className="matrix-bar-meta">
          <span>{sessionState.ready ? (session.user?.name || 'Guest') : 'Checking session'}</span>
          <span>{sessionState.ready ? (session.user?.role || 'Public visitor') : 'MATRIX sync'}</span>
          <span>{siteContext.vercelProject?.primaryDomain || 'www.piceus.com'}</span>
          {siteContext.legacyOriginUrl ? <a href={siteContext.legacyOriginUrl} target="_blank" rel="noreferrer">{siteContext.legacyOriginLabel}</a> : null}
        </div>
      </div>
      <header>
        <a className="brand" href="#home" aria-label="PICEUS Home"><img src="assets/piceus-logo.svg" alt="PICEUS" /></a>
        <nav id="navigation" aria-label="Main navigation">
          <a href="#home" className="active">Home</a>
          <a href="#about">About</a>
          <a href="#platform">Platform</a>
          <a href="#work">Our Work</a>
          <a href="#research">Research</a>
          <a href="#contact" className="nav-contact">Contact</a>
        </nav>
      </header>
      <main id="main">
        <section id="home" className="hero">
          <div className="hero-glow"></div>
          <div className="hero-inner">
            <div className="eyebrow"><span className="line"></span> HUMAN VISION. MACHINE INTELLIGENCE.</div>
            <h1>Intelligence,<br /><em>connected.</em></h1>
            <p className="hero-copy">From the way we think to the way we transact.<br />PICEUS connects people, agents, and systems<br className="desktop" /> through one governed, multimodal ecosystem.</p>
            <div className="actions">
              <a className="button primary" href="#work">Explore our work</a>
              <a className="button outline" href={primaryAction.href}>{primaryAction.label}</a>
            </div>
            <div className="hero-caption">AGENTIC AI / IDENTITY / COMMUNICATION / HUMAN EXPERIENCE</div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit o1"></div>
            <div className="orbit o2"></div>
            <img src="assets/piceus-glyph.svg" alt="" />
            <span className="signal s1">HUMAN</span>
            <span className="signal s2">AGENT</span>
            <span className="signal s3">SYSTEM</span>
            <span className="art-caption">ONE ECOSYSTEM. MANY POSSIBILITIES.</span>
          </div>
          <div className="hero-bottom">
            <span>Built for a connected future.</span>
            <a href="#about">Discover PICEUS <span>↓</span></a>
          </div>
        </section>

        <section id="matrix-home" className="section matrix-home">
          <div className="section-label">00 / MATRIX INTEGRATION</div>
          <div className="matrix-home-grid">
            <div>
              <h2>{session.authenticated ? 'PICEUS home inside MATRIX.' : 'Public front door. MATRIX-backed access.'}</h2>
              <p className="matrix-home-copy">This repo is intended for the BuzzCorp Vercel project that serves {siteContext.vercelProject?.primaryDomain || 'www.piceus.com'}. The public design lives here, and authenticated state now resolves through the existing MATRIX auth surface.</p>
              <div className="matrix-domain-list">
                <span>{siteContext.vercelProject?.scope || 'buzz-corp'}</span>
                <span>{siteContext.vercelProject?.projectName || 'piceus'}</span>
                <span>{siteContext.vercelProject?.primaryDomain || 'www.piceus.com'}</span>
                <span>{siteContext.vercelProject?.secondaryDomain || 'piceus.com'}</span>
              </div>
            </div>
            {session.authenticated ? (
              <MatrixHomePanel
                legacyOriginLabel={siteContext.legacyOriginLabel}
                legacyOriginUrl={siteContext.legacyOriginUrl || matrixSignInUrl}
                matrixOverview={matrixOverview}
                onLogout={sessionState.logout}
                user={session.user}
              />
            ) : (
              <MatrixAccessPanel
                authError={sessionState.error}
                forgotPasswordUrl={matrixForgotPasswordUrl}
                loading={sessionState.loading}
                matrixProductName={siteContext.matrixProductName}
                onClearError={sessionState.clearError}
                onLogin={sessionState.login}
                registerUrl={matrixRegisterUrl}
              />
            )}
          </div>
        </section>

        <div className="disciplines">
          {disciplines.map((discipline, index) => (
            <FragmentWithDivider key={discipline} label={discipline} hidden={index === disciplines.length - 1} />
          ))}
        </div>

        <section id="about" className="section about">
          <div className="section-label">01 / ABOUT PICEUS</div>
          <div className="about-grid">
            <h2>A bigger picture.<br />A connected approach.</h2>
            <div>
              <p className="lead">We build at the intersection of intelligence, technology, and human experience.</p>
              <p>PICEUS is a modular ecosystem for agentic AI, enterprise platforms, intelligent transactions, and machine-native communication. Our work brings applications, data, workflows, and infrastructure into a shared architecture.</p>
              <p>From regulated environments to creative communities, the goal is the same: useful intelligence with clear identity, permissions, and accountability.</p>
              <div className="founder">
                <span className="founder-mark">WW</span>
                <div>
                  <strong>William Weems</strong>
                  <small>Founder & Chief AI Officer · Atlanta, Georgia</small>
                </div>
              </div>
            </div>
          </div>
          <div className="principles">
            <article><span>01</span><h3>Human purpose</h3><p>Technology should serve the people and decisions behind it.</p></article>
            <article><span>02</span><h3>Connected by design</h3><p>Shared intelligence across products, channels, and environments.</p></article>
            <article><span>03</span><h3>Governed from the core</h3><p>Identity, access, privacy, and traceability built into the architecture.</p></article>
          </div>
        </section>

        <section id="platform" className="section platform">
          <div className="section-label">02 / THE PLATFORM</div>
          <div className="heading-row">
            <h2>One foundation.<br />Possibilities everywhere.</h2>
            <p>A shared intelligence layer behind a diverse ecosystem of products and research.</p>
          </div>
          <div className="architecture">
            <div className="arch-core">
              <img src="assets/piceus-logo.svg" alt="PICEUS" />
              <p>Governed agentic ecosystem</p>
            </div>
            <div className="arch-layers">
              <article><b>01</b><div><h3>Intelligence & orchestration</h3><p>Core Coordinator · AI workforce · multimodal reasoning</p></div></article>
              <article><b>02</b><div><h3>Trust & secure data</h3><p>Secure Data Fabric · identity & access · auditability</p></div></article>
              <article><b>03</b><div><h3>Experiences & applications</h3><p>Console · wallets · connected devices · creative platforms</p></div></article>
            </div>
          </div>
          <div className="platform-foot">
            <span>Enterprise / Private cloud / Edge / Mobile / Connected devices</span>
            <a href="#capabilities">Explore our capabilities</a>
          </div>
        </section>

        <section id="work" className="section work">
          <div className="section-label">03 / OUR WORK</div>
          <div className="heading-row">
            <h2>An ecosystem<br />of original thinking.</h2>
            <p>Platforms, products, and research programs. Different applications. A common thread.</p>
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
            <div className="section-label">04 / RESEARCH & DEVELOPMENT</div>
            <h2>Beyond the<br /><em>expected.</em></h2>
            <p>New ways for intelligence to communicate, move, and operate across the physical and digital world.</p>
            <a className="button outline" href="#contact">Discuss research collaboration</a>
          </div>
          <div className="research-list">
            <article><span>01 / COMMUNICATION</span><h3>TELEPATHY + NAIL</h3><p>Exploring machine-native representations of state, context, and intent through mathematical, spatial, temporal, and signal-based channels.</p></article>
            <article><span>02 / HUMAN–MACHINE INTERACTION</span><h3>Light. Sound. Touch. Time.</h3><p>Braille Lightning and Morse Lightning explore accessible, multimodal communication through haptics, optical signals, frequency, and audio.</p></article>
            <article><span>03 / PUBLIC SAFETY & HEALTH</span><h3>Intelligence in the field.</h3><p>StarMetal research connects wearable identity, a dedicated agent, sensing, and coordinated response, with health-related telemetry and evidence governance in view.</p></article>
            <article><span>04 / DISTRIBUTED INFRASTRUCTURE</span><h3>Rethinking where intelligence lives.</h3><p>Research directions include distributed AI, adaptive energy systems, and environments that support intelligence beyond the conventional data center.</p></article>
            <p className="research-note">Research programs include work being developed for SBIR/STTR pathways and agency-specific proposals. Experimental directions are under investigation; inclusion here does not imply a grant award or validated performance.</p>
          </div>
        </section>

        <section id="capabilities" className="section capabilities">
          <div className="section-label">05 / CAPABILITIES</div>
          <div className="heading-row">
            <h2>From a bold idea<br />to a useful system.</h2>
            <p>Strategy, design, architecture, and engineering connected from the beginning.</p>
          </div>
          <div className="cap-grid">
            <article><span>01</span><h3>AI & systems</h3><p>Agentic architectures, AI integration, model training, automation, and enterprise orchestration.</p></article>
            <article><span>02</span><h3>Product & experience</h3><p>Product strategy, human factors, UX/UI, design systems, and connected device experiences.</p></article>
            <article><span>03</span><h3>Data & intelligence</h3><p>Data pipelines, modeling, analytics, visualization, and decision intelligence.</p></article>
            <article><span>04</span><h3>Trust & governance</h3><p>Privacy by design, Zero Trust, identity, permissions, and auditable system behavior.</p></article>
          </div>
          <div className="industries"><strong>Across industries</strong><p>Healthcare · Financial systems · Public safety · Education · Automotive · Sports & gaming · Media · Enterprise</p></div>
        </section>

        <section id="contact" className="section contact">
          <div>
            <div className="section-label">06 / CONTACT</div>
            <h2>Let’s build<br /><em>what comes next.</em></h2>
            <p>Have a project, a research question, or a partnership in mind? Start a conversation with PICEUS.</p>
            <a className="email-link" href={`mailto:${contactEmail}`}>Contact William Weems</a>
            <span className="contact-location">Atlanta, Georgia · Working across industries and borders</span>
          </div>
          <form id="contact-form" onSubmit={handleContactSubmit}>
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
            <button type="submit" className="button primary">Prepare email</button>
            <p className="form-note" id="form-status" role="status">Opens your email app with your inquiry. Nothing is sent from this website.</p>
          </form>
        </section>
      </main>
      <footer>
        <div className="footer-main">
          <div className="footer-brand"><img src="assets/piceus-logo.svg" alt="PICEUS" /><p>Intelligence, connected.</p><small>Agentic systems. Original thinking.<br />Human purpose.</small></div>
          <div><h3>Company</h3><a href="#home">Home</a><a href="#about">About</a><a href="#work">Our Work</a><a href="#contact">Contact</a></div>
          <div><h3>Explore</h3><a href="#platform">The Platform</a><a href="#research">Research & Development</a><a href="#capabilities">Capabilities</a></div>
          <div><h3>Connect</h3><a href={`mailto:${contactEmail}`}>Email PICEUS</a><span>Atlanta, Georgia</span><span>Founder · William Weems</span></div>
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

function MatrixAccessPanel({
  authError,
  forgotPasswordUrl,
  loading,
  matrixProductName,
  onClearError,
  onLogin,
  registerUrl,
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    onClearError();
    try {
      await onLogin(email, password);
      setPassword('');
    } catch {
      // Error state is already surfaced by the hook.
    }
  };

  return (
    <div id="matrix-access" className="auth-card">
      <div className="auth-card-header">
        <span className="matrix-badge">Sign in to continue</span>
        <h3>{matrixProductName} access</h3>
        <p>Use the existing MATRIX account system that currently powers the live app. Tokens are stored with the same keys used by the deployed shell.</p>
      </div>
      <form className="matrix-auth-form" onSubmit={handleSubmit}>
        <label htmlFor="matrix-email">Email</label>
        <input
          id="matrix-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          placeholder="you@example.com"
        />
        <label htmlFor="matrix-password">Password</label>
        <input
          id="matrix-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          placeholder="••••••••"
        />
        {authError ? <p className="auth-error">{authError}</p> : null}
        <div className="auth-actions">
          <button type="submit" className="button primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
          <a className="button outline dark-outline" href={registerUrl}>Create account</a>
        </div>
        <div className="auth-links-row">
          <a href={forgotPasswordUrl}>Forgot password?</a>
          <span>Existing live account flow</span>
        </div>
      </form>
    </div>
  );
}

function MatrixHomePanel({
  legacyOriginLabel,
  legacyOriginUrl,
  matrixOverview,
  onLogout,
  user,
}) {
  const metrics = matrixOverview.metrics;
  const status = matrixOverview.status;
  const alerts = matrixOverview.alerts || [];

  return (
    <div className="auth-card authenticated-card">
      <div className="auth-card-header">
        <span className="matrix-badge">Session live</span>
        <h3>Welcome back, {user?.name || 'Matrix Member'}.</h3>
        <p>{user?.role || 'Authenticated user'} now lands on the PICEUS homepage experience inside the MATRIX umbrella.</p>
      </div>
      <div className="auth-actions home-actions">
        <a className="button primary" href={legacyOriginUrl}>Open current MATRIX shell</a>
        <button type="button" className="button outline dark-outline" onClick={onLogout}>Sign out</button>
      </div>
      {matrixOverview.error ? <p className="auth-error">{matrixOverview.error}</p> : null}
      <div className="metric-grid">
        <MetricCard label="System status" value={status?.status || (matrixOverview.loading ? 'Loading' : 'Unknown')} />
        <MetricCard label="Uptime" value={status?.uptime || 'Unavailable'} />
        <MetricCard label="CPU" value={`${metrics?.cpu?.percent ?? 0}%`} />
        <MetricCard label="Memory" value={`${metrics?.memory?.percent ?? 0}%`} />
      </div>
      <div className="alert-strip">
        <strong>Live alerts</strong>
        <div>
          {alerts.length ? alerts.map((alert, index) => (
            <span key={`${alert.title || 'alert'}-${index}`}>{alert.title || alert.message || 'Active alert'}</span>
          )) : <span>{matrixOverview.loading ? 'Loading alert stream...' : `${legacyOriginLabel} connected`}</span>}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
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
