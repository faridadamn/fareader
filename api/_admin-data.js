import postgres from "postgres";

const adminPassword = process.env.ADMIN_PASSWORD || "";
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
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
}

export function sendJson(request, response, status, payload) {
  applyCors(request, response);
  response.setHeader("Cache-Control", "no-store");
  response.status(status).json(payload);
}

export function handleOptions(request, response) {
  if (request.method !== "OPTIONS") return false;
  applyCors(request, response);
  response.status(204).end();
  return true;
}

export function requireAdmin(request, response) {
  if (!adminPassword) {
    sendJson(request, response, 503, {
      error: "ADMIN_PASSWORD belum dikonfigurasi di server.",
      code: "ADMIN_PASSWORD_NOT_CONFIGURED",
    });
    return false;
  }
  if (request.headers["x-admin-password"] === adminPassword) return true;
  sendJson(request, response, 401, {
    error: "Password admin diperlukan.",
    code: "ADMIN_PASSWORD_REQUIRED",
  });
  return false;
}

export function requestUrl(request) {
  return new URL(request.url, `https://${request.headers.host || "localhost"}`);
}

export function sendError(request, response, error) {
  sendJson(request, response, error.statusCode || 500, {
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Payload terlalu besar."), { statusCode: 413 }));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(Object.assign(error, { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
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

function countWords(text) {
  const matches = String(text || "").trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function cleanText(value, maxLength = 100000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function refreshBookStats(tx, bookId) {
  const [stats] = await tx`
    SELECT
      coalesce(sum(word_count), 0)::int AS word_count,
      count(*)::int AS section_count
    FROM book_sections
    WHERE book_id = ${bookId}
  `;
  const wordCount = Number(stats.word_count || 0);
  await tx`
    UPDATE books
    SET word_count = ${wordCount},
        reading_time_minutes = greatest(1, ceil(${wordCount}::numeric / 200)::int),
        updated_at = now()
    WHERE id = ${bookId}
  `;
}

export async function loadStats() {
  const sql = getSql();
  const [books, knowledge, insights] = await Promise.all([sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'ready_for_review')::int
        AS ready_for_review,
      count(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
      count(*) FILTER (WHERE status = 'published')::int AS published,
      count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      count(*) FILTER (WHERE rights_verified)::int AS rights_verified
    FROM books
  `, sql`SELECT count(*)::int AS total FROM topics`, sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'draft')::int AS draft,
      count(*) FILTER (WHERE status = 'published')::int AS insight_published
    FROM content_drafts
  `]);
  return { ...books[0], knowledge: knowledge[0].total, insights: insights[0].total,
    insight_draft: insights[0].draft, insight_published: insights[0].insight_published };
}

export async function loadAdminContent(url, resource) {
  const sql = getSql();
  const query = (url.searchParams.get("q") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") || 25)));
  const offset = (page - 1) * pageSize;
  const pattern = `%${query}%`;
  if (resource === "topics") {
    if (id) {
      const [item] = await sql`
        SELECT t.id, t.title, t.categories, t.points, t.created_at,
          n.content AS note_content, n.updated_at AS note_updated_at
        FROM topics t LEFT JOIN notes n ON n.topic_id = t.id
        WHERE t.id = ${id} LIMIT 1`;
      return item || null;
    }
    const filter = query ? sql`(coalesce(t.title,'') ILIKE ${pattern} OR coalesce(t.categories::text,'') ILIKE ${pattern})` : sql`true`;
    const [count, items] = await Promise.all([
      sql`SELECT count(*)::int AS total FROM topics t WHERE ${filter}`,
      sql`SELECT t.id, t.title, t.categories, t.points, t.created_at,
        EXISTS(SELECT 1 FROM notes n WHERE n.topic_id=t.id) AS has_note
        FROM topics t WHERE ${filter} ORDER BY t.created_at DESC NULLS LAST, t.title
        LIMIT ${pageSize} OFFSET ${offset}`,
    ]);
    return { items, page, pageSize, total: count[0].total, totalPages: Math.max(1, Math.ceil(count[0].total / pageSize)) };
  }
  if (resource === "insights") {
    if (id) {
      const [item] = await sql`SELECT id, title, thesis, content_types, format, posts,
        content_markdown, attribution, status, published_url, published_at, created_at, updated_at
        FROM content_drafts WHERE id = ${id} LIMIT 1`;
      return item || null;
    }
    const filter = query ? sql`(coalesce(d.title,'') ILIKE ${pattern} OR coalesce(d.thesis,'') ILIKE ${pattern})` : sql`true`;
    const [count, items] = await Promise.all([
      sql`SELECT count(*)::int AS total FROM content_drafts d WHERE ${filter}`,
      sql`SELECT d.id, d.title, d.thesis, d.content_types, d.format, d.status, d.created_at
        FROM content_drafts d WHERE ${filter} ORDER BY d.created_at DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}`,
    ]);
    return { items, page, pageSize, total: count[0].total, totalPages: Math.max(1, Math.ceil(count[0].total / pageSize)) };
  }
  throw Object.assign(new Error("Jenis konten tidak didukung."), { statusCode: 400 });
}

function cleanStringArray(value, maxItems = 30, maxLength = 300) {
  const source = Array.isArray(value) ? value : String(value || "").split("\n");
  return source.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

export async function updateAdminContent(resource, id, payload) {
  const sql = getSql();
  if (resource === "topics") {
    const title = cleanText(payload.title, 500);
    if (!title) throw Object.assign(new Error("Judul knowledge wajib diisi."), { statusCode: 400 });
    const categories = cleanStringArray(payload.categories, 20, 100);
    const points = cleanStringArray(payload.points, 50, 1000);
    const note = cleanText(payload.note_content, 200000);
    await sql.begin(async (tx) => {
      const updated = await tx`UPDATE topics SET title=${title}, categories=${tx.json(categories)},
        points=${tx.json(points)} WHERE id=${id} RETURNING id`;
      if (!updated.length) throw Object.assign(new Error("Knowledge tidak ditemukan."), { statusCode: 404 });
      if (note) await tx`INSERT INTO notes(topic_id, content, updated_at, version) VALUES(${id},${note},now(),1)
        ON CONFLICT(topic_id) DO UPDATE SET content=excluded.content, updated_at=now(), version=notes.version+1`;
      else await tx`DELETE FROM notes WHERE topic_id=${id}`;
    });
    return loadAdminContent(new URL(`https://local/?id=${encodeURIComponent(id)}`), resource);
  }
  if (resource === "insights") {
    const title = cleanText(payload.title, 500);
    if (!title) throw Object.assign(new Error("Judul insight wajib diisi."), { statusCode: 400 });
    const status = ["draft", "published"].includes(payload.status) ? payload.status : "draft";
    const thesis = cleanText(payload.thesis, 5000);
    const contentTypes = cleanStringArray(payload.content_types, 20, 100);
    const posts = Array.isArray(payload.posts) ? payload.posts.map((post, index) => ({ number: index + 1, text: cleanText(post.text, 20000) })).filter((post) => post.text) : [];
    const [item] = await sql`UPDATE content_drafts SET title=${title}, thesis=${thesis},
      content_types=${contentTypes}, posts=${sql.json(posts)}, status=${status},
      published_at=CASE WHEN ${status}='published' THEN coalesce(published_at,now()) ELSE null END,
      updated_at=now() WHERE id=${id} RETURNING id`;
    if (!item) throw Object.assign(new Error("Insight tidak ditemukan."), { statusCode: 404 });
    return loadAdminContent(new URL(`https://local/?id=${encodeURIComponent(id)}`), resource);
  }
  throw Object.assign(new Error("Jenis konten tidak didukung."), { statusCode: 400 });
}

export async function loadBooks(url) {
  const sql = getSql();
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

export async function loadBook(slug) {
  const sql = getSql();
  const [book] = await sql`
    SELECT
      b.*,
      src.source_url,
      src.metadata->>'purchase_url' AS purchase_url,
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
    GROUP BY b.id, src.source_url, src.metadata
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

export async function reviewBook(slug, payload) {
  const sql = getSql();
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

export async function updateBookMetadata(slug, payload) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [current] = await tx`
      SELECT id, title, original_author, description, page_count
      FROM books
      WHERE slug = ${slug}
      FOR UPDATE
    `;
    if (!current) {
      throw Object.assign(new Error("Buku tidak ditemukan."), {
        statusCode: 404,
      });
    }

    const title = cleanText(payload.title, 500);
    if (!title) {
      throw Object.assign(new Error("Judul buku wajib diisi."), {
        statusCode: 400,
      });
    }
    const originalAuthor = cleanText(payload.original_author, 500) || null;
    const description = cleanText(payload.description, 5000) || null;
    const pageCount = Math.max(0, Number(payload.page_count || 0));
    const purchaseUrl = cleanText(payload.purchase_url, 2000) || null;

    await tx`
      UPDATE books
      SET title = ${title},
          original_author = ${originalAuthor},
          description = ${description},
          page_count = ${pageCount},
          updated_at = now()
      WHERE id = ${current.id}
    `;
    await tx`
      UPDATE book_sources
      SET metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{purchase_url}',
        ${JSON.stringify(purchaseUrl)}::jsonb,
        true
      )
      WHERE book_id = ${current.id}
    `;
    await tx`
      INSERT INTO content_audit_log (book_id, action, before_data, after_data)
      VALUES (
        ${current.id},
        'admin_metadata_update',
        ${tx.json(current)},
        ${tx.json({ title, original_author: originalAuthor, description, page_count: pageCount, purchase_url: purchaseUrl })}
      )
    `;
  });
}

export async function createSection(slug, payload) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [book] = await tx`
      SELECT id
      FROM books
      WHERE slug = ${slug}
      FOR UPDATE
    `;
    if (!book) {
      throw Object.assign(new Error("Buku tidak ditemukan."), {
        statusCode: 404,
      });
    }

    const title = cleanText(payload.title, 500);
    if (!title) {
      throw Object.assign(new Error("Judul bagian wajib diisi."), {
        statusCode: 400,
      });
    }
    const headingLabel = cleanText(payload.heading_label, 200) || null;
    const content = cleanText(payload.content, 200000);
    const [maxRow] = await tx`
      SELECT coalesce(max(order_index), -1)::int AS max_order
      FROM book_sections
      WHERE book_id = ${book.id}
    `;
    const maxOrder = Number(maxRow.max_order);
    const requestedOrder = Number.isFinite(Number(payload.order_index))
      ? Math.max(0, Number(payload.order_index))
      : maxOrder + 1;
    const orderIndex = Math.min(requestedOrder, maxOrder + 1);

    await tx`
      UPDATE book_sections
      SET order_index = order_index + 1000000
      WHERE book_id = ${book.id} AND order_index >= ${orderIndex}
    `;
    await tx`
      UPDATE book_sections
      SET order_index = order_index - 999999
      WHERE book_id = ${book.id} AND order_index >= 1000000
    `;
    const [section] = await tx`
      INSERT INTO book_sections (
        book_id, order_index, title, heading_label, content, word_count
      )
      VALUES (
        ${book.id},
        ${orderIndex},
        ${title},
        ${headingLabel},
        ${content},
        ${countWords(content)}
      )
      RETURNING id, order_index, title, heading_label, content, word_count
    `;
    await refreshBookStats(tx, book.id);
    await tx`
      INSERT INTO content_audit_log (book_id, action, before_data, after_data)
      VALUES (
        ${book.id},
        'admin_section_create',
        null,
        ${tx.json(section)}
      )
    `;
  });
}

export async function updateSection(sectionId, payload) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [current] = await tx`
      SELECT id, book_id, order_index, title, heading_label, content, word_count
      FROM book_sections
      WHERE id = ${sectionId}
      FOR UPDATE
    `;
    if (!current) {
      throw Object.assign(new Error("Bagian tidak ditemukan."), {
        statusCode: 404,
      });
    }

    const title = cleanText(payload.title, 500);
    if (!title) {
      throw Object.assign(new Error("Judul bagian wajib diisi."), {
        statusCode: 400,
      });
    }
    const headingLabel = cleanText(payload.heading_label, 200) || null;
    const content = cleanText(payload.content, 200000);
    const [maxRow] = await tx`
      SELECT max(order_index)::int AS max_order
      FROM book_sections
      WHERE book_id = ${current.book_id}
    `;
    const maxOrder = Number(maxRow.max_order || 0);
    const oldOrder = Number(current.order_index);
    const nextOrder = Math.min(
      maxOrder,
      Math.max(0, Number(payload.order_index ?? oldOrder)),
    );

    if (nextOrder !== oldOrder) {
      const temporaryOrder = maxOrder + 2000000;
      await tx`
        UPDATE book_sections
        SET order_index = ${temporaryOrder}
        WHERE id = ${current.id}
      `;
      if (nextOrder > oldOrder) {
        await tx`
          UPDATE book_sections
          SET order_index = order_index + 1000000
          WHERE book_id = ${current.book_id}
            AND order_index > ${oldOrder}
            AND order_index <= ${nextOrder}
        `;
        await tx`
          UPDATE book_sections
          SET order_index = order_index - 1000001
          WHERE book_id = ${current.book_id}
            AND order_index > 1000000
            AND order_index < ${temporaryOrder}
        `;
      } else {
        await tx`
          UPDATE book_sections
          SET order_index = order_index + 1000000
          WHERE book_id = ${current.book_id}
            AND order_index >= ${nextOrder}
            AND order_index < ${oldOrder}
        `;
        await tx`
          UPDATE book_sections
          SET order_index = order_index - 999999
          WHERE book_id = ${current.book_id}
            AND order_index >= 1000000
            AND order_index < ${temporaryOrder}
        `;
      }
    }

    const [section] = await tx`
      UPDATE book_sections
      SET order_index = ${nextOrder},
          title = ${title},
          heading_label = ${headingLabel},
          content = ${content},
          word_count = ${countWords(content)},
          content_version = content_version + 1,
          updated_at = now()
      WHERE id = ${current.id}
      RETURNING id, order_index, title, heading_label, content, word_count
    `;
    await refreshBookStats(tx, current.book_id);
    await tx`
      INSERT INTO content_audit_log (book_id, action, before_data, after_data)
      VALUES (
        ${current.book_id},
        'admin_section_update',
        ${tx.json(current)},
        ${tx.json(section)}
      )
    `;
  });
}
