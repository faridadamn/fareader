import {
  handleOptions,
  readJsonBody,
  requireAdmin,
  sendError,
  sendJson,
  updateSection,
} from "../../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "PATCH") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    await updateSection(String(request.query.sectionId || ""), await readJsonBody(request));
    return sendJson(request, response, 200, { ok: true });
  } catch (error) {
    return sendError(request, response, error);
  }
}
