import type { FC } from "hono/jsx";
import { WatchPage } from "./watch";

// DEMO CHYBA #2 pro výuku (Claude Code) — SERVEROVÁ chyba.
// Tato varianta padá už při serverovém renderu, takže se TypeError objeví ve
// výstupu běžícího dev serveru (terminál) a stránka vrátí 500.
//   TypeError: Cannot read properties of undefined (reading 'title')
// Příčina: chybějící optional chaining při čtení názvu modulu (`module.title`)
// z prázdného výsledku dotazu. Oprava: `moduleRow[0]?.title` (viz routa).
// Funkční verze: watch.tsx (/watch/:slug).

type WatchChyba2Props = Parameters<typeof WatchPage>[0];

export const WatchChyba2Page: FC<WatchChyba2Props> = (props) => {
  return <WatchPage {...props} />;
};
