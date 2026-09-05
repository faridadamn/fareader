// Helper AI untuk FA Reader admin — ambil bahan dari DB + panggil AI proxy VPS.
import { getSql } from "./_admin-data.js";

const AI_PROXY_URL = process.env.AI_PROXY_URL || "https://faridadamn.my.id/fareader-ai/v1";
const AI_PROXY_TOKEN = process.env.AI_PROXY_TOKEN || "";
const CONTEXT_CHAR_LIMIT = 14_000; // total karakter bahan yang dikirim ke model

export const DEFAULT_MODEL = "cmc/deepseek/deepseek-v4-flash";

function clean(value) {
  return String(value ?? "").trim();
}

function clip(text, max) {
  const s = clean(text);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Ambil isi bahan dari DB berdasarkan refs [{type, id, sections?, scope?}]
// - scope: 'whole' (default) ambil semua bagian; 'section' ambil cuma bagian terpilih
// - sections: array order_index (opsional), filter ke bagian tertentu
// return: { label, kind, text }[]
export async function loadRefs(refs) {
  if (!Array.isArray(refs) || !refs.length) return [];
  const sql = getSql();
  const out = [];

  for (const ref of refs.slice(0, 4)) {
    const type = ref?.type;
    const id = clean(ref?.id);
    if (!id) continue;

    if (type === "book") {
      const wantedSections = Array.isArray(ref.sections) && ref.sections.length
        ? ref.sections.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : [];
      const scope = ref.scope || "whole";

      const [r] = await sql`
        SELECT b.title, b.original_author, b.description,
          (SELECT jsonb_agg(
            jsonb_build_object('order_index', s.order_index, 'title', s.title, 'content', s.content)
            ORDER BY s.order_index)
            FROM book_sections s WHERE s.book_id = b.id
          ) AS sections
        FROM books b WHERE b.slug = ${id} LIMIT 1
      `;
      if (!r) continue;
      let sections = Array.isArray(r.sections) ? r.sections : [];
      // filter bagian terpilih kalau ada
      if (wantedSections.length && scope === "section") {
        sections = sections.filter((s) => wantedSections.includes(Number(s.order_index)));
      }

      const parts = [`Buku: ${r.title}${r.original_author ? " — " + r.original_author : ""}`];
      if (r.description) parts.push("Deskripsi: " + clip(r.description, 600));
      if (sections.length) {
        // seluruh buku: ringkas tiap bagian; per chapter: fokus penuh
        const capEach = scope === "section" ? 2400 : 900;
        const secText = sections.map((s) => {
          const title = clean(s.title);
          return (title ? title + ":\n" : "") + clip(s.content || "", capEach);
        }).join("\n\n");
        if (secText) parts.push("Isi:\n" + secText);
      } else if (scope === "section") {
        parts.push("(Bagian yang dipilih tidak ditemukan pada buku ini.)");
      }
      out.push({ label: r.title, kind: "book", text: parts.join("\n\n") });
    }

    else if (type === "topic") {
      const [r] = await sql`
        SELECT t.id, t.title, t.categories, t.points,
          (SELECT n.content FROM notes n WHERE n.topic_id = t.id LIMIT 1) AS note_content
        FROM topics t WHERE t.id = ${id} LIMIT 1
      `;
      if (!r) continue;
      const parts = [`Knowledge: ${r.title}`];
      if (Array.isArray(r.categories) && r.categories.length) parts.push("Kategori: " + r.categories.join(", "));
      const points = Array.isArray(r.points) ? r.points : [];
      if (points.length) parts.push("Poin:\n" + points.slice(0, 10).map((p, i) => `${i + 1}. ${clip(p, 800)}`).join("\n"));
      if (r.note_content) parts.push("Detail:\n" + clip(String(r.note_content).replace(/<[^>]*>/g, " "), 2000));
      out.push({ label: r.title, kind: "topic", text: parts.join("\n\n") });
    }
  }

  return out;
}

// Ambil daftar bagian buku untuk chapter picker (multi-insight per chapter)
export async function loadBookSections(slug) {
  const sql = getSql();
  const [book] = await sql`SELECT title FROM books WHERE slug = ${slug} LIMIT 1`;
  if (!book) return null;
  const sections = await sql`
    SELECT order_index, title, heading_label, word_count
    FROM book_sections
    WHERE book_id = (SELECT id FROM books WHERE slug = ${slug})
    ORDER BY order_index
  `;
  return { title: book.title, sections };
}

// Bangun prompt sistem + user dari bahan
export function buildPrompt({ brief, refs, style = "threads_7" }) {
  const styleGuide = style === "threads_7"
    ? `Format "threads_7": 7 post singkat bernomor berurutan, bahasa Indonesia santai khas konten viral (boleh "lo/gue"), tiap post 1-3 kalimat yang berdiri sendiri, ada hook di post pertama, tiap post selesai dengan kalimat yang bikin pengen lanjut ke post berikutnya, post terakhir ada ajakan/kesimpulan.`
    : `Format insight bertingkat dengan ${style}, bahasa Indonesia santai, tiap post 1-3 kalimat, hook di awal, kesimpulan/ajakan di akhir.`;

  return {
    system: `Kamu adalah editor konten Indonesia yang ahli mengubah bahan bacaan (rangkuman buku / knowledge) menjadi insight viral yang enak dibaca.
Tugasmu: buat draft insight berdasarkan BAHAN yang diberikan. JANGAN mengarang fakta, angka, atau kutipan yang tidak ada di bahan. Tulis dalam bahasa Indonesia natural.`,
    user: `Buat draft insight dari bahan berikut.
${refs.map((r, i) => `\n===== BAHAN ${i + 1}: ${r.label} =====\n${clip(r.text, 5000)}`).join("")}
${brief ? `\nArahan admin: ${brief}` : ""}

${styleGuide}

Output HANYA JSON murni (tanpa markdown, tanpa teks lain) dengan skema:
{
  "title": "judul insight yang catchy",
  "thesis": "satu kalimat inti insight",
  "content_types": ["insight", "tag1", "tag2"],
  "posts": [
    { "number": 1, "text": "hook pembuka" },
    { "number": 2, "text": "isi lanjutan" }
  ]
}
Jumlah posts sesuai format. Pastikan JSON valid dan bisa di-parse langsung.`,
  };
}

// Panggil proxy AI VPS (OpenAI-compatible), return parsed draft.
// Retry otomatis sampai 3x kalau model return non-JSON (kasus umum model via router).
export async function generateDraft({ model, brief, refs, style }) {
  if (!AI_PROXY_TOKEN) {
    throw Object.assign(new Error("AI_PROXY_TOKEN belum dikonfigurasi."), { statusCode: 503 });
  }
  const context = await loadRefs(refs);
  if (!context.length) {
    throw Object.assign(new Error("Tidak ada bahan valid untuk diproses."), { statusCode: 400 });
  }
  const { system, user } = buildPrompt({ brief, refs: context, style });

  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${AI_PROXY_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_PROXY_TOKEN}`,
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: attempt > 1 ? 0.9 : 0.7, // variasi kecil pas retry biar output beda
          max_tokens: 6000,
          // Matikan reasoning/thinking biar output langsung ke content (bukan reasoning_content)
          thinking: { type: "disabled" },
        }),
      });

      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      if (!response.ok) {
        const msg = data?.error?.message || data?.error || `HTTP ${response.status}`;
        throw Object.assign(new Error("AI gagal: " + String(msg).slice(0, 300)), { statusCode: 502 });
      }

      const content = data?.choices?.[0]?.message?.content || "";
      const draftObj = extractJson(content);
      if (!draftObj) {
        throw Object.assign(new Error("AI tidak mengembalikan JSON valid."), { statusCode: 502 });
      }
      const draft = normalizeDraft(draftObj, style);
      return draft;
    } catch (error) {
      lastError = error;
      // jangan retry kalau error non-parse (auth/5xx) atau 400
      if (error.statusCode && error.statusCode !== 502) throw error;
      // kalau 502 (gagal parse) retry; tapi kalau sudah attempt terakhir, lempar
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastError || new Error("Gagal menghasilkan draft.");
}

// Parse JSON dari teks model. Return object/array hasil parse, atau null.
function extractJson(text) {
  const s = clean(text);
  if (!s) return null;
  // coba parse langsung
  try { return JSON.parse(s); } catch { /* lanjut */ }
  // cari blok ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* lanjut */ }
  }
  // cari {...} pertama yang valid
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* gagal */ }
  }
  return null;
}

function normalizeDraft(draft, style) {
  const posts = Array.isArray(draft?.posts)
    ? draft.posts.map((p, i) => ({
        number: Number(p?.number || i + 1),
        text: clean(p?.text),
      })).filter((p) => p.text)
    : [];
  if (!posts.length) throw Object.assign(new Error("AI tidak menghasilkan post."), { statusCode: 502 });
  const postCount = style === "threads_7" ? 7 : posts.length;
  // pastikan urut
  posts.sort((a, b) => a.number - b.number);
  const normalized = posts.slice(0, Math.max(postCount, posts.length));
  return {
    title: clean(draft?.title) || "Tanpa judul",
    thesis: clean(draft?.thesis) || clean(posts[0]?.text || "").slice(0, 200),
    content_types: Array.isArray(draft?.content_types) && draft.content_types.length
      ? draft.content_types.map(clean).filter(Boolean).slice(0, 8)
      : ["insight"],
    format: style || "threads_7",
    posts: normalized.map((p, i) => ({ number: i + 1, text: p.text })),
  };
}
