import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
    ) {
      value = value.slice(1, -1);
    }
    result[line.slice(0, index).trim()] = value;
  }
  return result;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    : value;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const workspaceDirectory = path.resolve(projectDirectory, "..");
const envPath = process.env.ENV_PATH
  || path.join(workspaceDirectory, "belajar-scraping", ".env");
const catalogPath = process.env.CATALOG_PATH
  || path.join(projectDirectory, "data", "processed", "full", "_catalog.json");

const env = parseEnv(await readFile(envPath, "utf8"));
if (!env.DATABASE_URL) throw new Error("DATABASE_URL tidak ditemukan.");

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const sql = postgres(env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 1,
  connect_timeout: 20,
  idle_timeout: 30,
});

try {
  await sql.begin(async (tx) => {
    const [batch] = await tx`
      INSERT INTO ingestion_batches (
        source_directory, schema_version, total_selected, started_at
      )
      VALUES (
        ${path.dirname(catalogPath)},
        ${catalog[0]?.schema_version || "1.0"},
        ${catalog.length},
        now()
      )
      RETURNING id
    `;

    const bookRows = catalog.map((book) => ({
      slug: book.slug,
      title: cleanText(book.title),
      original_author: cleanText(book.original_author) || null,
      summary_publisher: cleanText(book.summary_publisher),
      language: cleanText(book.language),
      description: cleanText(book.description) || null,
      page_count: book.page_count,
      word_count: book.word_count,
      reading_time_minutes: book.reading_time_minutes,
      status: book.quality.status === "needs_review"
        ? "needs_review"
        : "ready_for_review",
    }));

    const bookIdBySlug = new Map();
    for (const part of chunks(bookRows, 200)) {
      const rows = await tx`
        INSERT INTO books ${tx(
          part,
          "slug",
          "title",
          "original_author",
          "summary_publisher",
          "language",
          "description",
          "page_count",
          "word_count",
          "reading_time_minutes",
          "status",
        )}
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          original_author = EXCLUDED.original_author,
          summary_publisher = EXCLUDED.summary_publisher,
          language = EXCLUDED.language,
          description = EXCLUDED.description,
          page_count = EXCLUDED.page_count,
          word_count = EXCLUDED.word_count,
          reading_time_minutes = EXCLUDED.reading_time_minutes,
          status = CASE
            WHEN books.status IN ('published', 'unpublished', 'rejected')
              THEN books.status
            ELSE EXCLUDED.status
          END,
          updated_at = now()
        RETURNING id, slug
      `;
      rows.forEach((row) => bookIdBySlug.set(String(row.slug), row.id));
    }

    const bookIds = [...bookIdBySlug.values()];
    await tx`DELETE FROM book_sections WHERE book_id IN ${tx(bookIds)}`;
    await tx`DELETE FROM book_categories WHERE book_id IN ${tx(bookIds)}`;
    await tx`DELETE FROM book_tags WHERE book_id IN ${tx(bookIds)}`;
    await tx`
      DELETE FROM content_issues
      WHERE book_id IN ${tx(bookIds)}
        AND resolved = false
    `;

    const sourceRows = catalog.map((book) => ({
      book_id: bookIdBySlug.get(book.slug),
      ingestion_batch_id: batch.id,
      source_file: cleanText(book.source_file),
      source_path: cleanText(book.source_path) || null,
      source_url: cleanText(book.source_url),
      checksum_sha256: book.checksum_sha256,
      metadata: {
        schema_version: book.schema_version,
        category_suggestions: book.category_suggestions || [],
      },
    }));
    for (const part of chunks(sourceRows, 500)) {
      await tx`
        INSERT INTO book_sources ${tx(
          part,
          "book_id",
          "ingestion_batch_id",
          "source_file",
          "source_path",
          "source_url",
          "checksum_sha256",
          "metadata",
        )}
        ON CONFLICT (checksum_sha256) DO UPDATE SET
          book_id = EXCLUDED.book_id,
          ingestion_batch_id = EXCLUDED.ingestion_batch_id,
          source_file = EXCLUDED.source_file,
          source_path = EXCLUDED.source_path,
          source_url = EXCLUDED.source_url,
          metadata = EXCLUDED.metadata
      `;
    }

    const sectionRows = catalog.flatMap((book) =>
      book.sections.map((section) => ({
        book_id: bookIdBySlug.get(book.slug),
        order_index: section.order_index,
        title: cleanText(section.title),
        heading_label: cleanText(section.heading_label) || null,
        content: cleanText(section.content),
        word_count: section.word_count,
        source_page_start: section.source_page_start || null,
        source_page_end: section.source_page_end || null,
      }))
    );
    for (const part of chunks(sectionRows, 500)) {
      await tx`
        INSERT INTO book_sections ${tx(
          part,
          "book_id",
          "order_index",
          "title",
          "heading_label",
          "content",
          "word_count",
          "source_page_start",
          "source_page_end",
        )}
      `;
    }

    const categoryNames = [...new Set(catalog.flatMap((book) => book.categories))];
    await tx`
      INSERT INTO categories ${tx(
        categoryNames.map((name) => ({ slug: slugify(name), name })),
        "slug",
        "name",
      )}
      ON CONFLICT (name) DO NOTHING
    `;
    const categoryRows = await tx`
      SELECT id, name FROM categories WHERE name IN ${tx(categoryNames)}
    `;
    const categoryIdByName = new Map(
      categoryRows.map((row) => [String(row.name), row.id]),
    );
    const bookCategoryRows = catalog.flatMap((book) =>
      book.categories.map((name, index) => ({
        book_id: bookIdBySlug.get(book.slug),
        category_id: categoryIdByName.get(name),
        confidence: Math.min(
          Number(
            book.category_suggestions?.find((item) => item.category === name)
              ?.score || 0,
          ) * 10,
          100,
        ),
        is_primary: index === 0,
        source: "automatic",
      }))
    );
    for (const part of chunks(bookCategoryRows, 1000)) {
      await tx`
        INSERT INTO book_categories ${tx(
          part,
          "book_id",
          "category_id",
          "confidence",
          "is_primary",
          "source",
        )}
      `;
    }

    const tagBySlug = new Map();
    for (const name of catalog.flatMap((book) => book.tags || [])) {
      const slug = slugify(name);
      if (!tagBySlug.has(slug)) tagBySlug.set(slug, name);
    }
    const tagRows = [...tagBySlug].map(([slug, name]) => ({ slug, name }));
    for (const part of chunks(tagRows, 500)) {
      await tx`
        INSERT INTO tags ${tx(part, "slug", "name")}
        ON CONFLICT (slug) DO UPDATE SET name = tags.name
      `;
    }
    const savedTags = [];
    for (const slugPart of chunks([...tagBySlug.keys()], 1000)) {
      savedTags.push(...await tx`
        SELECT id, slug FROM tags WHERE slug IN ${tx(slugPart)}
      `);
    }
    const tagIdBySlug = new Map(
      savedTags.map((row) => [String(row.slug), row.id]),
    );
    const seenBookTags = new Set();
    const bookTagRows = [];
    for (const book of catalog) {
      for (const name of book.tags || []) {
        const tagSlug = slugify(name);
        const key = `${book.slug}:${tagSlug}`;
        if (seenBookTags.has(key)) continue;
        seenBookTags.add(key);
        bookTagRows.push({
          book_id: bookIdBySlug.get(book.slug),
          tag_id: tagIdBySlug.get(tagSlug),
          source: "automatic",
        });
      }
    }
    for (const part of chunks(bookTagRows, 1000)) {
      await tx`
        INSERT INTO book_tags ${tx(part, "book_id", "tag_id", "source")}
      `;
    }

    const issueRows = catalog.flatMap((book) =>
      book.quality.issues.map((issue) => ({
        book_id: bookIdBySlug.get(book.slug),
        code: issue.code,
        severity: issue.severity,
        message: cleanText(issue.message),
      }))
    );
    for (const part of chunks(issueRows, 1000)) {
      await tx`
        INSERT INTO content_issues ${tx(
          part,
          "book_id",
          "code",
          "severity",
          "message",
        )}
      `;
    }

    await tx`
      UPDATE ingestion_batches
      SET processed_count = ${catalog.length},
          failed_count = 0,
          completed_at = now(),
          report = ${tx.json({
            imported: catalog.length,
            ready_for_review: catalog.filter(
              (book) => book.quality.status === "ready_for_review",
            ).length,
            needs_review: catalog.filter(
              (book) => book.quality.status === "needs_review",
            ).length,
          })}
      WHERE id = ${batch.id}
    `;
  });

  const [summary] = await sql`
    SELECT
      (SELECT count(*)::int FROM books) AS books,
      (SELECT count(*)::int FROM book_sections) AS sections,
      (SELECT count(*)::int FROM book_sources) AS sources,
      (SELECT count(*)::int FROM book_categories) AS book_categories,
      (SELECT count(*)::int FROM tags) AS tags,
      (SELECT count(*)::int FROM book_tags) AS book_tags,
      (SELECT count(*)::int FROM content_issues WHERE resolved = false)
        AS open_issues
  `;
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await sql.end();
}
