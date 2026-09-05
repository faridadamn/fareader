// Helper insight AI — create draft, generate draft AI, daftar model.
// Bukan serverless function (diawali _) — di-dispatch dari api/admin/books/index.js
// biar jumlah function Vercel tetap di bawah limit 12.
import { getSql } from "./_admin-data.js";
import { generateDraft, DEFAULT_MODEL } from "./_admin-ai.js";

const AI_PROXY_URL = process.env.AI_PROXY_URL || "https://faridadamn.my.id/fareader-ai/v1";
const AI_PROXY_TOKEN = process.env.AI_PROXY_TOKEN || "";

// ---------- create ----------
const AI_SOURCE_KEY = "manual_ai_draft_workspace";
const AI_SOURCE_TITLE = "AI Draft Workspace (buatan admin via editor)";

async function ensureAiSource(sql) {
  const [existing] = await sql`SELECT id FROM content_sources WHERE source_key = ${AI_SOURCE_KEY} LIMIT 1`;
  if (existing) return existing.id;
  const [created] = await sql`
    INSERT INTO content_sources (
      source_key, provider, canonical_url, title, body_text, body_markdown,
      images, access_status, content_hash, source_metadata, processing_status
    ) VALUES (
      ${AI_SOURCE_KEY}, 'manual', '', ${AI_SOURCE_TITLE}, '', '',
      '[]'::jsonb, 'private_ai', 'ai-draft-workspace', '{}'::jsonb, 'unprocessed'
    )
    ON CONFLICT (source_key) DO UPDATE SET title = EXCLUDED.title
    RETURNING id
  `;
  return created.id;
}

function buildMarkdown({ title, thesis, posts }) {
  const lines = [
    `# ${title}`,
    "",
    thesis ? `Tesis: ${thesis}` : "",
    "",
    ...(posts || []).map((p, i) => `${i + 1}. ${p.text}`),
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

function cleanText(value, max = 100000) {
  return String(value ?? "").trim().slice(0, max);
}

export async function handleCreate(body) {
  const title = cleanText(body.title, 500);
  if (!title) throw Object.assign(new Error("Judul insight wajib diisi."), { statusCode: 400 });
  const thesis = cleanText(body.thesis, 5000);
  const contentTypes = (Array.isArray(body.content_types) ? body.content_types : [])
    .map((x) => cleanText(x, 100)).filter(Boolean).slice(0, 20);
  if (!contentTypes.length) contentTypes.push("insight");
  const posts = Array.isArray(body.posts)
    ? body.posts
      .map((p, index) => ({ number: Number(p?.number || index + 1), text: cleanText(p?.text, 20000) }))
      .filter((p) => p.text)
    : [];
  if (!posts.length) throw Object.assign(new Error("Isi insight (posts) wajib ada."), { statusCode: 400 });
  const format = cleanText(body.format, 100) || "threads_7";
  const status = ["draft", "published"].includes(body.status) ? body.status : "draft";

  const sql = getSql();
  const sourceId = await ensureAiSource(sql);
  const draftKey = `manual_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const markdown = buildMarkdown({ title, thesis, posts });

  const [item] = await sql`
    INSERT INTO content_drafts (
      draft_key, source_id, title, thesis, content_types, format, posts,
      content_markdown, originality_report, status, published_at, updated_at
    ) VALUES (
      ${draftKey}, ${sourceId}, ${title}, ${thesis}, ${contentTypes}, ${format},
      ${sql.json(posts)}, ${markdown}, '{}'::jsonb, ${status},
      CASE WHEN ${status} = 'published' THEN now() ELSE NULL END, now()
    )
    RETURNING id, title, thesis, content_types, format, posts, status, created_at
  `;
  return item;
}

// ---------- generate AI ----------
export async function handleGenerate(body) {
  const draft = await generateDraft({
    model: body?.model || DEFAULT_MODEL,
    brief: body?.brief || "",
    refs: body?.refs || [],
    style: body?.style || "threads_7",
  });
  return { ok: true, draft };
}

// ---------- models ----------
export async function handleModels() {
  if (!AI_PROXY_TOKEN) {
    throw Object.assign(new Error("AI_PROXY_TOKEN belum dikonfigurasi."), { statusCode: 503 });
  }
  const upstream = await fetch(`${AI_PROXY_URL}/models`, {
    headers: { Authorization: `Bearer ${AI_PROXY_TOKEN}` },
  });
  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!upstream.ok) {
    throw Object.assign(new Error(data?.error?.message || data?.error || "Gagal ambil daftar model."), { statusCode: upstream.status });
  }
  return { data: (data?.data || []).map((m) => ({ id: m.id, name: m.id })) };
}
