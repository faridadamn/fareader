import {
  handleOptions,
  loadHealth,
  sendError,
  sendJson,
} from "./_reader-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    return sendJson(request, response, 200, await loadHealth());
  } catch (error) {
    return sendError(request, response, error);
  }
}
