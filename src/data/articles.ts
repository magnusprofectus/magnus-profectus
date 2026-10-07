// Articles for the "Extra" tab (team content). Markdown files under
// src/content/articles/ with frontmatter (title, date, blurb). Bundled at build
// time via import.meta.glob — adding an article = adding a file, no code changes.
export interface ArticleMeta { slug: string; title: string; date: string; blurb: string; body: string }

const files = import.meta.glob("../content/articles/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function parse(slug: string, raw: string): ArticleMeta {
  const fm: Record<string, string> = {};
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    body = raw.slice(m[0].length);
  }
  return {
    slug,
    title: fm.title ?? slug,
    date: fm.date ?? "1970-01-01",
    blurb: fm.blurb ?? "",
    body,
  };
}

export const articles: ArticleMeta[] = Object.entries(files)
  .map(([path, raw]) => parse(path.replace(/^.*\/(.+)\.md$/, "$1"), raw))
  .sort((a, b) => b.date.localeCompare(a.date));

export const articleBySlug = (slug: string): ArticleMeta | undefined => articles.find(a => a.slug === slug);

/** Team hand-picked recommendations — slugs, curated. */
export const teamPicks: string[] = [
  "why-get-strong-and-muscular",
  "the-last-rep-bet",
  "the-natural-limit",
  "the-arithmetic-of-one-more-rep",
  "why-this-app",
];

export async function recordClick(slug: string): Promise<void> {
  try { await fetch("/api/articles/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) }); } catch { /* offline ok */ }
}

export async function fetchPopular(): Promise<string[]> {
  try {
    const r = await fetch("/api/articles/popular");
    if (!r.ok) return [];
    const body = await r.json();
    return (body.popular ?? []).map((p: { slug: string }) => p.slug).filter((s: string) => articleBySlug(s));
  } catch { return []; }
}