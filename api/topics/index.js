import {
  handleOptions,
  loadTopicDetail,
  loadTopics,
  requestUrl,
  sendError,
  sendJson,
} from "../_reader-data.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  try {
    if (request.method !== "GET") {
      return sendJson(request, response, 405, { error: "Method not allowed" });
    }
    const url = requestUrl(request);
    const topicId = String(url.searchParams.get("id") || "").trim();
    if (topicId) {
      const topic = await loadTopicDetail(topicId);
      return topic
        ? sendJson(request, response, 200, topic)
        : sendJson(request, response, 404, { error: "Detail knowledge belum tersedia." });
    }
    return sendJson(request, response, 200, await loadTopics(url));
  } catch (error) {
    return sendError(request, response, error);
  }
}
