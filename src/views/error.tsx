import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface ErrorPageProps {
  code: 404 | 500;
  user?: { name: string | null; email: string } | null;
}

// Sdílená chybová stránka (404 / 500). Renderuje se přes c.html() se shodným
// HTTP statusem, takže uživatel vidí design webu, ne stack trace.
const COPY: Record<ErrorPageProps["code"], { title: string; heading: string; lead: string }> = {
  404: {
    title: "Stránka nenalezena",
    heading: "404 — tady nic není",
    lead: "Epizoda nebo stránka, kterou hledáte, neexistuje nebo byla přesunuta.",
  },
  500: {
    title: "Něco se pokazilo",
    heading: "500 — chyba serveru",
    lead: "Na naší straně se něco pokazilo. Zkuste to prosím za chvíli znovu — pokud potíže přetrvají, dejte nám vědět.",
  },
};

export const ErrorPage: FC<ErrorPageProps> = ({ code, user }) => {
  const copy = COPY[code];
  return (
    <Layout title={copy.title} user={user}>
      <div class="max-w-3xl mx-auto px-4 py-12 prose">
        <h1>{copy.heading}</h1>
        <p>{copy.lead}</p>
        <p>
          <a class="btn btn-sm" href="/">
            zpět na úvod
          </a>
          {" "}
          <a class="btn btn-ghost btn-sm" href="mailto:patrick@vibecoding.cz">
            napsat nám
          </a>
        </p>
      </div>
    </Layout>
  );
};
