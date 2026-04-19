import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface LandingProps {
  user?: { name: string | null; email: string } | null;
}

const MODULES = [
  {
    id: 1,
    title: "Začínáme",
    lessons: [
      { id: 1, title: "Od nápadu k profi zadání", sub: "PRD s Cowork", duration: "18:45", free: true },
      { id: 2, title: "Postav appku za 20 minut", sub: 'Ten „wow" moment', duration: "22:00", free: true },
      { id: 3, title: "První funkce, která opravdu funguje", sub: "Iterace a kontrola", duration: "24:25", free: true },
    ],
  },
  {
    id: 2,
    title: "Stavíme aplikaci",
    lessons: [
      { id: 4, title: "Krásný design na prvním místě", sub: "Moodboard + vizuální magie", duration: "30:20", free: false },
      { id: 5, title: "Data a paměť tvé appky", sub: "Databáze bez databázářů", duration: "35:05", free: false },
      { id: 6, title: "Když se to rozbije", sub: "Jak to opravit rychle", duration: "26:30", free: false },
      { id: 7, title: "Připojení k světu", sub: "API a integrace", duration: "37:20", free: false },
    ],
  },
  {
    id: 3,
    title: "Produkce a polish",
    lessons: [
      { id: 8, title: "Bezpečnost a přihlášení bez bolesti", sub: "Auth v praxi", duration: "28:40", free: false },
      { id: 9, title: "Nahraj to na internet", sub: "Deployment jednoduše", duration: "24:40", free: false },
      { id: 10, title: "Finální lesk a co dál", sub: "Údržba, vylepšení, limity", duration: "32:30", free: false },
    ],
  },
];

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

export const LandingPage: FC<LandingProps> = ({ user }) => (
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
              první 3 epizody zdarma
            </a>
          </div>
          <div class="hero-meta">
            <span>10 epizod</span>
            <span class="dot"></span>
            <span>4 h 45 min videa</span>
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
            <span class="pill">první 3 epizody zdarma</span>
          </div>
        </div>
        <div class="module-list">
          {MODULES.map((m) => (
            <div class="module">
              <div class="module-head">
                <div>
                  <div class="module-index">
                    modul {String(m.id).padStart(2, "0")}
                  </div>
                  <h3 class="module-title">{m.title}</h3>
                </div>
                <div class="module-meta">
                  {m.lessons.length} epizod
                </div>
              </div>
              {m.lessons.map((l) => (
                <div class={`lesson ${l.free ? "" : "locked"}`}>
                  <span class="lesson-num">{String(l.id).padStart(2, "0")}</span>
                  <span class="lesson-icon">
                    {l.free ? (
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
                    <span class="lesson-sub">{l.sub}</span>
                  </div>
                  <span class="lesson-duration">{l.duration}</span>
                </div>
              ))}
            </div>
          ))}
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
            <div class="price-number">
              3&nbsp;000&nbsp;Kč<small>/ rok</small>
            </div>
            <ul class="price-features">
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Přístup ke&nbsp;všem&nbsp;10&nbsp;epizodám
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Všechny budoucí kurzy v&nbsp;předplatném
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Komentáře a&nbsp;Q&amp;A s&nbsp;Patrickem
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                14 dní na vrácení, bez dotazů
              </li>
            </ul>
            <a href="/checkout/individual" class="btn btn-block btn-lg" style="text-decoration:none">
              koupit za 2&nbsp;000&nbsp;Kč
            </a>
            <div class="mono muted" style="text-align:center">
              platba kartou nebo převodem
            </div>
          </div>
          <div class="price-card">
            <div>
              <span class="pill pill-ghost">pro firmy</span>
              <h3 style="margin-top:10px">Firemní licence</h3>
            </div>
            <div class="price-number">
              15&nbsp;000&nbsp;Kč<small>/ rok</small>
            </div>
            <ul class="price-features">
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Neomezený počet zaměstnanců
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Přístup podle emailové domény
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Faktura v&nbsp;CZK, standardní daňový doklad
              </li>
              <li>
                <span class="check">
                  <CheckIcon />
                </span>
                Přehled využití pro&nbsp;L&amp;D oddělení
              </li>
            </ul>
            <a href="/checkout/organization" class="btn btn-ghost btn-block btn-lg" style="text-decoration:none">
              koupit firemní licenci
            </a>
            <div class="mono muted" style="text-align:center">
              platba kartou nebo převodem, aktivace do 24&nbsp;h po&nbsp;schválení
            </div>
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
