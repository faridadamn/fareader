import postgres from "postgres";

const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const previewMode = process.env.PREVIEW_CATALOG === "1";
let sqlClient;

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL belum diset di environment Vercel.");
  }
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      ssl: { rejectUnauthorized: false },
      max: 5,
      connect_timeout: 20,
      idle_timeout: 30,
    });
  }
  return sqlClient;
}

export function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowAll = allowedOrigins.has("*");
  if (allowAll || (origin && allowedOrigins.has(origin))) {
    response.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function sendJson(request, response, status, payload) {
  applyCors(request, response);
  response.status(status).json(payload);
}

export function handleOptions(request, response) {
  if (request.method !== "OPTIONS") return false;
  applyCors(request, response);
  response.status(204).end();
  return true;
}

function visibleBookFilter(sql, alias = "b") {
  return previewMode
    ? sql`${sql(alias)}.status IN ('published', 'ready_for_review')`
    : sql`${sql(alias)}.status = 'published'`;
}

export async function loadHealth() {
  const sql = getSql();
  const [row] = await sql`SELECT 1 AS ok`;
  return {
    ok: row.ok === 1,
    mode: previewMode ? "preview" : "published-only",
  };
}

export async function loadMeta() {
  const sql = getSql();
  const [stats, categories] = await Promise.all([
    sql`
      SELECT count(*)::int AS total
      FROM books b
      WHERE ${visibleBookFilter(sql, "b")}
    `,
    sql`
      SELECT c.slug, c.name, count(DISTINCT b.id)::int AS book_count
      FROM categories c
      JOIN book_categories bc ON bc.category_id = c.id
      JOIN books b ON b.id = bc.book_id
      WHERE ${visibleBookFilter(sql, "b")}
      GROUP BY c.id
      HAVING count(DISTINCT b.id) > 0
      ORDER BY c.name
    `,
  ]);
  return {
    total: stats[0].total,
    categories,
    preview: previewMode,
  };
}

export async function loadBooks(url) {
  const sql = getSql();
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
    WHERE ${visibleBookFilter(sql, "b")} AND ${queryFilter} AND ${categoryFilter}
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
    WHERE ${visibleBookFilter(sql, "b")} AND ${queryFilter} AND ${categoryFilter}
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

export async function loadBook(slug) {
  const sql = getSql();
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
    WHERE b.slug = ${slug} AND ${visibleBookFilter(sql, "b")}
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

export function requestUrl(request) {
  return new URL(request.url, `https://${request.headers.host || "localhost"}`);
}

export function sendError(request, response, error) {
  sendJson(request, response, 500, {
    error: error instanceof Error ? error.message : String(error),
  });
}
