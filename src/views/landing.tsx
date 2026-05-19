import type { FC } from "hono/jsx";
import { Layout } from "./layout";

type DiscountStageView =
  | { kind: "off" }
  | {
      kind: "auto";
      percent: number;
      label: string;
      slotsTotal: number;
      slotsLeft: number;
      slotsUsed: number;
      codeActive: boolean;
    }
  | {
      kind: "code-only";
      percent: number;
      label: string;
      codeExpiresAt: Date | null;
    };

interface LandingProps {
  user?: { name: string | null; email: string; role?: string } | null;
  modules?: Array<{
    id: number;
    title: string;
    lessons: Array<{
      id: number;
      slug: string;
      title: string;
      durationSeconds: number;
      isFree: boolean;
      sortOrder: number;
    }>;
  }>;
  userHasAccess?: boolean;
  priceIndividual?: number;
  priceOrganization?: number;
  benefitsIndividual?: string[];
  benefitsOrganization?: string[];
  discount?: DiscountStageView;
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

const TESTIMONIALS = [
  { body: "Konečně česky, strukturovaně a od někoho, komu věřím. Za měsíc jsem postavil interní tool, na který jsme měsíce čekali na IT.", name: "Marek K.", role: "Projektový manažer", initials: "MK" },
  { body: "Nasadili jsme firemní licenci pro 40 lidí. Lidi se sami hlásí, že chtějí Claude Code zkusit na svoje projekty.", name: "Jana H.", role: "L&D, Česká pojišťovna", initials: "JH" },
  { body: "Patrick nenatáčí Silicon Valley hype. Je to pragmatický průvodce pro lidi, kteří chtějí mít hotovo.", name: "Tomáš V.", role: "Junior developer", initials: "TV" },
  { body: "Modul o designu mi zachránil projekt. Do té doby jsem měl výstup „funguje, ale vypadá to jako test\".", name: "Lenka D.", role: "Produktová manažerka", initials: "LD" },
];

const FAQ_ITEMS = [
  { q: "Potřebuju umět programovat?", a: "Ne. Kurz je stavěný pro netechnické lidi — projektové manažery, analytiky, produkťáky. Pracujeme s přirozeným jazykem, ne se syntaxí." },
  { q: "Co když mi to nesedne?", a: "První modul (3 epizody) je zdarma — vyzkoušíte si to bez rizika. Pak máte 14 dní na refund, pokud jste prošli méně než polovinou." },
  { q: "Jak dlouho mám přístup?", a: "Jeden rok od nákupu. Obnovuje se automaticky, ale kdykoliv můžete zrušit ve Stripe Customer Portalu." },
  { q: "Firemní licence — jak to funguje?", a: "Zaplatíte 15 000 Kč/rok a uvedete doménu (např. firma.cz). Všichni zaměstnanci s emailem na té doméně se mohou přihlásit magic linkem a mají přístup k celému obsahu." },
  { q: "Dostanu fakturu?", a: "Ano, automaticky přes Stripe. Pro firmy dodáváme standardní daňový doklad v CZK." },
  { q: "Budou další kurzy?", a: "Ano. Předplatné je na celou platformu — jakmile vydáme další kurz, máte k němu přístup automaticky." },
];

const CheckIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const LockIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const PlaySmIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

const ArrowIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

function fmtPrice(czk: number): string {
  return czk.toLocaleString("cs-CZ") + " Kč";
}

export const LandingPage: FC<LandingProps> = ({
  user,
  modules = [],
  userHasAccess = false,
  priceIndividual = 2000,
  priceOrganization = 15000,
  benefitsIndividual = [],
  benefitsOrganization = [],
  discount = { kind: "off" },
}) => {
  const allLessons = modules.flatMap((m) => m.lessons);
  const totalSeconds = allLessons.reduce((s, l) => s + l.durationSeconds, 0);
  const lessonCount = allLessons.length;
  const freeCount = allLessons.filter((l) => l.isFree).length;
  const canAccessAll = userHasAccess;
  const showAutoDiscount = discount.kind === "auto";
  const showCodeHint = discount.kind === "code-only";
  const discountedIndividual = showAutoDiscount
    ? Math.floor((priceIndividual * (100 - discount.percent)) / 100)
    : priceIndividual;
  const discountedOrganization = showAutoDiscount
    ? Math.floor((priceOrganization * (100 - discount.percent)) / 100)
    : priceOrganization;
  return (
  <Layout user={user}>
    <div class="container">
      {/* Hero */}
      <section class="hero">
        <div>
          <div class="eyebrow">// videokurz · sezóna 01</div>
          <h1>Claude Code s&nbsp;Patrickem — vibe&nbsp;coding pro&nbsp;netechnické&nbsp;lidi.</h1>
          <p class="lede">
            Deset epizod, jedna aplikace, žádný bullshit. Od prázdného editoru k&nbsp;nasazené
            aplikaci — bez&nbsp;programování, s&nbsp;Claudem jako parťákem.
          </p>
          <div class="hero-actions">
            <a class="btn btn-lg" href="#cenik">
              koupit kurz{" "}
              <span class="arrow">
                <ArrowIcon />
              </span>
            </a>
            <a class="btn btn-ghost btn-lg" href="#obsah">
              {freeCount > 0 ? `${freeCount === 1 ? "první epizoda" : `první ${freeCount} epizody`} zdarma` : "část epizod zdarma"}
            </a>
          </div>
          <div class="hero-meta">
            <span>{lessonCount > 0 ? `${lessonCount} epizod` : "10 epizod"}</span>
            <span class="dot"></span>
            <span>{totalSeconds > 0 ? `${fmtTotalDuration(totalSeconds)} videa` : "4 h 45 min videa"}</span>
            <span class="dot"></span>
            <span>česky, od&nbsp;Patricka&nbsp;Zandla</span>
          </div>
        </div>
        <div
          class="terminal"
          aria-hidden="true"
          style="font-size:0.88rem"
        >
          <div class="terminal-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot amber"></span>
            <span class="terminal-dot green"></span>
            <span class="terminal-title">~/projects/muj-prvni-tool</span>
          </div>
          <div class="terminal-body">
            <span class="cmt"># Epizoda 02 — „wow moment"</span>{"\n"}
            <span class="pmt">$</span>
            {" claude "}
            <span class="kw">--prompt</span>
            {" "}
            <span class="str">"postav mi formulář na sběr zpětné vazby"</span>
            {"\n\n  "}
            <span class="ok">✓</span>
            {" analyzuji záměr...\n  "}
            <span class="ok">✓</span>
            {" navrhuji strukturu komponent\n  "}
            <span class="ok">✓</span>
            {" generuji React + Tailwind\n  "}
            <span class="ok">✓</span>
            {" přidávám validaci a odesílání\n\n"}
            <span class="cmt"># „Řekneš, co chceš. Claude udělá, jak."</span>
            {"\n"}
            <span class="pmt">$</span>
            {" "}
            <span class="cursor"></span>
          </div>
        </div>
      </section>

      {/* Obsah kurzu */}
      <section class="section" id="obsah">
        <div class="section-header">
          <div>
            <div class="kicker">obsah kurzu</div>
            <h2>Claude Code s Patrickem</h2>
          </div>
          <div class="section-subtitle">
            {freeCount > 0 && (
              <span class="pill">
                {freeCount === 1 ? "první epizoda zdarma" : `první ${freeCount} epizody zdarma`}
              </span>
            )}
          </div>
        </div>
        <div class="module-list">
          {modules.map((m, mi) => (
            <div class="module">
              <div class="module-head">
                <div>
                  <div class="module-index">
                    modul {String(mi + 1).padStart(2, "0")}
                  </div>
                  <h3 class="module-title">{m.title}</h3>
                </div>
                <div class="module-meta">
                  {m.lessons.length} epizod
                </div>
              </div>
              {m.lessons.map((l, li) => {
                const accessible = l.isFree || canAccessAll;
                const href = accessible ? `/watch/${l.slug}` : "/#cenik";
                return (
                  <a href={href} class={`lesson no-underline ${l.isFree || canAccessAll ? "" : "locked"}`}
                    style="display:flex;align-items:center;gap:inherit;color:inherit">
                    <span class="lesson-num">{String(li + 1).padStart(2, "0")}</span>
                    <span class="lesson-icon">
                      {accessible ? (
                        <span style="color:var(--accent)">
                          <PlaySmIcon />
                        </span>
                      ) : (
                        <span style="color:var(--muted)">
                          <LockIcon />
                        </span>
                      )}
                    </span>
                    <div class="lesson-title">
                      {l.title}
                    </div>
                    <span class="lesson-duration">{fmtDuration(l.durationSeconds)}</span>
                  </a>
                );
              })}
            </div>
          ))}
          {modules.length === 0 && (
            <p style="color:var(--muted);text-align:center;padding:2rem 0">
              Obsah kurzu se připravuje.
            </p>
          )}
        </div>
      </section>

      {/* Ceník */}
      <section class="section" id="cenik">
        <div class="section-header">
          <div>
            <div class="kicker">ceník</div>
            <h2>Dvě cesty — osobní a&nbsp;firemní.</h2>
          </div>
        </div>
        <div class="pricing-grid">
          <div class="price-card featured">
            <div>
              <span class="pill">pro jednotlivce</span>
              <h3 style="margin-top:10px">Osobní předplatné</h3>
            </div>
            {showAutoDiscount ? (
              <>
                <div
                  style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"
                  class="price-number"
                >
                  <span>{fmtPrice(discountedIndividual)}<small>/ rok</small></span>
                  <span style="font-size:0.55em;color:var(--muted);text-decoration:line-through;font-weight:400">
                    {fmtPrice(priceIndividual)}
                  </span>
                </div>
                <div
                  style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:0.78rem;font-weight:600;margin-top:-4px;margin-bottom:8px"
                >
                  🔥 {discount.label || `Sleva ${discount.percent} %`} — zbývá {discount.slotsLeft} / {discount.slotsTotal} slotů
                </div>
              </>
            ) : (
              <div class="price-number">
                {fmtPrice(priceIndividual)}<small>/ rok</small>
              </div>
            )}
            <ul class="price-features">
              {benefitsIndividual.map((b) => (
                <li>
                  <span class="check"><CheckIcon /></span>
                  {b}
                </li>
              ))}
            </ul>
            <a href="/checkout/individual" class="btn btn-block btn-lg" style="text-decoration:none">
              koupit za {fmtPrice(showAutoDiscount ? discountedIndividual : priceIndividual)}
            </a>
            <div class="mono muted" style="text-align:center">
              platba kartou nebo převodem
            </div>
            {showCodeHint && (
              <div class="mono muted" style="text-align:center;font-size:0.75rem">
                💌 Máte zaváděcí kód? Vlož ho v košíku.
              </div>
            )}
          </div>
          <div class="price-card">
            <div>
              <span class="pill pill-ghost">pro firmy</span>
              <h3 style="margin-top:10px">Firemní licence</h3>
            </div>
            {showAutoDiscount ? (
              <>
                <div
                  style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"
                  class="price-number"
                >
                  <span>{fmtPrice(discountedOrganization)}<small>/ rok</small></span>
                  <span style="font-size:0.55em;color:var(--muted);text-decoration:line-through;font-weight:400">
                    {fmtPrice(priceOrganization)}
                  </span>
                </div>
                <div
                  style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:0.78rem;font-weight:600;margin-top:-4px;margin-bottom:8px"
                >
                  🔥 {discount.label || `Sleva ${discount.percent} %`} — zbývá {discount.slotsLeft} / {discount.slotsTotal} slotů
                </div>
              </>
            ) : (
              <div class="price-number">
                {fmtPrice(priceOrganization)}<small>/ rok</small>
              </div>
            )}
            <ul class="price-features">
              {benefitsOrganization.map((b) => (
                <li>
                  <span class="check"><CheckIcon /></span>
                  {b}
                </li>
              ))}
            </ul>
            <a href="/checkout/organization" class="btn btn-ghost btn-block btn-lg" style="text-decoration:none">
              koupit firemní licenci
            </a>
            <div class="mono muted" style="text-align:center">
              platba kartou nebo převodem, aktivace do 24&nbsp;h po&nbsp;schválení
            </div>
            {showCodeHint && (
              <div class="mono muted" style="text-align:center;font-size:0.75rem">
                💌 Máte zaváděcí kód? Vlož ho v košíku.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section class="section" id="reference">
        <div class="section-header">
          <div>
            <div class="kicker">reference</div>
            <h2>Co říkají ti, kdo už&nbsp;začali.</h2>
          </div>
        </div>
        <div class="quotes">
          {TESTIMONIALS.map((t) => (
            <div class="quote-card">
              <div class="quote-body">&bdquo;{t.body}&ldquo;</div>
              <div class="quote-person">
                <div class="quote-avatar">{t.initials}</div>
                <div>
                  <div class="quote-name">{t.name}</div>
                  <div class="quote-role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bio */}
      <section class="section" id="bio">
        <div class="section-header">
          <div>
            <div class="kicker">lektor</div>
            <h2>Kdo za kurzem stojí.</h2>
          </div>
        </div>
        <div class="bio">
          <div class="bio-photo">
            <span>patrick@vibecoding.cz</span>
          </div>
          <div>
            <h3>Patrick Zandl</h3>
            <div class="bio-sub">// autor &amp; lektor</div>
            <div class="bio-tags">
              <span class="pill pill-ghost">novinář</span>
              <span class="pill pill-ghost">produktový manažer</span>
              <span class="pill pill-ghost">vibecoding.cz</span>
            </div>
            <p>
              Patrick je novinář, produktový manažer a autor blogu{" "}
              <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">
                vibecoding.cz
              </a>
              , kde přes rok mapuje českou realitu práce s&nbsp;AI. Spoluzakladatel Mobil.cz,
              Stream.cz a někdejší koordinátor vývoje v Prusa Research. Učí lidi, jak s&nbsp;pomocí
              Claudu postavit skutečné věci — bez Silicon Valley hype a bez předpokladu, že umíte
              programovat.
            </p>
            <p>
              V&nbsp;kurzu provází stejným stylem, jakým píše: pragmaticky, česky
              a&nbsp;s&nbsp;příběhy z&nbsp;praxe.
            </p>
            <div class="bio-links">
              <a href="https://vibecoding.cz" target="_blank" rel="noreferrer">
                ↗ vibecoding.cz
              </a>
              <a href="https://marigold.cz" target="_blank" rel="noreferrer">
                ↗ marigold.cz
              </a>
              <a href="https://cs.wikipedia.org/wiki/Patrick_Zandl" target="_blank" rel="noreferrer">
                ↗ Wikipedia
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section class="section" id="faq">
        <div class="section-header">
          <div>
            <div class="kicker">faq</div>
            <h2>Co se často ptáte.</h2>
          </div>
        </div>
        <div class="faq">
          {FAQ_ITEMS.map((f, i) => (
            <details open={i === 0 ? true : undefined}>
              <summary>{f.q}</summary>
              <div class="faq-body">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section class="section" id="newsletter" style="text-align:center">
        <div style="max-width:560px;margin:0 auto">
          <div class="kicker" style="justify-content:center">newsletter</div>
          <h2
            style="font-family:var(--font-head);font-size:clamp(1.5rem,2vw,1.9rem);font-weight:600;letter-spacing:-0.01em;margin:8px 0 12px"
          >
            Tipy k&nbsp;vibe codingu zdarma.
          </h2>
          <p style="color:var(--muted);margin:0 0 24px;font-size:1rem">
            Jednou týdně — praktické tipy, jak stavět aplikace s&nbsp;AI.
            Žádný spam, odhlášení jedním klikem.
          </p>
          <div id="newsletter-form">
            <form
              hx-post="/api/leads/newsletter"
              hx-target="#newsletter-form"
              hx-swap="innerHTML"
              class="hstack"
              style="gap:10px;max-width:420px;margin:0 auto"
            >
              <input
                type="email"
                name="email"
                required
                placeholder="vas@email.cz"
                class="input"
                autocomplete="email"
              />
              <button type="submit" class="btn btn-sm" style="white-space:nowrap">
                odebírat
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  </Layout>
  );
};
