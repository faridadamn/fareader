import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, "public");
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const previewMode = process.env.PREVIEW_CATALOG === "1";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL wajib diisi untuk menjalankan FA Reader V2.");
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 5,
  connect_timeout: 20,
  idle_timeout: 30,
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      return value.split("|").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function visibleBookFilter(alias = "b") {
  return previewMode
    ? sql`${sql(alias)}.status IN ('published', 'ready_for_review')`
    : sql`${sql(alias)}.status = 'published'`;
}

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(path.resolve(publicDirectory))) return false;

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extension] || "application/octet-stream";

    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function dashboard() {
  const [[books], [topics]] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM books b WHERE ${visibleBookFilter("b")}`,
    sql`SELECT count(*)::int AS total FROM topics`,
  ]);

  return {
    bookCount: books.total,
    topicCount: topics.total,
    preview: previewMode,
  };
}

async function listBooks(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const limit = Math.min(60, Math.max(6, Number(url.searchParams.get("limit") || 24)));
  const pattern = `%${query}%`;

  const queryFilter = query
    ? sql`(b.title ILIKE ${pattern} OR b.original_author ILIKE ${pattern} OR b.description ILIKE ${pattern})`
    : sql`true`;
  const categoryFilter = category
    ? sql`EXISTS (
      SELECT 1 FROM book_categories bc
      JOIN categories c ON c.id = bc.category_id
      WHERE bc.book_id = b.id AND c.slug = ${category}
    )`
    : sql`true`;

  const rows = await sql`
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.description,
      b.word_count,
      b.reading_time_minutes,
      coalesce(array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL), ARRAY[]::citext[]) AS categories,
      count(DISTINCT bs.id)::int AS section_count
    FROM books b
    LEFT JOIN book_sections bs ON bs.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE ${visibleBookFilter("b")} AND ${queryFilter} AND ${categoryFilter}
    GROUP BY b.id
    ORDER BY b.title
    LIMIT ${limit}
  `;

  return { items: rows, preview: previewMode };
}

async function bookDetail(slug) {
  const [book] = await sql`
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.summary_publisher,
      b.description,
      b.word_count,
      b.reading_time_minutes,
      coalesce(array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL), ARRAY[]::citext[]) AS categories
    FROM books b
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE b.slug = ${slug} AND ${visibleBookFilter("b")}
    GROUP BY b.id
  `;

  if (!book) return null;

  const sections = await sql`
    SELECT order_index, title, heading_label, content, word_count
    FROM book_sections
    WHERE book_id = (SELECT id FROM books WHERE slug = ${slug})
    ORDER BY order_index
  `;

  return { ...book, sections };
}

async function listTopics(url) {
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(8, Number(url.searchParams.get("limit") || 40)));

  const rows = await sql`
    SELECT t.id, t.title, t.categories, t.points, t.created_at,
      coalesce(n.content, '') AS note_content
    FROM topics t
    LEFT JOIN notes n ON n.topic_id = t.id
    ORDER BY t.created_at DESC NULLS LAST, t.id DESC
    LIMIT ${limit}
  `;

  const items = rows
    .map((row) => ({
      ...row,
      categories: normalizeJsonArray(row.categories),
      points: normalizeJsonArray(row.points),
    }))
    .filter((row) => {
      const haystack = [row.title, ...row.categories, ...row.points, row.note_content]
        .join(" ")
        .toLowerCase();
      const categoryMatch = !category || row.categories.some((item) => item.toLowerCase() === category);
      return categoryMatch && (!query || haystack.includes(query));
    });

  return { items };
}

async function topicDetail(id) {
  const [row] = await sql`
    SELECT t.id, t.title, t.categories, t.points, t.created_at,
      coalesce(n.content, '') AS note_content
    FROM topics t
    LEFT JOIN notes n ON n.topic_id = t.id
    WHERE t.id = ${id}
  `;

  if (!row) return null;
  return {
    ...row,
    categories: normalizeJsonArray(row.categories),
    points: normalizeJsonArray(row.points),
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (pathname === "/api/health") {
      sendJson(response, 200, { ok: true, app: "FA Reader V2" });
      return;
    }
    if (pathname === "/api/dashboard") {
      sendJson(response, 200, await dashboard());
      return;
    }
    if (pathname === "/api/books") {
      sendJson(response, 200, await listBooks(url));
      return;
    }
    if (pathname.startsWith("/api/books/")) {
      const book = await bookDetail(decodeURIComponent(pathname.slice("/api/books/".length)));
      sendJson(response, book ? 200 : 404, book || { error: "Book not found" });
      return;
    }
    if (pathname === "/api/topics") {
      sendJson(response, 200, await listTopics(url));
      return;
    }
    if (pathname.startsWith("/api/topics/")) {
      const topic = await topicDetail(decodeURIComponent(pathname.slice("/api/topics/".length)));
      sendJson(response, topic ? 200 : 404, topic || { error: "Topic not found" });
      return;
    }

    if (await serveStatic(response, pathname)) return;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`FA Reader V2 aktif di http://${host}:${port}`);
});
