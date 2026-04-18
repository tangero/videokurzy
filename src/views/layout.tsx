import type { FC, PropsWithChildren } from "hono/jsx";

interface LayoutProps {
  title?: string;
  description?: string;
  user?: { name: string | null; email: string } | null;
}

const CSS = `
:root {
  color-scheme: light;
  --bg: #f7f6f3;
  --bg-2: #f1efe8;
  --surface: #ffffff;
  --surface-dim: rgba(255,255,255,0.7);
  --ink: #141413;
  --ink-soft: #2a2925;
  --muted: #5d5a52;
  --accent: #2f7a5b;
  --accent-2: #1f4f3b;
  --on-accent: #ffffff;
  --border: rgba(20,20,19,0.12);
  --border-strong: rgba(20,20,19,0.24);
  --shadow: 0 16px 40px rgba(13,12,10,0.08);
  --shadow-sm: 0 6px 18px rgba(20,20,19,0.06);
  --shadow-lg: 0 30px 80px rgba(13,12,10,0.14);
  --accent-subtle: rgba(47,122,91,0.06);
  --accent-muted: rgba(47,122,91,0.08);
  --accent-light: rgba(47,122,91,0.12);
  --accent-medium: rgba(47,122,91,0.15);
  --accent-hover: rgba(47,122,91,0.18);
  --accent-border: rgba(47,122,91,0.3);
  --warning-bg: rgba(255,207,115,0.3);
  --warning-text: #7a5a12;
  --warning-border: rgba(255,207,115,0.8);
  --danger: #b04747;
  --danger-2: #8f3636;
  --error-bg: #fef2f2;
  --error-border: #fca5a5;
  --error-text: #991b1b;
  --header-bg: rgba(247,246,243,0.85);
  --hover-bg: rgba(255,255,255,0.6);
  --code-bg: #f5f3ef;
  --code-ink: #d44a3c;
  --font-body: "Space Grotesk", system-ui, -apple-system, "Helvetica Neue", sans-serif;
  --font-head: "Space Grotesk", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: radial-gradient(circle at top, var(--bg-2), var(--bg));
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 18px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
  min-height: 100vh;
}
h1, h2, h3, h4 {
  font-family: var(--font-head);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0;
}
h1 { font-weight: 700; letter-spacing: -0.02em; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
a:hover { color: var(--accent-2); }
button { font-family: inherit; cursor: pointer; border: 0; background: none; color: inherit; }
input, textarea, select { font-family: inherit; font-size: inherit; color: inherit; }

/* LAYOUT */
.container { width: min(1040px, 92vw); margin: 0 auto; }
.container-narrow { width: min(760px, 92vw); margin: 0 auto; }
.page { min-height: 100vh; display: flex; flex-direction: column; }
.main { flex: 1; padding: 36px 0 72px; }
.section { margin-top: 64px; }
.section-header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 24px; }
.section-header h2 { font-family: var(--font-head); font-size: clamp(1.5rem, 2vw, 1.9rem); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.section-subtitle { color: var(--muted); font-size: 0.95rem; }

/* HEADER */
.site-header {
  position: sticky; top: 0; z-index: 20;
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.header-inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; }
.brand { display: flex; align-items: center; gap: 14px; color: inherit; text-decoration: none; }
.brand:hover { color: inherit; text-decoration: none; }
.avatar {
  width: 48px; height: 48px; border-radius: 14px;
  border: 1px solid var(--border);
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-family: var(--font-mono); font-weight: 600; font-size: 15px;
  box-shadow: var(--shadow-sm);
  overflow: hidden; flex-shrink: 0;
}
.brand-title { font-family: var(--font-head); font-weight: 700; font-size: 1.05rem; line-height: 1.2; }
.brand-subtitle { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); letter-spacing: 0.02em; }
.nav { display: flex; gap: 6px; font-family: var(--font-mono); font-size: 0.82rem; }
.nav a {
  color: var(--ink); text-decoration: none;
  padding: 8px 12px; border-radius: 8px;
  border: 1px solid transparent;
}
.nav a:hover { border-color: var(--border); background: var(--hover-bg); }
.nav a.active { border-color: var(--accent-border); background: var(--accent-muted); color: var(--accent-2); }
.header-actions { display: flex; align-items: center; gap: 10px; }

/* BUTTONS */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: 10px;
  border: 1px solid transparent;
  background: var(--accent); color: var(--on-accent);
  font-family: var(--font-mono); font-size: 0.85rem; font-weight: 500;
  text-decoration: none; white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s, transform .08s;
  cursor: pointer;
}
.btn:hover { background: var(--accent-2); color: var(--on-accent); text-decoration: none; }
.btn:active { transform: translateY(1px); }
.btn-ghost { background: transparent; color: var(--ink); border-color: var(--border); }
.btn-ghost:hover { background: var(--hover-bg); color: var(--ink); border-color: var(--border-strong); }
.btn-ink { background: var(--ink); color: var(--bg); }
.btn-ink:hover { background: #000; color: var(--bg); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { background: var(--danger-2); color: #fff; }
.btn-sm { padding: 7px 12px; font-size: 0.78rem; border-radius: 8px; }
.btn-lg { padding: 14px 22px; font-size: 0.95rem; border-radius: 12px; }
.btn-block { width: 100%; }
.btn .arrow { display: inline-block; transition: transform .15s; }
.btn:hover .arrow { transform: translateX(3px); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* PILLS */
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500;
  background: var(--accent-light); color: var(--accent-2);
  border: 1px solid var(--accent-border);
}
.pill-ghost { background: var(--hover-bg); color: var(--muted); border-color: var(--border); }
.pill-ink { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.pill-warning { background: var(--warning-bg); color: var(--warning-text); border-color: var(--warning-border); }
.eyebrow {
  font-family: var(--font-mono); color: var(--accent-2);
  text-transform: lowercase; letter-spacing: 0.06em;
  font-size: 0.82rem; margin-bottom: 10px;
}
.kicker {
  font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--muted);
  display: inline-flex; align-items: center; gap: 8px;
}
.kicker::before { content: ""; width: 24px; height: 1px; background: currentColor; }

/* CARD */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 22px; box-shadow: var(--shadow-sm);
}
.card-dim { background: var(--surface-dim); }
.card-compact { padding: 14px 16px; }

/* INPUT */
.input, textarea.input {
  width: 100%;
  border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 14px;
  background: var(--surface);
  font-family: var(--font-body); font-size: 1rem;
  transition: border-color .15s, box-shadow .15s;
}
.input:focus-visible {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.label { font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); display: block; margin-bottom: 6px; }

/* PROGRESS */
.progress { height: 6px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
.progress > span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width .5s ease; }

/* HERO */
.hero {
  display: grid; grid-template-columns: 1.15fr 0.95fr; gap: 40px;
  align-items: center; padding: 48px 0 32px;
}
.hero h1 {
  font-family: var(--font-head); font-weight: 700;
  font-size: clamp(2rem, 3.8vw, 3.4rem);
  line-height: 1.08; letter-spacing: -0.02em;
  margin: 12px 0 18px;
}
.hero .lede { font-size: 1.08rem; color: var(--muted); margin: 0 0 24px; max-width: 52ch; }
.hero-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.hero-meta { display: flex; gap: 18px; margin-top: 24px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); flex-wrap: wrap; }
.hero-meta .dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: 0.4; align-self: center; }

/* TERMINAL */
.terminal {
  border: 1px solid var(--border); border-radius: 14px;
  background: #0f1412; color: #cfe9dc;
  box-shadow: var(--shadow); overflow: hidden;
}
.terminal-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; background: #101815;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.terminal-dot { width: 10px; height: 10px; border-radius: 50%; }
.terminal-dot.red { background: #ef7f6d; }
.terminal-dot.amber { background: #f4c370; }
.terminal-dot.green { background: #6ed19d; }
.terminal-title { margin-left: auto; font-family: var(--font-mono); font-size: 0.7rem; color: rgba(207,233,220,0.55); }
.terminal-body {
  padding: 20px 22px; font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.75;
  white-space: pre-wrap; word-break: break-word;
}
.terminal-body .cmt { color: #7fa894; }
.terminal-body .pmt { color: #9ed0b3; }
.terminal-body .str { color: #f4c370; }
.terminal-body .kw { color: #8fbbe0; }
.terminal-body .ok { color: #6ed19d; }
.terminal-body .cursor {
  display: inline-block; width: 8px; height: 1em;
  background: #6ed19d; vertical-align: -2px;
  animation: blink 1s steps(1) infinite; margin-left: 2px;
}

/* MODULE / LESSON LIST */
.module-list { display: grid; gap: 24px; }
.module {
  border: 1px solid var(--border); border-radius: 16px;
  background: var(--surface); overflow: hidden;
  transition: border-color .15s;
}
.module-head {
  display: flex; align-items: baseline; gap: 12px;
  padding: 18px 20px; border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-2), transparent);
}
.module-index { font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-2); letter-spacing: 0.1em; }
.module-title { font-family: var(--font-head); font-weight: 600; font-size: 1.1rem; letter-spacing: -0.01em; margin: 0; }
.module-meta { margin-left: auto; font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); }
.lesson {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 20px; border-top: 1px solid var(--border);
  cursor: pointer; transition: background .12s;
}
.lesson:first-of-type { border-top: 0; }
.lesson:hover { background: var(--hover-bg); }
.lesson-num { font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); width: 32px; flex-shrink: 0; }
.lesson-title { flex: 1; font-size: 0.98rem; font-weight: 500; }
.lesson-sub { display: block; font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); margin-top: 2px; font-weight: 400; letter-spacing: 0.02em; }
.lesson-duration { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); }
.lesson-icon { width: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
.lesson.locked { opacity: 0.85; cursor: default; }
.lesson a { color: inherit; text-decoration: none; }
.lesson a:hover { color: var(--accent); }

/* PRICING */
.pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.price-card {
  border: 1px solid var(--border); border-radius: 18px;
  background: var(--surface); padding: 28px;
  display: flex; flex-direction: column; gap: 16px;
  position: relative;
}
.price-card.featured { border-color: var(--accent-border); background: linear-gradient(180deg, var(--accent-subtle), var(--surface)); }
.price-card h3 { font-family: var(--font-head); font-size: 1.2rem; font-weight: 600; margin: 0; }
.price-number { font-family: var(--font-head); font-size: 2.6rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.price-number small { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 400; color: var(--muted); margin-left: 4px; }
.price-features { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 0.92rem; color: var(--ink-soft); }
.price-features li { display: flex; gap: 10px; align-items: flex-start; }
.price-features .check { flex-shrink: 0; margin-top: 3px; color: var(--accent); }

/* TESTIMONIALS */
.quotes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
.quote-card {
  border: 1px solid var(--border); border-radius: 16px;
  background: var(--surface); padding: 22px;
  display: flex; flex-direction: column; gap: 14px;
}
.quote-body { font-family: var(--font-head); font-weight: 600; font-size: 1.02rem; line-height: 1.5; letter-spacing: -0.01em; color: var(--ink); }
.quote-person { display: flex; align-items: center; gap: 10px; margin-top: auto; }
.quote-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-2); display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted);
  border: 1px solid var(--border); flex-shrink: 0;
}
.quote-name { font-size: 0.88rem; font-weight: 600; }
.quote-role { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); }

/* BIO */
.bio {
  display: grid; grid-template-columns: 180px 1fr; gap: 28px; align-items: start;
  padding: 32px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface);
}
.bio-photo {
  width: 180px; height: 220px; border-radius: 16px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  position: relative; overflow: hidden; border: 1px solid var(--border);
  display: flex; align-items: flex-end; justify-content: center;
  color: rgba(255,255,255,0.85); font-family: var(--font-mono); font-size: 0.72rem;
}
.bio-photo::before {
  content: ""; position: absolute; inset: 0;
  background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 14px);
}
.bio-photo span { position: relative; padding: 8px; text-align: center; }
.bio h3 { font-family: var(--font-head); font-size: 1.4rem; font-weight: 600; margin: 0 0 6px; }
.bio-sub { font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-2); margin-bottom: 14px; }
.bio p { margin: 0 0 12px; color: var(--ink-soft); }
.bio-links { display: flex; gap: 14px; font-family: var(--font-mono); font-size: 0.82rem; margin-top: 8px; flex-wrap: wrap; }
.bio-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 14px; }

/* FAQ */
.faq { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); overflow: hidden; }
.faq details { border-top: 1px solid var(--border); }
.faq details:first-child { border-top: 0; }
.faq summary {
  padding: 18px 22px; cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 14px;
  font-family: var(--font-head); font-weight: 500; font-size: 1rem;
}
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; margin-left: auto; font-family: var(--font-mono); color: var(--muted); font-size: 1.2rem; transition: transform .2s; }
.faq details[open] summary::after { content: "−"; }
.faq-body { padding: 0 22px 18px; color: var(--muted); }

/* VIDEO PLAYER */
.video-wrap {
  position: relative; width: 100%; aspect-ratio: 16/9;
  background: #0a0a0c; border-radius: 16px; overflow: hidden;
  border: 1px solid var(--border); box-shadow: var(--shadow);
}
.video-wrap iframe {
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
}

/* CTA BANNER */
.banner-upgrade {
  border: 1px solid var(--accent-border); border-radius: 18px;
  background: linear-gradient(135deg, var(--accent-light), var(--accent-muted));
  padding: 24px 26px;
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
}
.banner-upgrade h4 { font-family: var(--font-head); font-size: 1.15rem; margin: 0 0 4px; }
.banner-upgrade p { margin: 0; color: var(--ink-soft); font-size: 0.95rem; }

/* ADMIN TABLE */
.admin-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
.stat-card { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 16px 18px; }
.stat-label { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.stat-value { font-family: var(--font-head); font-size: 1.9rem; font-weight: 700; letter-spacing: -0.01em; margin-top: 6px; font-variant-numeric: tabular-nums; }
.stat-delta { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent-2); margin-top: 4px; }
.table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.table th, .table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
.table th { background: var(--bg-2); font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.table td { font-size: 0.92rem; }
.table td.num { font-family: var(--font-mono); font-size: 0.88rem; font-variant-numeric: tabular-nums; }
.table tr:last-child td { border-bottom: 0; }
.table tr:hover td { background: var(--accent-subtle); }
.table .mono { font-family: var(--font-mono); font-size: 0.85rem; }

/* FOOTER */
.site-footer { border-top: 1px solid var(--border); padding: 24px 0 36px; font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); margin-top: 64px; }
.footer-inner { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.footer-links a { margin-left: 14px; color: var(--muted); text-decoration: none; }
.footer-links a:hover { color: var(--accent); }

/* UTILITIES */
.hstack { display: flex; align-items: center; gap: 10px; }
.vstack { display: flex; flex-direction: column; gap: 10px; }
.spacer { flex: 1; }
.mono { font-family: var(--font-mono); font-size: 0.82rem; }
.muted { color: var(--muted); }

/* ANIMATIONS */
@keyframes blink { 50% { opacity: 0; } }
@keyframes checkPop { 0% { transform: scale(.3); opacity: 0; } 60% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1); } }
.check-pop { animation: checkPop .35s cubic-bezier(.2,.7,.2,1.2); display: inline-block; }
@keyframes flashGood { 0%, 100% { background: transparent; } 20% { background: var(--accent-light); } }
.flash-good { animation: flashGood 1.2s ease; }

/* FOCUS */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* SKIP LINK */
.skip-link {
  position: absolute; top: -100%; left: 8px;
  background: var(--accent); color: var(--on-accent);
  padding: 8px 16px; border-radius: 0 0 8px 8px;
  font-family: var(--font-mono); font-size: 0.85rem;
  text-decoration: none; z-index: 999;
  transition: top .15s;
}
.skip-link:focus { top: 0; color: var(--on-accent); text-decoration: none; }

/* REDUCED MOTION */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* MOBILE MENU */
.mobile-menu { position: relative; display: none; }
.mobile-menu > summary {
  list-style: none;
  display: flex; align-items: center; gap: 7px;
  padding: 9px 13px; border-radius: 9px;
  border: 1px solid var(--border);
  color: var(--ink); font-family: var(--font-mono); font-size: 0.78rem;
  cursor: pointer; background: transparent; user-select: none;
}
.mobile-menu > summary::-webkit-details-marker { display: none; }
.mobile-menu[open] > summary { border-color: var(--accent-border); background: var(--accent-muted); color: var(--accent-2); }
.mobile-menu-panel {
  position: absolute; top: calc(100% + 8px); right: 0;
  min-width: 210px; z-index: 100;
  background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: 14px; box-shadow: var(--shadow);
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
}
.mobile-menu-divider { height: 1px; background: var(--border); margin: 4px 2px; }
.mobile-menu-link {
  display: flex; align-items: center; width: 100%; text-align: left;
  min-height: 44px; padding: 10px 14px; border-radius: 8px; border: none;
  color: var(--ink); text-decoration: none;
  font-family: var(--font-mono); font-size: 0.82rem;
  cursor: pointer; background: none;
  transition: background .1s;
}
.mobile-menu-link:hover { background: var(--hover-bg); color: var(--accent); }
.mobile-menu-panel form { margin: 0; }

/* RESPONSIVE */
@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr; padding: 24px 0; }
}
@media (max-width: 720px) {
  body { font-size: 16px; }
  .main { padding: 20px 0 48px; }
  .hero { padding: 16px 0; }
  .section { margin-top: 44px; }
  .brand-subtitle { display: none; }
  .nav { display: none; }
  .bio { grid-template-columns: 1fr; padding: 22px; }
  .pricing-grid { grid-template-columns: 1fr; }
  .mobile-menu { display: block; }
  .header-actions { display: none; }
  .btn { min-height: 44px; }
  .btn-sm { min-height: 44px; }
  .mobile-menu > summary { min-height: 44px; }
}
`;

const HamburgerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title = "Videokurz Claude Code s Patrickem",
  description = "Naučte se vibe coding s Claude Code. 10 epizod, od nápadu po deployment.",
  user,
  children,
}) => (
  <html lang="cs">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} | kurz.vibecoding.cz</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://kurz.vibecoding.cz" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <script
        src="https://unpkg.com/htmx.org@2.0.4"
        integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+"
        crossorigin="anonymous"
      ></script>
    </head>
    <body class="page" hx-boost="true">
      <a class="skip-link" href="#main-content">přeskočit na obsah</a>
      <header class="site-header">
        <div class="container header-inner">
          <a class="brand" href="/">
            <div class="avatar">kz</div>
            <div>
              <div class="brand-title">kurz.vibecoding.cz</div>
              <div class="brand-subtitle">videokurzy vibe codingu</div>
            </div>
          </a>
          <nav class="nav" aria-label="Hlavní navigace">
            <a href="/#obsah">obsah</a>
            <a href="/#cenik">ceník</a>
            <a href="/#reference">reference</a>
            <a href="/#faq">faq</a>
          </nav>
          <div class="header-actions">
            {user ? (
              <>
                <a class="btn btn-ghost btn-sm" href="/dashboard">
                  můj kurz
                </a>
                <form method="post" action="/logout" style="margin:0;display:inline">
                  <button type="submit" class="btn btn-ghost btn-sm">
                    odhlásit
                  </button>
                </form>
              </>
            ) : (
              <>
                <a class="btn btn-ghost btn-sm" href="/login">
                  přihlásit
                </a>
                <a class="btn btn-sm" href="/#cenik">
                  koupit kurz
                </a>
              </>
            )}
          </div>

          <details class="mobile-menu">
            <summary aria-label="Otevřít navigaci">
              <HamburgerIcon /> menu
            </summary>
            <div class="mobile-menu-panel">
              <a class="mobile-menu-link" href="/#obsah" onclick="this.closest('details').open=false">obsah</a>
              <a class="mobile-menu-link" href="/#cenik" onclick="this.closest('details').open=false">ceník</a>
              <a class="mobile-menu-link" href="/#reference" onclick="this.closest('details').open=false">reference</a>
              <a class="mobile-menu-link" href="/#faq" onclick="this.closest('details').open=false">faq</a>
              <div class="mobile-menu-divider"></div>
              {user ? (
                <>
                  <a class="mobile-menu-link" href="/dashboard">můj kurz</a>
                  <form method="post" action="/logout" style="margin:0">
                    <button type="submit" class="mobile-menu-link">odhlásit</button>
                  </form>
                </>
              ) : (
                <>
                  <a class="mobile-menu-link" href="/login">přihlásit</a>
                  <a class="mobile-menu-link" href="/#cenik" onclick="this.closest('details').open=false">koupit kurz</a>
                </>
              )}
            </div>
          </details>
        </div>
      </header>

      <main class="main" id="main-content">{children}</main>

      <footer class="site-footer">
        <div class="container footer-inner">
          <div>
            &copy; 2026{" "}
            <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">
              vibecoding.cz
            </a>
            {" "}&mdash; projekt Patricka Zandla
          </div>
          <div class="footer-links">
            <a href="/privacy">ochrana osobních údajů</a>
            <a href="/terms">obchodní podmínky</a>
            <a href="mailto:patrick@vibecoding.cz">kontakt</a>
          </div>
        </div>
      </footer>
    </body>
  </html>
);
