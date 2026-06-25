import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_READING_SPEED = 200;
const SUMMARY_PUBLISHER = "F15 LIBRARY";

const CATEGORY_RULES = [
  {
    category: "Keuangan & Investasi",
    keywords: [
      "money", "invest", "wealth", "rich", "finance", "financial", "stock",
      "bitcoin", "crypto", "trading", "market", "cashflow", "economics",
    ],
  },
  {
    category: "Bisnis & Kewirausahaan",
    keywords: [
      "business", "startup", "entrepreneur", "marketing", "sales", "company",
      "brand", "customer", "advertising", "innovation", "strategy",
    ],
  },
  {
    category: "Produktivitas",
    keywords: [
      "habit", "productivity", "focus", "work", "time", "essentialism",
      "organize", "procrastination", "discipline", "second brain",
    ],
  },
  {
    category: "Kepemimpinan",
    keywords: [
      "leader", "leadership", "team", "influence", "management", "delegation",
      "ownership", "coach",
    ],
  },
  {
    category: "Psikologi",
    keywords: [
      "psychology", "mind", "emotion", "thinking", "brain", "behavior",
      "trauma", "anxiety", "dopamine", "attached",
    ],
  },
  {
    category: "Kesehatan",
    keywords: [
      "health", "disease", "breath", "sleep", "body", "food", "diet",
      "mortal", "healing",
    ],
  },
  {
    category: "Parenting & Pendidikan",
    keywords: [
      "parent", "children", "child", "education", "school", "montessori",
      "teaching", "discipline",
    ],
  },
  {
    category: "Teknologi",
    keywords: [
      "ai", "artificial intelligence", "digital", "technology", "blockchain",
      "internet", "computer",
    ],
  },
  {
    category: "Filsafat",
    keywords: [
      "philosophy", "stoic", "plato", "aristotle", "tao", "god", "meaning",
      "meditations", "existential",
    ],
  },
  {
    category: "Sejarah & Biografi",
    keywords: [
      "history", "biography", "autobiography", "memoir", "hamilton",
      "franklin", "einstein", "musk", "becoming",
    ],
  },
  {
    category: "Fiksi",
    keywords: [
      "novel", "1984", "animal farm", "karanina", "atonement", "adultery",
      "aleph", "brida", "christmas",
    ],
  },
];

function normalizeSpace(value) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeComparison(value) {
  return normalizeSpace(value)
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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

function wordCount(value) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function isSectionHeading(value) {
  return /^(bagian|aturan|kebiasaan|hukum|prinsip|pilar|pelajaran|langkah|rahasia|level)\s+\d+\s*:/iu
    .test(value);
}

function parseSectionHeading(value) {
  const match = value.match(
    /^(bagian|aturan|kebiasaan|hukum|prinsip|pilar|pelajaran|langkah|rahasia|level)\s+(\d+)\s*:\s*(.+)$/iu,
  );
  if (!match) return null;
  return {
    type: match[1],
    number: Number(match[2]),
    title: normalizeSpace(match[3]),
  };
}

function looksLikeAuthor(value) {
  const words = normalizeSpace(value).split(/\s+/u);
  if (words.length < 1 || words.length > 10) return false;
  if (/[!?]$/.test(value)) return false;
  if (/^bagian\s+\d+/iu.test(value)) return false;
  if (/^https?:\/\//iu.test(value)) return false;
  return value.length <= 100;
}

function countKeyword(haystack, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (haystack.match(new RegExp(`\\b${escaped}\\b`, "giu")) || []).length;
}

function classifyBook(title, sections) {
  const normalizedTitle = title.toLocaleLowerCase("id-ID");
  const headings = sections
    .map((section) => section.title)
    .join(" ")
    .toLocaleLowerCase("id-ID");
  const contentSample = sections
    .map((section) => section.content)
    .join(" ")
    .slice(0, 1800)
    .toLocaleLowerCase("id-ID");

  const scores = CATEGORY_RULES.map((rule) => ({
    category: rule.category,
    score: rule.keywords.reduce((total, keyword) => (
      total
      + countKeyword(normalizedTitle, keyword) * 5
      + countKeyword(headings, keyword) * 2
      + Math.min(countKeyword(contentSample, keyword), 1)
    ), 0),
  })).sort((a, b) => b.score - a.score);

  const categories = scores.filter((item) => item.score >= 2).slice(0, 2);
  return categories.length
    ? categories
    : [{ category: "Pengembangan Diri", score: 0 }];
}

function buildTags(title, sections, categories) {
  const tags = new Set(categories.map((item) => item.category));
  for (const section of sections) {
    const cleaned = section.title
      .replace(/^(pengantar|bagian \d+)$/iu, "")
      .trim();
    if (cleaned && cleaned.length <= 60) tags.add(cleaned);
    if (tags.size >= 8) break;
  }
  if (tags.size < 3) {
    for (const token of slugify(title).split("-")) {
      if (token.length >= 4) tags.add(token);
      if (tags.size >= 5) break;
    }
  }
  return [...tags];
}

function buildDescription(title, author, sections) {
  const firstContent = sections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .find((text) => text.length >= 80);

  if (!firstContent) {
    return `Rangkuman buku ${title}${author ? ` karya ${author}` : ""}.`;
  }

  const shortened = firstContent.length > 240
    ? `${firstContent.slice(0, 237).replace(/\s+\S*$/u, "")}...`
    : firstContent;

  return shortened;
}

async function extractPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const paragraphs = [];
  let current = [];

  const flush = () => {
    const text = normalizeSpace(current.join(" "));
    if (text) paragraphs.push(text);
    current = [];
  };

  for (const item of textContent.items) {
    const text = normalizeSpace(item.str || "");
    if (!text) {
      flush();
      continue;
    }
    current.push(text);
  }
  flush();

  return {
    page: pageNumber,
    paragraphs,
    text: paragraphs.join("\n\n"),
  };
}

function parseHeader(firstPageParagraphs, fallbackTitle) {
  const title = normalizeSpace(firstPageParagraphs[0] || fallbackTitle);
  const publisherLine = firstPageParagraphs.find((line) =>
    /^author\s*:/iu.test(line)
  );
  const sourceLine = firstPageParagraphs.find((line) =>
    /^source\s*:/iu.test(line)
  );
  const publisherCandidate = publisherLine
    ? normalizeSpace(publisherLine.replace(/^author\s*:\s*/iu, ""))
    : "";
  const summaryPublisher = (
    publisherCandidate
    && publisherCandidate !== "-"
  )
    ? publisherCandidate
    : SUMMARY_PUBLISHER;
  const sourceUrl = sourceLine
    ? normalizeSpace(sourceLine.replace(/^source\s*:\s*/iu, ""))
    : "";

  const sourceIndex = firstPageParagraphs.indexOf(sourceLine);
  const bodyStart = sourceIndex >= 0 ? sourceIndex + 1 : 1;
  const body = firstPageParagraphs.slice(bodyStart);
  const titleKey = normalizeComparison(title);
  const publisherKey = normalizeComparison(summaryPublisher);

  let cursor = 0;
  if (normalizeComparison(body[cursor] || "") === titleKey) cursor += 1;
  if (normalizeComparison(body[cursor] || "") === publisherKey) cursor += 1;
  if (normalizeComparison(body[cursor] || "") === titleKey) cursor += 1;

  const authorCandidate = normalizeSpace(body[cursor] || "");
  const originalAuthor = (
    looksLikeAuthor(authorCandidate)
    && normalizeComparison(authorCandidate) !== publisherKey
  )
    ? authorCandidate
    : "";
  if (originalAuthor) cursor += 1;

  return {
    title,
    summaryPublisher,
    sourceUrl,
    originalAuthor,
    firstPageBody: body.slice(cursor),
  };
}

function buildSections(pageParagraphs) {
  const sections = [];
  let current = {
    order_index: 0,
    title: "Pengantar",
    source_page_start: pageParagraphs[0]?.page || 1,
    source_page_end: pageParagraphs[0]?.page || 1,
    paragraphs: [],
  };

  const flush = () => {
    if (!current.paragraphs.length) return;
    current.content = current.paragraphs.map((item) => item.text).join("\n\n");
    current.word_count = wordCount(current.content);
    sections.push(current);
  };

  for (const page of pageParagraphs) {
    for (const text of page.paragraphs) {
      if (isSectionHeading(text)) {
        flush();
        const heading = parseSectionHeading(text);
        current = {
          order_index: sections.length,
          title: heading?.title || text,
          heading_label: text,
          source_page_start: page.page,
          source_page_end: page.page,
          paragraphs: [],
        };
        continue;
      }

      current.paragraphs.push({ page: page.page, text });
      current.source_page_end = page.page;
    }
  }
  flush();

  return sections.map((section, index) => ({
    ...section,
    order_index: index,
  }));
}

function validateBook(book) {
  const issues = [];

  if (!book.title || normalizeComparison(book.title) === "untitled") {
    issues.push({
      code: "INVALID_TITLE",
      severity: "error",
      message: "Judul kosong atau masih Untitled.",
    });
  }
  if (!book.original_author) {
    issues.push({
      code: "MISSING_ORIGINAL_AUTHOR",
      severity: "error",
      message: "Penulis asli tidak berhasil diekstrak.",
    });
  }
  if (
    book.original_author
    && normalizeComparison(book.original_author)
      === normalizeComparison(book.summary_publisher)
  ) {
    issues.push({
      code: "AUTHOR_MATCHES_PUBLISHER",
      severity: "error",
      message: "Penulis asli sama dengan penerbit rangkuman.",
    });
  }
  if (!/^https:\/\/(www\.)?f15library\.com\//iu.test(book.source_url)) {
    issues.push({
      code: "INVALID_SOURCE_URL",
      severity: "error",
      message: "URL sumber kosong atau tidak sesuai host yang diharapkan.",
    });
  }
  if (book.page_count < 2) {
    issues.push({
      code: "TOO_FEW_PAGES",
      severity: "error",
      message: "Dokumen memiliki kurang dari dua halaman.",
    });
  }
  if (book.word_count < 800) {
    issues.push({
      code: "LOW_WORD_COUNT",
      severity: "error",
      message: "Isi rangkuman terlalu pendek.",
    });
  }
  if (book.sections.length < 2) {
    issues.push({
      code: "NO_SECTION_STRUCTURE",
      severity: "warning",
      message: "Struktur Bagian tidak berhasil ditemukan.",
    });
  }
  if (book.sections.some((section) => section.word_count < 20)) {
    issues.push({
      code: "VERY_SHORT_SECTION",
      severity: "warning",
      message: "Terdapat bagian dengan isi sangat pendek.",
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const requiresStructuralReview = issues.some(
    (issue) => issue.code === "NO_SECTION_STRUCTURE",
  );
  return {
    status: hasError || requiresStructuralReview
      ? "needs_review"
      : "ready_for_review",
    issues,
  };
}

export async function ingestPdf(filePath, options = {}) {
  const bytes = await readFile(filePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    verbosity: 0,
  }).promise;

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await extractPage(pdf, pageNumber));
    }

    const fallbackTitle = path.basename(filePath, path.extname(filePath))
      .replace(/[-_]+/g, " ");
    const header = parseHeader(pages[0]?.paragraphs || [], fallbackTitle);

    if (pages[0]) {
      pages[0] = {
        ...pages[0],
        paragraphs: header.firstPageBody,
        text: header.firstPageBody.join("\n\n"),
      };
    }

    const sections = buildSections(pages);
    const fullContent = sections.map((section) => section.content).join("\n\n");
    const totalWords = wordCount(fullContent);
    const categories = classifyBook(header.title, sections);

    const book = {
      schema_version: "1.0",
      source_file: path.basename(filePath),
      source_path: filePath,
      checksum_sha256: checksum,
      title: header.title,
      slug: slugify(header.title),
      original_author: header.originalAuthor,
      summary_publisher: header.summaryPublisher,
      source_url: header.sourceUrl,
      language: "id",
      page_count: pdf.numPages,
      word_count: totalWords,
      reading_time_minutes: Math.max(
        1,
        Math.ceil(totalWords / (options.readingSpeed || DEFAULT_READING_SPEED)),
      ),
      categories: categories.map((item) => item.category),
      category_suggestions: categories,
      tags: buildTags(header.title, sections, categories),
      description: buildDescription(header.title, header.originalAuthor, sections),
      sections: sections.map(({ paragraphs, ...section }) => section),
    };

    return {
      ...book,
      quality: validateBook(book),
    };
  } finally {
    await pdf.destroy();
  }
}

export async function listPdfFiles(inputDirectory) {
  const entries = await readdir(inputDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => path.join(inputDirectory, entry.name))
    .sort((a, b) => a.localeCompare(b, "en"));
}

export async function runIngestion(options) {
  const {
    inputDirectory,
    outputDirectory,
    limit,
    fileNames,
    readingSpeed = DEFAULT_READING_SPEED,
  } = options;

  await mkdir(outputDirectory, { recursive: true });
  const allFiles = await listPdfFiles(inputDirectory);
  let selectedFiles = fileNames?.length
    ? fileNames.map((name) => path.join(inputDirectory, name))
    : allFiles;

  if (Number.isFinite(limit) && limit > 0) {
    selectedFiles = selectedFiles.slice(0, limit);
  }

  const books = [];
  const failures = [];

  for (const filePath of selectedFiles) {
    try {
      const book = await ingestPdf(filePath, { readingSpeed });
      books.push(book);
      await writeFile(
        path.join(outputDirectory, `${book.slug}.json`),
        `${JSON.stringify(book, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      failures.push({
        source_file: path.basename(filePath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    input_directory: inputDirectory,
    output_directory: outputDirectory,
    total_available: allFiles.length,
    total_selected: selectedFiles.length,
    processed: books.length,
    failed: failures.length,
    ready_for_review: books.filter(
      (book) => book.quality.status === "ready_for_review",
    ).length,
    needs_review: books.filter(
      (book) => book.quality.status === "needs_review",
    ).length,
    failures,
    items: books.map((book) => ({
      source_file: book.source_file,
      title: book.title,
      original_author: book.original_author,
      page_count: book.page_count,
      word_count: book.word_count,
      section_count: book.sections.length,
      reading_time_minutes: book.reading_time_minutes,
      status: book.quality.status,
      issues: book.quality.issues.map((issue) => issue.code),
    })),
  };

  await writeFile(
    path.join(outputDirectory, "_ingestion-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDirectory, "_catalog.json"),
    `${JSON.stringify(books, null, 2)}\n`,
    "utf8",
  );

  return { books, report };
}
