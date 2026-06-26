import {
  createSection,
  handleOptions,
  loadBook,
  readJsonBody,
  requireAdmin,
  sendError,
  sendJson,
} from "../../../../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "POST") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const slug = String(request.query.slug || "");
    await createSection(slug, await readJsonBody(request));
    return sendJson(request, response, 200, await loadBook(slug));
  } catch (error) {
    return sendError(request, response, error);
  }
}
