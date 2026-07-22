import {
  handleOptions,
  loadInsightDetail,
  loadInsights,
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
    const insightId = String(url.searchParams.get("id") || "").trim();
    if (insightId) {
      const insight = await loadInsightDetail(insightId);
      return insight
        ? sendJson(request, response, 200, insight)
        : sendJson(request, response, 404, { error: "Insight belum tersedia." });
    }
    return sendJson(request, response, 200, await loadInsights(url));
  } catch (error) {
    return sendError(request, response, error);
  }
}
