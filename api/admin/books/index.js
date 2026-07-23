import {
  handleOptions,
  loadAdminContent,
  loadBooks,
  readJsonBody,
  requestUrl,
  requireAdmin,
  sendError,
  sendJson,
  updateAdminContent,
} from "../../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (!["GET", "PATCH"].includes(request.method)) {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const url = requestUrl(request);
    const resource = String(url.searchParams.get("resource") || "books");
    if (resource !== "books") {
      const id = String(url.searchParams.get("id") || "");
      if (request.method === "PATCH") {
        return sendJson(request, response, 200, await updateAdminContent(resource, id, await readJsonBody(request)));
      }
      const result = await loadAdminContent(url, resource);
      return result ? sendJson(request, response, 200, result) : sendJson(request, response, 404, { error: "Konten tidak ditemukan." });
    }
    if (request.method !== "GET") return sendJson(request, response, 405, { error: "Method not allowed" });
    return sendJson(request, response, 200, await loadBooks(url));
  } catch (error) {
    return sendError(request, response, error);
  }
}
