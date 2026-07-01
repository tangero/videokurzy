// HTML snippet pro marketingové pixely. Vkládá se centrálně do
// </body> všech HTML odpovědí (viz index.tsx), takže se nemusí měnit 45 call sites
// <Layout>. Viz KONVERZE-PLAN.md fáze 1/8.
//
// POZOR — provozní rozhodnutí (instrukce provozovatele): pixely se načítají PŘEDEM,
// při načtení každé stránky, se souhlasem granted. To je vědomá volba provozovatele
// webu; nese s sebou riziko dle ePrivacy/GDPR (ÚOOÚ). Consent lišta byla odstraněna
// na výslovný pokyn provozovatele — souhlas se pixelům hlásí vždy jako granted.

import type { Env } from "../types";
import { sha256Hex } from "./cc-news/detect";

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

  // Inline loader: pixely se načtou VŽDY hned se souhlasem granted (instrukce
  // provozovatele — consent lišta odstraněna, souhlas se hlásí napevno).
  const loader = `
(function () {
  var META_ID = ${cfg.metaPixelId ? jsStr(cfg.metaPixelId) : "null"};
  var SKLIK_ID = ${cfg.sklikRetargetingId ? jsStr(cfg.sklikRetargetingId) : "null"};
  var GTAG_ID = ${cfg.gtagId ? jsStr(cfg.gtagId) : "null"};

  function loadMeta() {
    if (!META_ID || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('consent', 'grant');
    window.fbq('init', META_ID);
    window.fbq('track', 'PageView');
  }
  function loadSklik() {
    if (!SKLIK_ID) return;
    var s = document.createElement('script');
    s.src = 'https://c.seznam.cz/js/rc.js';
    s.onload = function () {
      if (window.rc && window.rc.retargetingHit) {
        window.rc.retargetingHit({ rtgId: Number(SKLIK_ID), consent: 1 });
      }
    };
    document.head.appendChild(s);
  }
  function loadGtag() {
    if (!GTAG_ID || window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    // Consent Mode v2: granted (souhlas se hlásí napevno).
    window.gtag('consent', 'default', { ad_storage:'granted', ad_user_data:'granted', ad_personalization:'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GTAG_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GTAG_ID);
  }

  // Pixely načti VŽDY hned, se souhlasem granted.
  loadMeta(); loadSklik(); loadGtag();
})();`;

  return `<script>${loader}</script>`;
}

/**
 * Sklik conversionHit pro stránku po objednávce (success / platební pokyny).
 * Sklik nemá rozumné server-side API → konverze je client-side. Dedup přes
 * sessionStorage keyovaný na orderId (stránka platebních pokynů se zobrazuje
 * opakovaně — uživatel se vrací zkontrolovat platbu). Pálí se „při objednávce"
 * (rozhodnutí provozovatele): u převodů tedy i pro zatím nezaplacené.
 * Consent se hlásí napevno jako 1 (souhlas dán vždy, lišta odstraněna).
 * Vrací "" když chybí konverzní ID nebo hodnota.
 */
export function sklikConversionSnippet(
  env: Env,
  opts: { value: number; orderId: string; emailHash?: string | null },
): string {
  const id = env.SKLIK_CONVERSION_ID;
  if (!id || !opts.value || opts.value <= 0) return "";

  // Identity matching: hashovaný e-mail (SHA-256) přes updateIdentities zlepší
  // atribuci. Hash se počítá server-side (sklikConversionSnippetFor), do HTML
  // jde jen hash, ne čitelný e-mail. eid=null když hash chybí.
  const eid = opts.emailHash ? jsStr(opts.emailHash) : "null";

  const js = `
(function () {
  var KEY = 'vk_sklik_conv_' + ${jsStr(opts.orderId)};
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
  var s = document.createElement('script');
  s.src = 'https://c.seznam.cz/js/rc.js';
  s.onload = function () {
    try {
      if (window.sznIVA && window.sznIVA.IS && window.sznIVA.IS.updateIdentities) {
        window.sznIVA.IS.updateIdentities({ eid: ${eid} });
      }
    } catch (e) {}
    if (window.rc && window.rc.conversionHit) {
      window.rc.conversionHit({
        id: Number(${jsStr(id)}),
        value: ${Number(opts.value)},
        consent: 1
      });
      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    }
  };
  document.head.appendChild(s);
})();`;
  return `<script>${js}</script>`;
}

/**
 * Jako sklikConversionSnippet, ale e-mail zahashuje server-side (SHA-256) pro
 * identity matching. E-mail se do HTML nikdy nedostane v čitelné podobě.
 */
export async function sklikConversionSnippetFor(
  env: Env,
  opts: { value: number; orderId: string; email?: string | null },
): Promise<string> {
  let emailHash: string | null = null;
  if (opts.email) emailHash = await sha256Hex(opts.email.trim().toLowerCase());
  return sklikConversionSnippet(env, { value: opts.value, orderId: opts.orderId, emailHash });
}
