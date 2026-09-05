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
import {
  handleCreate,
  handleGenerate,
  handleModels,
} from "../../_admin-insight.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    const url = requestUrl(request);
    const resource = String(url.searchParams.get("resource") || "books");
    const action = String(url.searchParams.get("action") || "").trim();

    // ===== resource insights/topics: PATCH (update), POST (create/generate), GET (list/detail)
    if (resource !== "books") {
      const id = String(url.searchParams.get("id") || "");

      // GET ?action=models → daftar model AI (resource=insights)
      if (request.method === "GET" && resource === "insights" && action === "models") {
        return sendJson(request, response, 200, await handleModels());
      }

      // POST resource=insights: action=generate → draft AI; tanpa action → create draft baru
      if (request.method === "POST") {
        if (resource !== "insights") {
          return sendJson(request, response, 405, { error: "Method not allowed" });
        }
        const body = await readJsonBody(request);
        if (action === "generate") {
          return sendJson(request, response, 200, await handleGenerate(body));
        }
        const item = await handleCreate(body);
        return sendJson(request, response, 201, item);
      }

      if (request.method === "PATCH") {
        return sendJson(request, response, 200, await updateAdminContent(resource, id, await readJsonBody(request)));
      }
      if (request.method !== "GET") {
        return sendJson(request, response, 405, { error: "Method not allowed" });
      }
      const result = await loadAdminContent(url, resource);
      return result ? sendJson(request, response, 200, result) : sendJson(request, response, 404, { error: "Konten tidak ditemukan." });
    }

    // ===== resource books
    if (!["GET"].includes(request.method)) {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    return sendJson(request, response, 200, await loadBooks(url));
  } catch (error) {
    return sendError(request, response, error);
  }
}
