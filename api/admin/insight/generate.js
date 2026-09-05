// POST /api/admin/insight/generate — bikin draft insight via AI (server-side, proxy VPS).
import {
  handleOptions,
  readJsonBody,
  requireAdmin,
  sendError,
  sendJson,
} from "../../_admin-data.js";
import { generateDraft, DEFAULT_MODEL } from "../../_admin-ai.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "POST") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const body = await readJsonBody(request);
    const draft = await generateDraft({
      model: body?.model || DEFAULT_MODEL,
      brief: body?.brief || "",
      refs: body?.refs || [],
      style: body?.style || "threads_7",
    });
    return sendJson(request, response, 200, { ok: true, draft });
  } catch (error) {
    return sendError(request, response, error);
  }
}
