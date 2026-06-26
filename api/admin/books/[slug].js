import {
  handleOptions,
  loadBook,
  requireAdmin,
  sendError,
  sendJson,
} from "../../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const book = await loadBook(String(request.query.slug || ""));
    return book
      ? sendJson(request, response, 200, book)
      : sendJson(request, response, 404, { error: "Buku tidak ditemukan." });
  } catch (error) {
    return sendError(request, response, error);
  }
}
