import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const webDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(webDirectory, "..");
const workspaceDirectory = path.resolve(projectDirectory, "..");
const publicDirectory = path.join(webDirectory, "public");
const envPath = process.env.ENV_PATH
  || path.join(workspaceDirectory, "belajar-scraping", ".env");
const port = Number(process.env.PORT || 4176);
const previewMode = process.argv.includes("--preview")
  || process.env.PREVIEW_CATALOG === "1";

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    result[line.slice(0, index).trim()] = value;
  }
  return result;
}

const env = parseEnv(await readFile(envPath, "utf8"));
if (!env.DATABASE_URL) throw new Error("DATABASE_URL tidak ditemukan.");

const sql = postgres(env.DATABASE_URL, {
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

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(path.resolve(publicDirectory))) return false;
  try {
    const content = await readFile(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    }[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

function visibleBookFilter(alias = "b") {
  return previewMode
    ? sql`${sql(alias)}.status IN ('published', 'ready_for_review')`
    : sql`${sql(alias)}.status = 'published'`;
}

async function loadCategories() {
  return sql`
    SELECT c.slug, c.name, count(DISTINCT b.id)::int AS book_count
    FROM categories c
    JOIN book_categories bc ON bc.category_id = c.id
    JOIN books b ON b.id = bc.book_id
    WHERE ${visibleBookFilter("b")}
    GROUP BY c.id
    HAVING count(DISTINCT b.id) > 0
    ORDER BY c.name
  `;
}

async function loadBooks(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(
    60,
    Math.max(6, Number(url.searchParams.get("pageSize") || 18)),
  );
  const offset = (page - 1) * pageSize;
  const pattern = `%${query}%`;
  const queryFilter = query
    ? sql`(
        b.title ILIKE ${pattern}
        OR b.original_author ILIKE ${pattern}
        OR b.description ILIKE ${pattern}
      )`
    : sql`true`;
  const categoryFilter = category
    ? sql`EXISTS (
        SELECT 1
        FROM book_categories xbc
        JOIN categories xc ON xc.id = xbc.category_id
        WHERE xbc.book_id = b.id AND xc.slug = ${category}
      )`
    : sql`true`;

  const [countRow] = await sql`
    SELECT count(*)::int AS total
    FROM books b
    WHERE ${visibleBookFilter("b")} AND ${queryFilter} AND ${categoryFilter}
  `;
  const rows = await sql`
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.description,
      b.word_count,
      b.reading_time_minutes,
      b.status,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories,
      count(DISTINCT bs.id)::int AS section_count
    FROM books b
    LEFT JOIN book_sections bs ON bs.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE ${visibleBookFilter("b")} AND ${queryFilter} AND ${categoryFilter}
    GROUP BY b.id
    ORDER BY b.title
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
  return {
    items: rows,
    page,
    pageSize,
    total: countRow.total,
    totalPages: Math.max(1, Math.ceil(countRow.total / pageSize)),
    preview: previewMode,
  };
}

async function loadBook(slug) {
  const [book] = await sql`
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.summary_publisher,
      b.description,
      b.word_count,
      b.reading_time_minutes,
      b.status,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories
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
  return { ...book, sections, preview: previewMode };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/meta") {
      const [stats, categories] = await Promise.all([
        sql`
          SELECT count(*)::int AS total
          FROM books b
          WHERE ${visibleBookFilter("b")}
        `,
        loadCategories(),
      ]);
      return sendJson(response, 200, {
        total: stats[0].total,
        categories,
        preview: previewMode,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/books") {
      return sendJson(response, 200, await loadBooks(url));
    }
    const detailMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      const book = await loadBook(decodeURIComponent(detailMatch[1]));
      return book
        ? sendJson(response, 200, book)
        : sendJson(response, 404, { error: "Buku belum tersedia." });
    }
    if (await serveStatic(response, url.pathname)) return;
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  const mode = previewMode ? "preview" : "published-only";
  console.log(`Reader app (${mode}): http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await sql.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
