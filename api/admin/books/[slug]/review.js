import {
  handleOptions,
  loadBook,
  readJsonBody,
  requireAdmin,
  reviewBook,
  sendError,
  sendJson,
} from "../../../../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "PATCH") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const slug = String(request.query.slug || "");
    await reviewBook(slug, await readJsonBody(request));
    return sendJson(request, response, 200, await loadBook(slug));
  } catch (error) {
    return sendError(request, response, error);
  }
}
