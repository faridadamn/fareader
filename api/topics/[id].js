import { handleOptions, loadTopicDetail, sendError, sendJson } from "../_reader-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const topic = await loadTopicDetail(String(request.query.id || ""));
    return topic
      ? sendJson(request, response, 200, topic)
      : sendJson(request, response, 404, { error: "Detail knowledge belum tersedia." });
  } catch (error) {
    return sendError(request, response, error);
  }
}
