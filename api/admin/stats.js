import {
  handleOptions,
  loadStats,
  requireAdmin,
  sendError,
  sendJson,
} from "../_admin-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (!requireAdmin(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    return sendJson(request, response, 200, await loadStats());
  } catch (error) {
    return sendError(request, response, error);
  }
}
