import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const webDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(webDirectory, "..");
const workspaceDirectory = path.resolve(projectDirectory, "..");
const publicDirectory = path.join(webDirectory, "public");
const fallbackEnvPath = path.join(workspaceDirectory, "belajar-scraping", ".env");
const envPath = process.env.ENV_PATH || path.join(projectDirectory, ".env");
const port = Number(process.env.PORT || 4176);
const host = process.env.HOST || "0.0.0.0";
const previewMode = process.argv.includes("--preview")
  || process.env.PREVIEW_CATALOG === "1";
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

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

async function readEnvFile(filePath) {
  try {
    return parseEnv(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

const env = {
  ...(await readEnvFile(fallbackEnvPath)),
  ...(await readEnvFile(envPath)),
  ...process.env,
};
if (!env.DATABASE_URL) throw new Error("DATABASE_URL tidak ditemukan.");

const sql = postgres(env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 5,
  connect_timeout: 20,
  idle_timeout: 30,
});

function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowAll = allowedOrigins.has("*");
  if (allowAll || (origin && allowedOrigins.has(origin))) {
    response.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(request, response, status, payload) {
  applyCors(request, response);
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
  return sql`${sql(alias)}.status <> 'rejected'`;
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
  const sort = (url.searchParams.get("sort") || "popular").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(
    60,
    Math.max(6, Number(url.searchParams.get("pageSize") || 18)),
  );
  const offset = (page - 1) * pageSize;
  const orderBy = sort === "newest"
    ? sql`b.created_at DESC, b.title`
    : sort === "title"
      ? sql`b.title`
      : sql`popularity_score DESC, unique_readers_30d DESC, total_opens_30d DESC, b.title`;
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
    WITH event_stats AS (
      SELECT
        pe.book_id,
        count(*) FILTER (
          WHERE pe.event_name = 'book_opened'
        )::int AS total_opens_30d,
        count(DISTINCT pe.session_id) FILTER (
          WHERE pe.event_name = 'book_opened'
        )::int AS unique_readers_30d,
        count(DISTINCT pe.session_id) FILTER (
          WHERE pe.event_name = 'book_completed'
        )::int AS completions_30d
      FROM product_events pe
      WHERE pe.occurred_at >= now() - interval '30 days'
        AND pe.event_name IN ('book_opened', 'book_completed')
      GROUP BY pe.book_id
    )
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.description,
      b.cover_url,
      b.word_count,
      b.reading_time_minutes,
      b.status,
      coalesce(es.total_opens_30d, 0)::int AS total_opens_30d,
      coalesce(es.unique_readers_30d, 0)::int AS unique_readers_30d,
      coalesce(es.completions_30d, 0)::int AS completions_30d,
      (
        coalesce(es.unique_readers_30d, 0) * 5
        + coalesce(es.total_opens_30d, 0)
        + coalesce(es.completions_30d, 0) * 8
      )::int AS popularity_score,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories,
      count(DISTINCT bs.id)::int AS section_count
    FROM books b
    LEFT JOIN event_stats es ON es.book_id = b.id
    LEFT JOIN book_sections bs ON bs.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE ${visibleBookFilter("b")} AND ${queryFilter} AND ${categoryFilter}
    GROUP BY b.id, es.total_opens_30d, es.unique_readers_30d, es.completions_30d
    ORDER BY ${orderBy}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
  return {
    items: rows,
    page,
    pageSize,
    total: countRow.total,
    totalPages: Math.max(1, Math.ceil(countRow.total / pageSize)),
    preview: false,
  };
}


async function loadTopics(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(60, Math.max(6, Number(url.searchParams.get("pageSize") || 18)));
  const offset = (page - 1) * pageSize;
  const pattern = `%${query}%`;
  const queryFilter = query
    ? sql`(
        coalesce(t.title, '') ILIKE ${pattern}
        OR coalesce(t.categories::text, '') ILIKE ${pattern}
        OR coalesce(t.points::text, '') ILIKE ${pattern}
      )`
    : sql`true`;

  const [countRows, items] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM topics t WHERE ${queryFilter}`,
    sql`
      SELECT t.id, t.title, t.categories, t.points, t.created_at
      FROM topics t
      WHERE ${queryFilter}
      ORDER BY t.created_at DESC NULLS LAST, t.title
      LIMIT ${pageSize}
      OFFSET ${offset}
    `,
  ]);
  const total = countRows[0]?.total || 0;

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}


const ALLOWED_READING_EVENTS = new Set(["book_opened", "book_completed"]);

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function recordProductEvent(payload) {
  const eventName = String(payload?.event_name || "");
  const slug = String(payload?.slug || "").trim();
  const sessionId = String(payload?.session_id || "").trim();
  if (!ALLOWED_READING_EVENTS.has(eventName)) throw new Error("Event tidak didukung.");
  if (!slug || slug.length > 200) throw new Error("Slug buku tidak valid.");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Session tidak valid.");

  const [book] = await sql`SELECT id FROM books WHERE slug = ${slug} LIMIT 1`;
  if (!book) throw new Error("Buku tidak ditemukan.");

  if (eventName === "book_opened") {
    const [usage] = await sql`
      SELECT count(*)::int AS total
      FROM product_events
      WHERE book_id = ${book.id}
        AND session_id = ${sessionId}
        AND event_name = 'book_opened'
        AND occurred_at >= date_trunc('day', now())
    `;
    if (usage.total >= 3) return { accepted: true, counted: false, reason: "daily_limit" };
  } else {
    const [existing] = await sql`
      SELECT 1 AS found
      FROM product_events
      WHERE book_id = ${book.id}
        AND session_id = ${sessionId}
        AND event_name = 'book_completed'
      LIMIT 1
    `;
    if (existing) return { accepted: true, counted: false, reason: "already_completed" };
  }

  await sql`
    INSERT INTO product_events (session_id, event_name, book_id, properties)
    VALUES (${sessionId}, ${eventName}, ${book.id}, '{}'::jsonb)
  `;
  return { accepted: true, counted: true };
}

async function loadBook(slug) {
  const [book] = await sql`
    SELECT
      b.slug,
      b.title,
      b.original_author,
      b.summary_publisher,
      b.description,
      src.metadata->>'purchase_url' AS purchase_url,
      b.word_count,
      b.reading_time_minutes,
      b.status,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories
    FROM books b
    LEFT JOIN book_sources src ON src.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE b.slug = ${slug} AND ${visibleBookFilter("b")}
    GROUP BY b.id, src.metadata
  `;
  if (!book) return null;
  const sections = await sql`
    SELECT order_index, title, heading_label, content, word_count
    FROM book_sections
    WHERE book_id = (SELECT id FROM books WHERE slug = ${slug})
    ORDER BY order_index
  `;
  return { ...book, sections, preview: false };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "OPTIONS") {
      applyCors(request, response);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      const [row] = await sql`SELECT 1 AS ok`;
      return sendJson(request, response, 200, {
        ok: row.ok === 1,
        mode: "public-catalog",
      });
    }
    if (request.method === "GET" && url.pathname === "/api/meta") {
      const [stats, categories] = await Promise.all([
        sql`
          SELECT count(*)::int AS total
          FROM books b
          WHERE ${visibleBookFilter("b")}
        `,
        loadCategories(),
      ]);
      return sendJson(request, response, 200, {
        total: stats[0].total,
        categories,
        preview: false,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/books") {
      return sendJson(request, response, 200, await loadBooks(url));
    }
    if (request.method === "GET" && url.pathname === "/api/topics") {
      return sendJson(request, response, 200, await loadTopics(url));
    }
    if (request.method === "POST" && url.pathname === "/api/events") {
      return sendJson(request, response, 202, await recordProductEvent(await readJsonBody(request)));
    }
    const detailMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      const book = await loadBook(decodeURIComponent(detailMatch[1]));
      return book
        ? sendJson(request, response, 200, book)
        : sendJson(request, response, 404, { error: "Buku belum tersedia." });
    }
    if (await serveStatic(response, url.pathname)) return;
    sendJson(request, response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(request, response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  const mode = previewMode ? "preview" : "published-only";
  console.log(`Reader app (${mode}): http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  await sql.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
