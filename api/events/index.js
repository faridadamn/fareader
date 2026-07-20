import {
  handleOptions,
  recordProductEvent,
  sendError,
  sendJson,
} from "../_reader-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  try {
    if (request.method !== "POST") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const payload = typeof request.body === "string"
      ? JSON.parse(request.body)
      : (request.body || {});
    return sendJson(request, response, 202, await recordProductEvent(payload));
  } catch (error) {
    return sendError(request, response, error);
  }
}
