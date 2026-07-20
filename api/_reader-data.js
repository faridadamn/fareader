import postgres from "postgres";

const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const previewMode = process.env.PREVIEW_CATALOG === "1"
  || process.env.VERCEL_ENV === "preview";
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
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    WHERE ${visibleBookFilter(sql, "b")} AND ${queryFilter} AND ${categoryFilter}
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
    WHERE ${visibleBookFilter(sql, "b")} AND ${queryFilter} AND ${categoryFilter}
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
    preview: previewMode,
  };
}


export async function loadTopics(url) {
  const sql = getSql();
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

export async function recordProductEvent(payload) {
  const sql = getSql();
  const eventName = String(payload?.event_name || "");
  const slug = String(payload?.slug || "").trim();
  const sessionId = String(payload?.session_id || "").trim();

  if (!ALLOWED_READING_EVENTS.has(eventName)) {
    throw new Error("Event tidak didukung.");
  }
  if (!slug || slug.length > 200) throw new Error("Slug buku tidak valid.");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
    throw new Error("Session tidak valid.");
  }

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

export async function loadBook(slug) {
  const sql = getSql();
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
    WHERE b.slug = ${slug} AND ${visibleBookFilter(sql, "b")}
    GROUP BY b.id, src.metadata
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
