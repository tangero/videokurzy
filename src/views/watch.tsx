import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface WatchProps {
  user: { name: string | null; email: string } | null;
  lesson: {
    id: number;
    title: string;
    slug: string;
    durationSeconds: number;
    isFree: boolean;
  };
  embedUrl: string;
  completed: boolean;
  prevSlug: string | null;
  nextSlug: string | null;
  isLastFreeLesson: boolean;
  userHasAccess: boolean;
}

export const WatchPage: FC<WatchProps> = ({
  user,
  lesson,
  embedUrl,
  completed,
  prevSlug,
  nextSlug,
  isLastFreeLesson,
  userHasAccess,
}) => (
  <Layout title={lesson.title} user={user}>
    <div class="max-w-4xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-4">{lesson.title}</h1>

      {/* Video player */}
      <div class="relative w-full pb-[56.25%] bg-black rounded-lg overflow-hidden mb-6">
        <iframe
          src={embedUrl}
          loading="lazy"
          style="border:0;position:absolute;top:0;left:0;width:100%;height:100%;"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowfullscreen
        ></iframe>
      </div>

      {/* Controls */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          {prevSlug && (
            <a
              href={`/watch/${prevSlug}`}
              class="text-sm text-gray-600 hover:text-blue-600"
            >
              &larr; Předchozí
            </a>
          )}
          {nextSlug && (
            <a
              href={`/watch/${nextSlug}`}
              class="text-sm text-gray-600 hover:text-blue-600"
            >
              Další &rarr;
            </a>
          )}
        </div>

        {user && (
          <div id={`progress-${lesson.id}`}>
            {completed ? (
              <span class="text-sm text-green-600 font-medium">
                &#10003; Dokončeno
              </span>
            ) : (
              <button
                hx-post={`/api/progress/${lesson.id}`}
                hx-target={`#progress-${lesson.id}`}
                hx-swap="outerHTML"
                class="text-sm bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
              >
                Označit jako dokončené
              </button>
            )}
          </div>
        )}
      </div>

      {/* CTA after last free lesson */}
      {isLastFreeLesson && !userHasAccess && (
        <div class="mt-8 border-2 border-blue-200 bg-blue-50 rounded-lg p-6">
          <h2 class="text-lg font-bold mb-2">
            Tohle byl poslední díl zdarma
          </h2>
          <p class="text-gray-700 mb-4">
            V dalších 7 epizodách se naučíte design, práci s daty, API integrace,
            bezpečnost a deployment. Celý kurz od nápadu po hotovou aplikaci.
          </p>

          {user ? (
            /* Logged-in user without purchase — upgrade CTA */
            <a
              href="/#cenik"
              class="inline-block bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700"
            >
              Koupit plný kurz za 2 000 Kč/rok
            </a>
          ) : (
            /* Non-logged-in user — email capture */
            <div id="lead-capture">
              <p class="text-sm text-gray-600 mb-3">
                Nechte nám email a pošleme vám informace o plném kurzu:
              </p>
              <form
                hx-post="/api/leads/preview-completed"
                hx-target="#lead-capture"
                hx-swap="innerHTML"
                class="flex gap-2"
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
                  class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium whitespace-nowrap"
                >
                  Chci vědět víc
                </button>
              </form>
              <p class="text-xs text-gray-500 mt-2">
                Nebo se rovnou{" "}
                <a href="/#cenik" class="text-blue-600 hover:underline">
                  podívejte na ceník
                </a>
                .
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  </Layout>
);

export const ProgressComplete: FC<{ lessonId: number }> = ({ lessonId }) => (
  <div id={`progress-${lessonId}`}>
    <span class="text-sm text-green-600 font-medium">&#10003; Dokončeno</span>
  </div>
);
