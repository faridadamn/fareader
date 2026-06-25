import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const adminDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(adminDirectory, "..");
const workspaceDirectory = path.resolve(projectDirectory, "..");
const publicDirectory = path.join(adminDirectory, "public");
const envPath = process.env.ENV_PATH
  || path.join(workspaceDirectory, "belajar-scraping", ".env");
const port = Number(process.env.PORT || 4175);

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
  max: 3,
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

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Payload terlalu besar."));
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
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

function decisionFromStatus(status) {
  if (status === "published") return "published";
  if (status === "rejected") return "rejected";
  if (status === "ready_for_review") return "approved";
  return "pending";
}

function mapBook(row) {
  return {
    ...row,
    page_count: Number(row.page_count),
    word_count: Number(row.word_count),
    reading_time_minutes: Number(row.reading_time_minutes),
    section_count: Number(row.section_count || 0),
    review: {
      decision: decisionFromStatus(row.status),
      notes: row.review_notes || "",
      updated_at: row.reviewed_at || null,
    },
  };
}

async function loadStats() {
  const [row] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'ready_for_review')::int
        AS ready_for_review,
      count(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
      count(*) FILTER (WHERE status = 'published')::int AS published,
      count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      count(*) FILTER (WHERE rights_verified)::int AS rights_verified
    FROM books
  `;
  return row;
}

async function loadBooks(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "all";
  const decision = url.searchParams.get("decision") || "all";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(
    100,
    Math.max(10, Number(url.searchParams.get("pageSize") || 25)),
  );
  const offset = (page - 1) * pageSize;
  const pattern = `%${query}%`;
  const decisionStatuses = {
    pending: ["needs_review"],
    approved: ["ready_for_review"],
    published: ["published"],
    rejected: ["rejected"],
  };
  const queryFilter = query
    ? sql`(b.title ILIKE ${pattern} OR b.original_author ILIKE ${pattern} OR b.slug ILIKE ${pattern})`
    : sql`true`;
  const statusFilter = status !== "all"
    ? sql`b.status = ${status}`
    : sql`true`;
  const decisionFilter = decision !== "all"
    ? sql`b.status IN ${sql(decisionStatuses[decision] || [decision])}`
    : sql`true`;

  const [countRow] = await sql`
    SELECT count(*)::int AS total
    FROM books b
    WHERE ${queryFilter} AND ${statusFilter} AND ${decisionFilter}
  `;
  const rows = await sql`
    SELECT
      b.id,
      b.slug,
      b.title,
      b.original_author,
      b.page_count,
      b.word_count,
      b.reading_time_minutes,
      b.status,
      b.rights_verified,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories,
      count(DISTINCT bs.id)::int AS section_count,
      count(DISTINCT ci.id) FILTER (WHERE ci.resolved = false)::int
        AS issue_count
    FROM books b
    LEFT JOIN book_sections bs ON bs.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    LEFT JOIN content_issues ci ON ci.book_id = b.id
    WHERE ${queryFilter} AND ${statusFilter} AND ${decisionFilter}
    GROUP BY b.id
    ORDER BY
      CASE WHEN b.status = 'needs_review' THEN 0 ELSE 1 END,
      b.title
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
  return {
    items: rows.map(mapBook),
    page,
    pageSize,
    total: countRow.total,
    totalPages: Math.max(1, Math.ceil(countRow.total / pageSize)),
  };
}

async function loadBook(slug) {
  const [book] = await sql`
    SELECT
      b.*,
      src.source_url,
      coalesce(
        array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL),
        ARRAY[]::citext[]
      ) AS categories,
      (
        SELECT after_data->>'notes'
        FROM content_audit_log
        WHERE book_id = b.id AND action = 'admin_review'
        ORDER BY created_at DESC LIMIT 1
      ) AS review_notes,
      (
        SELECT created_at
        FROM content_audit_log
        WHERE book_id = b.id AND action = 'admin_review'
        ORDER BY created_at DESC LIMIT 1
      ) AS reviewed_at
    FROM books b
    LEFT JOIN book_sources src ON src.book_id = b.id
    LEFT JOIN book_categories bc ON bc.book_id = b.id
    LEFT JOIN categories c ON c.id = bc.category_id
    WHERE b.slug = ${slug}
    GROUP BY b.id, src.source_url
  `;
  if (!book) return null;
  const [sections, issues] = await Promise.all([
    sql`
      SELECT id, order_index, title, heading_label, content, word_count,
             source_page_start, source_page_end
      FROM book_sections
      WHERE book_id = ${book.id}
      ORDER BY order_index
    `,
    sql`
      SELECT id, code, severity, message, resolved, resolution_notes
      FROM content_issues
      WHERE book_id = ${book.id}
      ORDER BY resolved, severity DESC, created_at
    `,
  ]);
  return {
    ...mapBook({ ...book, section_count: sections.length }),
    sections,
    quality: { status: book.status, issues },
  };
}

async function reviewBook(slug, payload) {
  const allowed = ["pending", "approved", "rejected", "published"];
  if (!allowed.includes(payload.decision)) {
    throw Object.assign(new Error("Keputusan review tidak valid."), {
      statusCode: 400,
    });
  }

  return sql.begin(async (tx) => {
    const [current] = await tx`
      SELECT * FROM books WHERE slug = ${slug} FOR UPDATE
    `;
    if (!current) {
      throw Object.assign(new Error("Buku tidak ditemukan."), {
        statusCode: 404,
      });
    }

    const rightsVerified = Boolean(payload.rights_verified);
    const rightsNotes = String(payload.rights_notes || "").slice(0, 5000);
    const notes = String(payload.notes || "").slice(0, 5000);
    if (payload.decision === "published" && !rightsVerified) {
      throw Object.assign(
        new Error("Hak penggunaan wajib diverifikasi sebelum publish."),
        { statusCode: 400 },
      );
    }

    if (["approved", "published"].includes(payload.decision)) {
      await tx`
        UPDATE content_issues
        SET resolved = true,
            resolution_notes = ${notes || "Diterima saat review admin."},
            resolved_at = now()
        WHERE book_id = ${current.id} AND resolved = false
      `;
    }
    const [issueCount] = await tx`
      SELECT count(*)::int AS count
      FROM content_issues
      WHERE book_id = ${current.id} AND resolved = false
    `;
    const nextStatus = payload.decision === "published"
      ? "published"
      : payload.decision === "rejected"
        ? "rejected"
        : payload.decision === "approved"
          ? "ready_for_review"
          : issueCount.count > 0
            ? "needs_review"
            : "ready_for_review";

    await tx`
      UPDATE books
      SET status = ${nextStatus},
          rights_verified = ${rightsVerified},
          rights_notes = ${rightsNotes || null},
          published_at = CASE
            WHEN ${nextStatus} = 'published' THEN coalesce(published_at, now())
            ELSE published_at
          END,
          updated_at = now()
      WHERE id = ${current.id}
    `;
    await tx`
      INSERT INTO content_audit_log (
        book_id, action, before_data, after_data
      )
      VALUES (
        ${current.id},
        'admin_review',
        ${tx.json({
          status: current.status,
          rights_verified: current.rights_verified,
          rights_notes: current.rights_notes,
        })},
        ${tx.json({
          decision: payload.decision,
          status: nextStatus,
          rights_verified: rightsVerified,
          rights_notes: rightsNotes,
          notes,
        })}
      )
    `;
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(response, 200, await loadStats());
    }
    if (request.method === "GET" && url.pathname === "/api/books") {
      return sendJson(response, 200, await loadBooks(url));
    }
    const detailMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      const book = await loadBook(decodeURIComponent(detailMatch[1]));
      return book
        ? sendJson(response, 200, book)
        : sendJson(response, 404, { error: "Buku tidak ditemukan." });
    }
    const reviewMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/review$/);
    if (request.method === "PATCH" && reviewMatch) {
      const slug = decodeURIComponent(reviewMatch[1]);
      await reviewBook(slug, await parseBody(request));
      return sendJson(response, 200, await loadBook(slug));
    }
    if (await serveStatic(response, url.pathname)) return;
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Panel admin Supabase: http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await sql.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
