import { readFile, stat } from "node:fs/promises";
import path from "node:path";

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}

export async function loadCatalog(catalogPath) {
  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  if (!Array.isArray(catalog)) {
    throw new Error("Catalog harus berupa array JSON.");
  }
  return catalog;
}

export function validateCatalog(catalog) {
  const errors = [];
  const warnings = [];
  const slugs = new Set();
  const checksums = new Set();

  for (const [index, book] of catalog.entries()) {
    const location = `book[${index}]`;
    const requiredStrings = [
      "schema_version",
      "source_file",
      "checksum_sha256",
      "title",
      "slug",
      "summary_publisher",
      "source_url",
      "language",
    ];

    for (const field of requiredStrings) {
      if (typeof book[field] !== "string" || !book[field].trim()) {
        errors.push(`${location}.${field} wajib berupa string non-kosong.`);
      }
    }

    if (!/^[a-f0-9]{64}$/i.test(book.checksum_sha256 || "")) {
      errors.push(`${location}.checksum_sha256 tidak valid.`);
    }
    if (slugs.has(book.slug)) {
      errors.push(`${location}.slug duplikat: ${book.slug}`);
    }
    if (checksums.has(book.checksum_sha256)) {
      errors.push(`${location}.checksum duplikat: ${book.checksum_sha256}`);
    }
    slugs.add(book.slug);
    checksums.add(book.checksum_sha256);

    if (!Array.isArray(book.sections)) {
      errors.push(`${location}.sections wajib berupa array.`);
    } else {
      book.sections.forEach((section, sectionIndex) => {
        if (section.order_index !== sectionIndex) {
          warnings.push(
            `${location}.sections[${sectionIndex}] order_index tidak berurutan.`,
          );
        }
        if (!section.title || !section.content) {
          errors.push(
            `${location}.sections[${sectionIndex}] membutuhkan title dan content.`,
          );
        }
      });
    }

    if (!book.quality || !Array.isArray(book.quality.issues)) {
      errors.push(`${location}.quality.issues wajib tersedia.`);
    }
  }

  return {
    valid: errors.length === 0,
    totalBooks: catalog.length,
    readyForReview: catalog.filter(
      (book) => book.quality?.status === "ready_for_review",
    ).length,
    needsReview: catalog.filter(
      (book) => book.quality?.status === "needs_review",
    ).length,
    errors,
    warnings,
  };
}

async function queryOne(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

async function importBook(client, book, options) {
  const sourceStat = await stat(book.source_path).catch(() => null);
  const dbStatus = book.quality.status === "needs_review"
    ? "needs_review"
    : "ready_for_review";

  const savedBook = await queryOne(
    client,
    `
      INSERT INTO books (
        slug, title, original_author, summary_publisher, language,
        description, page_count, word_count, reading_time_minutes, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      RETURNING id
    `,
    [
      book.slug,
      book.title,
      book.original_author || null,
      book.summary_publisher,
      book.language,
      book.description || null,
      book.page_count,
      book.word_count,
      book.reading_time_minutes,
      dbStatus,
    ],
  );

  const bookId = savedBook.id;

  await client.query(
    `
      INSERT INTO book_sources (
        book_id, ingestion_batch_id, source_file, source_path, source_url,
        checksum_sha256, file_size_bytes, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (checksum_sha256) DO UPDATE SET
        book_id = EXCLUDED.book_id,
        ingestion_batch_id = EXCLUDED.ingestion_batch_id,
        source_file = EXCLUDED.source_file,
        source_path = EXCLUDED.source_path,
        source_url = EXCLUDED.source_url,
        file_size_bytes = EXCLUDED.file_size_bytes,
        metadata = EXCLUDED.metadata
    `,
    [
      bookId,
      options.batchId,
      book.source_file,
      book.source_path || null,
      book.source_url,
      book.checksum_sha256,
      sourceStat?.size || null,
      JSON.stringify({
        schema_version: book.schema_version,
        category_suggestions: book.category_suggestions || [],
      }),
    ],
  );

  await client.query("DELETE FROM book_sections WHERE book_id = $1", [bookId]);
  for (const section of book.sections) {
    await client.query(
      `
        INSERT INTO book_sections (
          book_id, order_index, title, heading_label, content, word_count,
          source_page_start, source_page_end
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        bookId,
        section.order_index,
        section.title,
        section.heading_label || null,
        section.content,
        section.word_count,
        section.source_page_start || null,
        section.source_page_end || null,
      ],
    );
  }

  await client.query("DELETE FROM book_categories WHERE book_id = $1", [bookId]);
  for (const [index, categoryName] of (book.categories || []).entries()) {
    const category = await queryOne(
      client,
      `
        INSERT INTO categories (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `,
      [slugify(categoryName), categoryName],
    );
    const suggestion = book.category_suggestions?.find(
      (item) => item.category === categoryName,
    );
    await client.query(
      `
        INSERT INTO book_categories (
          book_id, category_id, confidence, is_primary, source
        )
        VALUES ($1, $2, $3, $4, 'automatic')
        ON CONFLICT (book_id, category_id) DO UPDATE SET
          confidence = EXCLUDED.confidence,
          is_primary = EXCLUDED.is_primary,
          source = EXCLUDED.source
      `,
      [
        bookId,
        category.id,
        Math.min(Number(suggestion?.score || 0) * 10, 100),
        index === 0,
      ],
    );
  }

  await client.query("DELETE FROM book_tags WHERE book_id = $1", [bookId]);
  for (const tagName of book.tags || []) {
    const tag = await queryOne(
      client,
      `
        INSERT INTO tags (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `,
      [slugify(tagName), tagName],
    );
    await client.query(
      `
        INSERT INTO book_tags (book_id, tag_id, source)
        VALUES ($1, $2, 'automatic')
        ON CONFLICT (book_id, tag_id) DO NOTHING
      `,
      [bookId, tag.id],
    );
  }

  await client.query(
    "DELETE FROM content_issues WHERE book_id = $1 AND resolved = false",
    [bookId],
  );
  for (const issue of book.quality.issues) {
    await client.query(
      `
        INSERT INTO content_issues (book_id, code, severity, message)
        VALUES ($1, $2, $3, $4)
      `,
      [bookId, issue.code, issue.severity, issue.message],
    );
  }
}

export async function importCatalog(client, catalog, options = {}) {
  const sourceDirectory = options.sourceDirectory || path.dirname(
    options.catalogPath || "",
  );

  await client.query("BEGIN");
  try {
    const batch = await queryOne(
      client,
      `
        INSERT INTO ingestion_batches (
          source_directory, schema_version, total_selected, started_at
        )
        VALUES ($1, $2, $3, now())
        RETURNING id
      `,
      [
        sourceDirectory,
        catalog[0]?.schema_version || "1.0",
        catalog.length,
      ],
    );

    let processed = 0;
    for (const book of catalog) {
      await importBook(client, book, {
        ...options,
        batchId: batch.id,
      });
      processed += 1;
      options.onProgress?.({ processed, total: catalog.length, book });
    }

    await client.query(
      `
        UPDATE ingestion_batches
        SET processed_count = $2,
            failed_count = 0,
            completed_at = now(),
            report = $3::jsonb
        WHERE id = $1
      `,
      [
        batch.id,
        processed,
        JSON.stringify({
          imported: processed,
          ready_for_review: catalog.filter(
            (book) => book.quality.status === "ready_for_review",
          ).length,
          needs_review: catalog.filter(
            (book) => book.quality.status === "needs_review",
          ).length,
        }),
      ],
    );

    await client.query("COMMIT");
    return { batchId: batch.id, processed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
