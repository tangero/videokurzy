import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface WatchProps {
  user: { name: string | null; email: string };
  lesson: {
    id: number;
    title: string;
    slug: string;
    durationSeconds: number;
  };
  embedUrl: string;
  completed: boolean;
  prevSlug: string | null;
  nextSlug: string | null;
}

export const WatchPage: FC<WatchProps> = ({
  user,
  lesson,
  embedUrl,
  completed,
  prevSlug,
  nextSlug,
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
      </div>
    </div>
  </Layout>
);

export const ProgressComplete: FC<{ lessonId: number }> = ({ lessonId }) => (
  <div id={`progress-${lessonId}`}>
    <span class="text-sm text-green-600 font-medium">&#10003; Dokončeno</span>
  </div>
);
