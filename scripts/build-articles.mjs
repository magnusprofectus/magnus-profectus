
// scripts/build-articles.mjs — split ARTICLES.md into article files + founderPicks
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const src = readFileSync(`${root}/ARTICLES.md`, "utf8");

// picks
const picksMatch = src.match(/^## PICKS\n([\s\S]*?)(?=## ARTICLE)/m);
const picks = (picksMatch?.[1] ?? "").split("\n").map(l => l.trim().replace(/^[-*] /, "")).filter(l => l && !l.startsWith("#"));

// articles
const body = src.slice(picksMatch ? picksMatch.index + picksMatch[0].length : 0);
const chunks = body.split(/^## ARTICLE\n/m).filter(c => c.trim());
mkdirSync(`${root}/src/content/articles`, { recursive: true });
const seen = [];
for (const chunk of chunks) {
  const metaLines = [];
  let rest = chunk;
  let fm = "";
  for (const line of rest.split("\n")) {
    if (/^(slug|title|date|blurb):/.test(line)) { metaLines.push(line); rest = rest.slice(rest.indexOf("\n") + 1); }
    else break;
  }
  rest = rest.replace(/^\s*---\n?/, "");
  const get = k => metaLines.find(l => l.startsWith(k + ":"))?.slice(k.length + 1).trim() ?? "";
  const slug = get("slug");
  if (!slug) { console.error("BLOCK WITHOUT SLUG:", chunk.slice(0, 60)); continue; }
  const file = `---\ntitle: "${get("title").replace(/"/g, '\\"')}"\ndate: ${get("date") || "1970-01-01"}\nblurb: "${get("blurb").replace(/"/g, '\\"')}"\n---\n\n${rest}`;
  writeFileSync(`${root}/src/content/articles/${slug}.md`, file);
  seen.push(slug);
}
// orphan cleanup: files not in ARTICLES.md get removed
import { readdirSync, unlinkSync, existsSync } from "node:fs";
for (const f of readdirSync(`${root}/src/content/articles`)) {
  const slug = f.replace(/\.md$/, "");
  if (!seen.includes(slug)) { unlinkSync(`${root}/src/content/articles/${f}`); console.log("removed orphan:", slug); }
}
// founderPicks into articles.ts
const tsPath = `${root}/src/data/articles.ts`;
let ts = readFileSync(tsPath, "utf8");
ts = ts.replace(/export const founderPicks: string\[\] = \[[^\]]*\];/, `export const founderPicks: string[] = [\n${picks.map(p => `  "${p}"`).join(",\n")},\n];`);
writeFileSync(tsPath, ts);
console.log("articles:", seen.length, "| picks:", picks.length);
