import { describe, it, expect } from "vitest";
import { AdminLessonForm } from "../../src/views/admin-courses";

// Inline <script> ve formuláři tsc nevidí — ověříme aspoň, že se vyrenderuje
// s výběrem videí z library (eval/new Function workerd nepovolí).
function render(el: unknown): string {
  return String(el);
}

function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

describe("AdminLessonForm — výběr Bunny videa", () => {
  const libraries = [
    { id: "111", name: "Hlavní library" },
    { id: "655172", name: "Druhá" },
  ];

  it("nová epizoda: select library + automaticky otevřený picker, skript s pickerem", () => {
    const html = render(<AdminLessonForm courseId={1} moduleId={2} libraries={libraries} />);
    expect(html).toContain('name="bunnyLibraryId"');
    expect(html).toContain('<option value="655172"');
    expect(html).toContain('data-autoopen="1"');
    const scripts = inlineScripts(html);
    const form = scripts.find((s) => s.includes("bunny-picker"));
    expect(form).toBeDefined();
    expect(form).toContain("/admin/api/bunny/videos?");
  });

  it("jedna library → skryté pole, editace s videem picker neotevírá", () => {
    const html = render(
      <AdminLessonForm
        courseId={1}
        moduleId={2}
        libraries={[libraries[0]!]}
        lesson={{
          id: 7, publicId: "p", moduleId: 2, title: "T", slug: "t",
          bunnyVideoId: "guid", bunnyLibraryId: null, durationSeconds: 0,
          isFree: false, sortOrder: 0, chapters: "[]", moments: "[]", bodyMarkdown: "",
        }}
      />,
    );
    expect(html).toContain('type="hidden" id="bunny-library-id" name="bunnyLibraryId" value="111"');
    expect(html).toContain('data-autoopen="0"');
    const form = inlineScripts(html).find((s) => s.includes("bunny-picker"))!;
    expect(form).toContain("var CURRENT_LESSON_ID = 7;");
  });
});
