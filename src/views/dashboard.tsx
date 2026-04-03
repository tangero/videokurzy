import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface LessonItem {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  durationSeconds: number;
  isFree: boolean;
  completed: boolean;
}

interface ModuleItem {
  id: number;
  title: string;
  lessons: LessonItem[];
}

interface DashboardProps {
  user: { name: string | null; email: string };
  modules: ModuleItem[];
  completedCount: number;
  totalCount: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const DashboardPage: FC<DashboardProps> = ({
  user,
  modules,
  completedCount,
  totalCount,
}) => {
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Layout title="Můj kurz" user={user}>
      <div class="max-w-3xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold mb-2">Můj kurz</h1>
        <p class="text-gray-600 mb-6">
          {completedCount} z {totalCount} epizod dokončeno
        </p>

        {/* Progress bar */}
        <div class="w-full bg-gray-200 rounded-full h-3 mb-8">
          <div
            class="bg-blue-600 h-3 rounded-full transition-all"
            style={`width: ${progressPercent}%`}
          ></div>
        </div>

        {/* Modules & lessons */}
        <div class="space-y-8">
          {modules.map((mod) => (
            <div>
              <h2 class="font-semibold text-lg mb-3">{mod.title}</h2>
              <ul class="space-y-2">
                {mod.lessons.map((lesson) => (
                  <li class="flex items-center gap-3 bg-white p-3 rounded-md border border-gray-200">
                    {/* Completion checkbox */}
                    <div id={`progress-${lesson.id}`}>
                      {lesson.completed ? (
                        <span class="text-green-600 font-bold">&#10003;</span>
                      ) : (
                        <span class="text-gray-300">&#9675;</span>
                      )}
                    </div>

                    {/* Lesson link */}
                    <a
                      href={`/watch/${lesson.slug}`}
                      class="flex-1 hover:text-blue-600"
                    >
                      {lesson.title}
                    </a>

                    {/* Duration */}
                    <span class="text-sm text-gray-400">
                      {formatDuration(lesson.durationSeconds)}
                    </span>

                    {lesson.isFree && (
                      <span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
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
    </Layout>
  );
};
