import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface LandingProps {
  user?: { name: string | null; email: string } | null;
}

const MODULES = [
  {
    title: "Modul 1: Začínáme",
    lessons: [
      { title: "Od nápadu k profi zadání (PRD s Cowork)", free: true },
      { title: 'Postav appku za 20 minut (ten „wow" moment)', free: true },
      { title: "První funkce, která opravdu funguje", free: true },
    ],
  },
  {
    title: "Modul 2: Stavíme aplikaci",
    lessons: [
      { title: "Krásný design na prvním místě", free: false },
      { title: "Data a paměť tvé appky", free: false },
      { title: "Když se to rozbije – jak to opravit rychle", free: false },
      { title: "Připojení k světu (API a integrace)", free: false },
    ],
  },
  {
    title: "Modul 3: Produkce a polish",
    lessons: [
      { title: "Bezpečnost a přihlášení bez bolesti", free: false },
      { title: "Nahraj to na internet (deployment)", free: false },
      { title: "Finální lesk a co dál", free: false },
    ],
  },
];

export const LandingPage: FC<LandingProps> = ({ user }) => (
  <Layout user={user}>
    {/* Hero */}
    <section class="bg-white py-16">
      <div class="max-w-3xl mx-auto px-4 text-center">
        <h1 class="text-4xl font-bold mb-4">
          Claude Code s Patrickem
        </h1>
        <p class="text-xl text-gray-600 mb-8">
          Videokurz vibe codingu. Od nápadu po hotovou aplikaci v 10 epizodách.
          Naučte se stavět aplikace s AI, i když nejste programátor.
        </p>
        <div class="flex justify-center gap-4">
          <a
            href="#cenik"
            class="bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700"
          >
            Koupit kurz
          </a>
          <a
            href="#obsah"
            class="border border-gray-300 px-6 py-3 rounded-md font-medium hover:bg-gray-50"
          >
            Zobrazit obsah
          </a>
        </div>
      </div>
    </section>

    {/* Obsah kurzu */}
    <section id="obsah" class="py-16">
      <div class="max-w-3xl mx-auto px-4">
        <h2 class="text-2xl font-bold mb-8 text-center">Obsah kurzu</h2>
        <div class="space-y-8">
          {MODULES.map((mod) => (
            <div>
              <h3 class="font-semibold text-lg mb-3">{mod.title}</h3>
              <ul class="space-y-2">
                {mod.lessons.map((lesson) => (
                  <li class="flex items-center gap-3 bg-white p-3 rounded-md border border-gray-200">
                    <span class="flex-1">{lesson.title}</span>
                    {lesson.free && (
                      <span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                        zdarma
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Ceník */}
    <section id="cenik" class="bg-white py-16">
      <div class="max-w-3xl mx-auto px-4">
        <h2 class="text-2xl font-bold mb-8 text-center">Ceník</h2>
        <div class="grid md:grid-cols-2 gap-6">
          {/* Jednotlivec */}
          <div class="border border-gray-200 rounded-lg p-6">
            <h3 class="font-semibold text-lg mb-1">Jednotlivec</h3>
            <p class="text-3xl font-bold mb-1">
              2 000 Kč
              <span class="text-base font-normal text-gray-500">/rok</span>
            </p>
            <p class="text-gray-600 text-sm mb-6">
              Roční přístup ke všem epizodám pro jednu osobu.
            </p>
            <form method="post" action="/api/checkout/individual">
              <button
                type="submit"
                class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 font-medium"
              >
                Koupit
              </button>
            </form>
          </div>

          {/* Firma */}
          <div class="border-2 border-blue-600 rounded-lg p-6">
            <h3 class="font-semibold text-lg mb-1">Firma</h3>
            <p class="text-3xl font-bold mb-1">
              15 000 Kč
              <span class="text-base font-normal text-gray-500">/rok</span>
            </p>
            <p class="text-gray-600 text-sm mb-6">
              Roční přístup pro celou doménu. Všichni zaměstnanci s firemním emailem.
            </p>
            <form method="post" action="/api/checkout/organization">
              <button
                type="submit"
                class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 font-medium"
              >
                Koupit firemní licenci
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>

    {/* Newsletter */}
    <section class="py-16">
      <div class="max-w-xl mx-auto px-4 text-center">
        <h2 class="text-2xl font-bold mb-2">Tipy k vibe codingu zdarma</h2>
        <p class="text-gray-600 mb-6">
          Jednou týdně posíláme praktické tipy, jak stavět aplikace s AI.
          Žádný spam, odhlášení jedním klikem.
        </p>
        <div id="newsletter-form">
          <form
            hx-post="/api/leads/newsletter"
            hx-target="#newsletter-form"
            hx-swap="innerHTML"
            class="flex gap-2 max-w-md mx-auto"
          >
            <input
              type="email"
              name="email"
              required
              placeholder="vas@email.cz"
              class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              class="bg-blue-600 text-white px-5 py-2 rounded-md hover:bg-blue-700 font-medium whitespace-nowrap"
            >
              Odebírat
            </button>
          </form>
        </div>
      </div>
    </section>
  </Layout>
);
