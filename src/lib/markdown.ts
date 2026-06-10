export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "#";
  }
}

function renderInline(raw: string): string {
  let html = escapeHtml(raw);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const escapedHref = escapeHtml(safeHref(href.trim()));
    return `<a href="${escapedHref}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  return html;
}

export function renderMarkdown(markdown: string | null | undefined): string {
  const source = (markdown ?? "").trim();
  if (!source) return "";

  const blocks = source.split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";

    if (first.startsWith("### ")) {
      html.push(`<h3>${renderInline(first.slice(4).trim())}</h3>`);
      continue;
    }

    if (first.startsWith("## ")) {
      html.push(`<h2>${renderInline(first.slice(3).trim())}</h2>`);
      continue;
    }

    if (lines.every((line) => line.trim().startsWith("- "))) {
      const items = lines
        .map((line) => `<li>${renderInline(line.trim().slice(2).trim())}</li>`)
        .join("");
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    html.push(`<p>${renderInline(lines.map((line) => line.trim()).join(" "))}</p>`);
  }

  return html.join("");
}
