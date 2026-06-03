import type { FC } from "hono/jsx";
import { WatchPage } from "./watch";

// DEMO CHYBA pro výuku (Claude Code):
// Stránka se vyrenderuje, ale v hlavičce lekce zůstane "název modulu" viset na
// textu „Načítání modulu…", protože klientský <script> spadne na
//   TypeError: Cannot read properties of undefined (reading 'title')
// kvůli chybějícímu optional chainingu při čtení `lessonData.module.title`.
// `lessonData.module` je totiž `undefined`. Chyba je vidět v konzoli prohlížeče
// (DevTools → Console). Oprava: `lessonData.module?.title` (viz komentář ve scriptu).

const MODULE_TITLE_ID = "module-title-badge";

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
  const { lessonClientData, lesson, ...rest } = props;
  const dataJson = JSON.stringify(lessonClientData);

  return (
    <>
      {/* Badge s názvem modulu v hlavičce začíná na placeholderu „Načítání
          modulu…". Klientský script ho má doplnit, ale spadne — placeholder
          tak zůstane viditelně viset hned nahoře vedle nadpisu lekce. */}
      <WatchPage
        {...rest}
        lesson={{ ...lesson, moduleTitle: "Načítání modulu…" }}
        moduleTitleId={MODULE_TITLE_ID}
      />

      {/* DEMO CHYBA: klientský script spadne na chybějícím `?.`. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var lessonData = ${dataJson};
              var badge = document.getElementById('${MODULE_TITLE_ID}');

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
