import type { FC } from "hono/jsx";
import { WatchPage } from "./watch";

// DEMO CHYBA pro výuku (Claude Code):
// Stránka se vyrenderuje, ale je viditelně rozbitá — "odznak" s názvem modulu
// zůstane viset na textu „Načítání modulu…", protože klientský <script> spadne na
//   TypeError: Cannot read properties of undefined (reading 'title')
// kvůli chybějícímu optional chainingu při čtení `lessonData.module.title`.
// `lessonData.module` je totiž `undefined`. Chyba je vidět v konzoli prohlížeče
// (DevTools → Console). Oprava: `lessonData.module?.title` (viz komentář ve scriptu).

// Props zrcadlí WatchPage; navíc předáváme data pro klientský script.
type WatchChybaProps = Parameters<typeof WatchPage>[0] & {
  lessonClientData: {
    id: number;
    title: string;
    // pozn.: `module` zde záměrně CHYBÍ — server ho do klientských dat nedoplnil,
    // takže v prohlížeči je `lessonData.module === undefined`.
  };
};

export const WatchChybaPage: FC<WatchChybaProps> = (props) => {
  const { lessonClientData, ...watchProps } = props;
  const dataJson = JSON.stringify(lessonClientData);

  return (
    <>
      <WatchPage {...watchProps} />

      {/* Viditelně rozbitý prvek: má ho doplnit klientský script, ale ten spadne. */}
      <div
        style="max-width:960px;margin:0 auto;padding:12px 24px;font-family:var(--font-mono);font-size:0.85rem;color:var(--muted)"
      >
        Modul:{" "}
        <span id="module-title-badge" style="font-weight:600;color:var(--accent-2)">
          Načítání modulu…
        </span>
      </div>

      {/* DEMO CHYBA: klientský script spadne na chybějícím `?.`. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var lessonData = ${dataJson};
              var badge = document.getElementById('module-title-badge');

              // DEMO CHYBA: chybí optional chaining (\`?.\`). \`lessonData.module\`
              // je undefined, takže čtení \`.title\` vyhodí v konzoli prohlížeče:
              //   TypeError: Cannot read properties of undefined (reading 'title')
              // Správně má být: lessonData.module?.title
              var moduleTitle = lessonData.module.title;

              // Sem se kód kvůli výjimce výše už nedostane, takže badge zůstane
              // viset na "Načítání modulu…" — stránka je viditelně rozbitá.
              if (badge) badge.textContent = moduleTitle;
            })();
          `,
        }}
      />
    </>
  );
};
