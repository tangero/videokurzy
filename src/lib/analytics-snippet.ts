// HTML snippet pro consent lištu + marketingové pixely. Vkládá se centrálně do
// </body> všech HTML odpovědí (viz index.tsx), takže se nemusí měnit 45 call sites
// <Layout>. Viz KONVERZE-PLAN.md fáze 1/8.
//
// POZOR — provozní rozhodnutí (instrukce provozovatele): pixely se načítají PŘEDEM,
// při načtení každé stránky, BEZ ohledu na uložený souhlas. To je vědomá volba
// provozovatele webu; nese s sebou riziko dle ePrivacy/GDPR (ÚOOÚ). Lišta tím
// slouží primárně k informování a k uložení/odvolání volby.
//
// Co se přesto NEDĚLÁ (a nebude): pixelům se NEhlásí falešný souhlas. Dokud
// uživatel neklikne Přijmout, posílá se consent signál = denied/revoke (Google
// Consent Mode v2 'denied', Meta fbq('consent','revoke')). Po kliknutí Přijmout
// se přepne na granted. Sklik consent param odráží reálnou volbu (0/1), ne napevno 1.
// - Volba se ukládá do cookie `vk_consent` (= "1" souhlas / "0" odmítnuto).
// - Lišta je velmi tenká, neblokující, na konci stránky (sticky patička).

import type { Env } from "../types";

const CONSENT_COOKIE = "vk_consent";

interface AnalyticsConfig {
  metaPixelId?: string;
  sklikRetargetingId?: string;
  gtagId?: string; // G-... nebo AW-...
}

function readAnalyticsConfig(env: Env): AnalyticsConfig {
  return {
    metaPixelId: env.META_PIXEL_ID,
    sklikRetargetingId: env.SKLIK_RETARGETING_ID,
    gtagId: env.GTAG_ID,
  };
}

/** Escapuje hodnotu pro bezpečné vložení do JS string literálu v inline scriptu. */
function jsStr(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Vrátí HTML (lišta + inline loader pixelů), nebo prázdný řetězec, když není
 * nakonfigurovaný žádný pixel (pak nemá lišta co povolovat).
 */
export function analyticsSnippet(env: Env): string {
  const cfg = readAnalyticsConfig(env);
  if (!cfg.metaPixelId && !cfg.sklikRetargetingId && !cfg.gtagId) return "";

  // Inline loader: pixely se načtou VŽDY hned (instrukce provozovatele), ale
  // consent signál odráží reálnou volbu — granted až po kliknutí Přijmout.
  const loader = `
(function () {
  var COOKIE = ${jsStr(CONSENT_COOKIE)};
  var META_ID = ${cfg.metaPixelId ? jsStr(cfg.metaPixelId) : "null"};
  var SKLIK_ID = ${cfg.sklikRetargetingId ? jsStr(cfg.sklikRetargetingId) : "null"};
  var GTAG_ID = ${cfg.gtagId ? jsStr(cfg.gtagId) : "null"};

  function getConsent() {
    var m = document.cookie.match(/(?:^|;\\s*)vk_consent=([^;]+)/);
    return m ? m[1] : null;
  }
  function setConsent(v) {
    // 6 měsíců, SameSite=Lax, Secure (web běží na https).
    document.cookie = COOKIE + "=" + v + ";path=/;max-age=15552000;SameSite=Lax;Secure";
  }
  function granted() { return getConsent() === '1'; }

  function loadMeta() {
    if (!META_ID || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    // Consent signál PŘED initem: revoke dokud uživatel nesouhlasí (ne falešné grant).
    window.fbq('consent', granted() ? 'grant' : 'revoke');
    window.fbq('init', META_ID);
    window.fbq('track', 'PageView');
  }
  function loadSklik() {
    if (!SKLIK_ID) return;
    var s = document.createElement('script');
    s.src = 'https://c.seznam.cz/js/rc.js';
    s.onload = function () {
      if (window.rc && window.rc.retargetingHit) {
        // consent param odráží reálnou volbu (1/0), NE napevno 1.
        window.rc.retargetingHit({ rtgId: Number(SKLIK_ID), consent: granted() ? 1 : 0 });
      }
    };
    document.head.appendChild(s);
  }
  function loadGtag() {
    if (!GTAG_ID || window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    // Consent Mode v2: default odráží volbu — denied dokud uživatel nesouhlasí.
    var g = granted() ? 'granted' : 'denied';
    window.gtag('consent', 'default', { ad_storage:g, ad_user_data:g, ad_personalization:g });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GTAG_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GTAG_ID);
  }
  // Po kliknutí Přijmout aktualizuj consent signál u už načtených pixelů.
  function grantLoaded() {
    if (window.fbq) window.fbq('consent', 'grant');
    if (window.gtag) window.gtag('consent', 'update', { ad_storage:'granted', ad_user_data:'granted', ad_personalization:'granted' });
    if (SKLIK_ID && window.rc && window.rc.retargetingHit) window.rc.retargetingHit({ rtgId: Number(SKLIK_ID), consent: 1 });
  }

  // Pixely načti VŽDY hned (instrukce provozovatele).
  loadMeta(); loadSklik(); loadGtag();

  function hideBar() {
    var b = document.getElementById('vk-consent-bar');
    if (b) b.style.display = 'none';
  }

  // Lištu skryj, když už je volba uložená; jinak naváž tlačítka.
  var consent = getConsent();
  if (consent === '1' || consent === '0') { hideBar(); return; }
  document.addEventListener('DOMContentLoaded', function () {
    var accept = document.getElementById('vk-consent-accept');
    var reject = document.getElementById('vk-consent-reject');
    if (accept) accept.addEventListener('click', function () { setConsent('1'); grantLoaded(); hideBar(); });
    if (reject) reject.addEventListener('click', function () { setConsent('0'); hideBar(); });
  });
})();`;

  // Velmi tenká, neblokující lišta na konci stránky. Skrytá inline, pokud už je
  // volba uložená (loader ji schová okamžitě). Default zobrazená pro nové návštěvníky.
  const bar = `
<div id="vk-consent-bar" role="region" aria-label="Souhlas s cookies" style="position:fixed;left:0;right:0;bottom:0;z-index:50;background:#0f172a;color:#e2e8f0;font-size:13px;line-height:1.4;padding:8px 12px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -1px 6px rgba(0,0,0,.25)">
  <span>Pro měření reklamy a remarketing používáme cookies třetích stran (Meta, Google, Seznam). Souhlas můžete odmítnout.</span>
  <span style="display:inline-flex;gap:6px">
    <button id="vk-consent-accept" type="button" style="background:#22c55e;color:#06281a;border:0;border-radius:6px;padding:5px 12px;font-weight:600;cursor:pointer">Přijmout</button>
    <button id="vk-consent-reject" type="button" style="background:transparent;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:5px 12px;cursor:pointer">Odmítnout</button>
    <a href="/privacy" style="color:#94a3b8;align-self:center">Zásady</a>
  </span>
</div>`;

  return `${bar}\n<script>${loader}</script>`;
}

/**
 * Sklik conversionHit pro stránku po objednávce (success / platební pokyny).
 * Sklik nemá rozumné server-side API → konverze je client-side. Dedup přes
 * sessionStorage keyovaný na orderId (stránka platebních pokynů se zobrazuje
 * opakovaně — uživatel se vrací zkontrolovat platbu). Pálí se „při objednávce"
 * (rozhodnutí provozovatele): u převodů tedy i pro zatím nezaplacené.
 * Respektuje consent (rc.js consent param odráží volbu, ne napevno 1).
 * Vrací "" když chybí konverzní ID nebo hodnota.
 */
export function sklikConversionSnippet(
  env: Env,
  opts: { value: number; orderId: string },
): string {
  const id = env.SKLIK_CONVERSION_ID;
  if (!id || !opts.value || opts.value <= 0) return "";

  const js = `
(function () {
  var KEY = 'vk_sklik_conv_' + ${jsStr(opts.orderId)};
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
  function consent() {
    var m = document.cookie.match(/(?:^|;\\s*)vk_consent=([^;]+)/);
    return m && m[1] === '1' ? 1 : 0;
  }
  var s = document.createElement('script');
  s.src = 'https://c.seznam.cz/js/rc.js';
  s.onload = function () {
    if (window.rc && window.rc.conversionHit) {
      window.rc.conversionHit({
        id: Number(${jsStr(id)}),
        value: ${Number(opts.value)},
        consent: consent()
      });
      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    }
  };
  document.head.appendChild(s);
})();`;
  return `<script>${js}</script>`;
}
