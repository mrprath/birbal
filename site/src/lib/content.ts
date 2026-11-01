import fs from "fs";
import path from "path";

const CONTENT_DIR = path.join(process.cwd(), "content");

// ---------- Frontmatter parser ----------

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

// ---------- Blog posts ----------

export type BlogPost = {
  slug: string;
  title: string;
  tag: string;
  oneLiner: string;
  published: string;
};

export function getBlogPosts(): BlogPost[] {
  const dir = path.join(CONTENT_DIR, "blog");
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { meta } = parseFrontmatter(raw);
      return {
        slug: f.replace(/\.md$/, ""),
        title: meta.title || "Untitled",
        tag: meta.tag || "Field Note",
        oneLiner: meta.oneLiner || "",
        published: meta.published || "",
      };
    })
    .sort((a, b) => b.published.localeCompare(a.published));
}

export function getBlogPost(slug: string): { meta: BlogPost; body: string } | null {
  const file = path.join(CONTENT_DIR, "blog", `${slug}.md`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    meta: {
      slug,
      title: meta.title || "Untitled",
      tag: meta.tag || "Field Note",
      oneLiner: meta.oneLiner || "",
      published: meta.published || "",
    },
    body,
  };
}

// ---------- News digests ----------

export type NewsDigest = {
  slug: string;
  title: string;
  date: string;
};

export function getNewsDigests(): NewsDigest[] {
  const dir = path.join(CONTENT_DIR, "news");
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { meta } = parseFrontmatter(raw);
      return {
        slug: f.replace(/\.md$/, ""),
        title: meta.title || "Digest",
        date: meta.date || "",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getNewsDigest(slug: string): { meta: NewsDigest; body: string } | null {
  const file = path.join(CONTENT_DIR, "news", `${slug}.md`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    meta: {
      slug,
      title: meta.title || "Digest",
      date: meta.date || "",
    },
    body,
  };
}
