import type { FC } from "hono/jsx";

/** Podsekce Novinek v Claude Code; stejná lišta na všech čtyřech stránkách. */
export type CcSection = "vydani" | "temata" | "ekosystem" | "dohanani";

export const CC_SECTIONS: { key: CcSection; href: string; label: string }[] = [
  { key: "vydani", href: "/novinky-cc", label: "Vydání" },
  { key: "temata", href: "/novinky-cc/temata", label: "Kam teď míří vývoj Claude Code" },
  { key: "ekosystem", href: "/novinky-cc/ekosystem", label: "Mapa vývojářských nástrojů" },
  { key: "dohanani", href: "/novinky-cc/dohanani", label: "Kdo koho dohání" },
];

export const CcSectionNav: FC<{ current: CcSection }> = ({ current }) => (
  <nav class="cc-subnav" aria-label="Novinky v Claude Code">
    <ul>
      {CC_SECTIONS.map((s) => (
        <li>
          <a href={s.href} aria-current={s.key === current ? "page" : undefined}>{s.label}</a>
        </li>
      ))}
    </ul>
  </nav>
);
