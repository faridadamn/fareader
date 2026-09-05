// GET /api/admin/insight/models — daftar model AI dari proxy VPS (server-side).
import {
  handleOptions,
  requireAdmin,
  sendError,
  sendJson,
} from "../../_admin-data.js";

const AI_PROXY_URL = process.env.AI_PROXY_URL || "https://faridadamn.my.id/fareader-ai/v1";
const AI_PROXY_TOKEN = process.env.AI_PROXY_TOKEN || "";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    if (!AI_PROXY_TOKEN) {
      return sendJson(request, response, 503, { error: "AI_PROXY_TOKEN belum dikonfigurasi.", code: "AI_NOT_CONFIGURED" });
    }
    const upstream = await fetch(`${AI_PROXY_URL}/models`, {
      headers: { Authorization: `Bearer ${AI_PROXY_TOKEN}` },
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!upstream.ok) {
      return sendJson(request, response, upstream.status, { error: data?.error?.message || data?.error || "Gagal ambil daftar model." });
    }
    const models = (data?.data || []).map((m) => ({ id: m.id, name: m.id }));
    return sendJson(request, response, 200, { data: models });
  } catch (error) {
    return sendError(request, response, error);
  }
}
