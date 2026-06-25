import {
  handleOptions,
  loadBook,
  sendError,
  sendJson,
} from "../_reader-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const slug = String(request.query.slug || "");
    const book = await loadBook(slug);
    return book
      ? sendJson(request, response, 200, book)
      : sendJson(request, response, 404, { error: "Buku belum tersedia." });
  } catch (error) {
    return sendError(request, response, error);
  }
}
