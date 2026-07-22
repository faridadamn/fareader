const STORAGE_KEYS = {
  progress: "fa-reader:progress:v1",
  bookmarks: "fa-reader:bookmarks:v1",
  fontScale: "fa-reader:font-scale:v1",
  highlights: "fa-reader:highlights:v1",
  readingItems: "fa-reader:reading-items:v1",
  sessionId: "fa-reader:session-id:v1",
  completedEvents: "fa-reader:completed-events:v1",
};

const CONFIGURED_API_BASE = String(window.FA_READER_API_BASE || "").replace(/\/$/, "");
const IS_NATIVE_APP = Boolean(window.Capacitor?.isNativePlatform?.())
  || window.location.protocol === "capacitor:"
  || window.location.protocol === "file:";
const API_BASE = IS_NATIVE_APP ? CONFIGURED_API_BASE : "";

const state = {
  page: 1,
  totalPages: 1,
  knowledgePage: 1,
  knowledgeTotalPages: 1,
  knowledgeItems: [],
  insightItems: [],
  booksLoading: false,
  knowledgeLoading: false,
  booksHasMore: true,
  knowledgeHasMore: true,
  activeView: "home",
  selectedSlug: null,
  currentBook: null,
  libraryItems: [],
  readingItems: new Map(Object.entries(readStorage(STORAGE_KEYS.readingItems, {}))),
  bookmarkItems: new Map(),
  progress: readStorage(STORAGE_KEYS.progress, {}),
  bookmarks: new Set(readStorage(STORAGE_KEYS.bookmarks, [])),
  highlights: readStorage(STORAGE_KEYS.highlights, []),
  activeSavedTab: "bookmarks",
  fontScale: readStorage(STORAGE_KEYS.fontScale, 1),
  readerScrollCleanup: null,
  searchTimer: null,
  sessionId: getOrCreateSessionId(),
  completedEvents: new Set(readStorage(STORAGE_KEYS.completedEvents, [])),
  completionPending: new Set(),
};

const elements = {
  modeBadge: document.querySelector("#modeBadge"),
  totalBooks: document.querySelector("#totalBooks"),
  savedCount: document.querySelector("#savedCount"),
  readingCount: document.querySelector("#readingCount"),
  resultMeta: document.querySelector("#resultMeta"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  bookList: document.querySelector("#bookList"),
  bookmarkList: document.querySelector("#bookmarkList"),
  highlightList: document.querySelector("#highlightList"),
  knowledgeList: document.querySelector("#knowledgeList"),
  knowledgeMeta: document.querySelector("#knowledgeMeta"),
  bookLoadStatus: document.querySelector("#bookLoadStatus"),
  bookSentinel: document.querySelector("#bookSentinel"),
  knowledgeLoadStatus: document.querySelector("#knowledgeLoadStatus"),
  knowledgeSentinel: document.querySelector("#knowledgeSentinel"),
  knowledgeDetail: document.querySelector("#knowledgeDetail"),
  knowledgeBackButton: document.querySelector("#knowledgeBackButton"),
  reader: document.querySelector("#reader"),
  continuePanel: document.querySelector("#continuePanel"),
  homeShelves: document.querySelector("#homeShelves"),
  insightList: document.querySelector("#insightList"),
  insightMeta: document.querySelector("#insightMeta"),
  insightDetail: document.querySelector("#insightDetail"),
  insightBackButton: document.querySelector("#insightBackButton"),
  supportModal: document.querySelector("#supportModal"),
  views: {
    home: document.querySelector("#homeView"),
    books: document.querySelector("#booksView"),
    knowledge: document.querySelector("#knowledgeView"),
    knowledgeDetail: document.querySelector("#knowledgeDetailView"),
    insight: document.querySelector("#insightView"),
    insightDetail: document.querySelector("#insightDetailView"),
    bookmarks: document.querySelector("#bookmarksView"),
    reader: document.querySelector("#readerView"),
  },
};

const formatNumber = new Intl.NumberFormat("id-ID");

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getOrCreateSessionId() {
  const existing = localStorage.getItem(STORAGE_KEYS.sessionId);
  if (existing) return existing;
  const created = crypto.randomUUID?.()
    || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.sessionId, created);
  return created;
}

async function postJson(url, body) {
  const response = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Permintaan gagal.");
  return payload;
}

function trackBookEvent(eventName, slug) {
  if (!slug) return;
  postJson("/api/events", {
    event_name: eventName,
    slug,
    session_id: state.sessionId,
  }).catch(() => {
    // Analytics must never interrupt reading.
  });
}

function trackBookCompletion(slug) {
  if (state.completedEvents.has(slug) || state.completionPending.has(slug)) return;
  state.completionPending.add(slug);
  postJson("/api/events", {
    event_name: "book_completed",
    slug,
    session_id: state.sessionId,
  }).then(() => {
    state.completedEvents.add(slug);
    writeStorage(STORAGE_KEYS.completedEvents, Array.from(state.completedEvents));
  }).catch(() => {
    // A later scroll can retry if the analytics request failed.
  }).finally(() => {
    state.completionPending.delete(slug);
  });
}

function applyFontScale() {
  const scale = Math.min(1.45, Math.max(0.85, Number(state.fontScale) || 1));
  state.fontScale = scale;
  document.documentElement.style.setProperty("--reader-font-scale", scale.toFixed(2));
  document.querySelectorAll("[data-font-scale-label]").forEach((label) => {
    label.textContent = `${Math.round(scale * 100)}%`;
  });
}

function changeFontScale(delta) {
  state.fontScale = Math.min(1.45, Math.max(0.85, Number((state.fontScale + delta).toFixed(2))));
  writeStorage(STORAGE_KEYS.fontScale, state.fontScale);
  applyFontScale();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getJson(url) {
  const response = await fetch(`${API_BASE}${url}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Permintaan gagal.");
  return payload;
}

function tag(value, type = "") {
  return `<span class="tag ${type}">${escapeHtml(value)}</span>`;
}

function highlightCount() {
  return state.highlights.length;
}

function highlightsFor(slug, sectionIndex = null) {
  return state.highlights.filter((item) => (
    item.slug === slug
    && (sectionIndex === null || item.sectionIndex === sectionIndex)
  ));
}

const HTML_CONTENT_PATTERN = /<\/?[a-z][\s\S]*>/i;
const ALLOWED_BOOK_TAGS = new Set([
  "a", "article", "b", "blockquote", "br", "caption", "code", "div", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
  "img", "li", "ol", "p", "pre", "section", "small", "span", "strong",
  "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
]);
const BLOCKED_BOOK_TAGS = new Set([
  "base", "button", "embed", "form", "iframe", "input", "link", "meta",
  "object", "script", "select", "style", "svg", "textarea",
]);

function isHtmlContent(value) {
  return HTML_CONTENT_PATTERN.test(String(value || ""));
}

function safeContentUrl(value, { image = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "https:" || (!image && url.protocol === "http:")) {
      return url.href;
    }
  } catch {
    // Invalid and relative URLs are intentionally discarded.
  }
  return "";
}

function sanitizeBookHtml(rawHtml) {
  const documentNode = new DOMParser().parseFromString(String(rawHtml || ""), "text/html");
  const elementsToInspect = Array.from(documentNode.body.querySelectorAll("*"));

  for (const element of elementsToInspect) {
    const tagName = element.tagName.toLowerCase();
    if (BLOCKED_BOOK_TAGS.has(tagName)) {
      element.remove();
      continue;
    }
    if (!ALLOWED_BOOK_TAGS.has(tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowed = name === "dir"
        || (tagName === "a" && ["href", "title"].includes(name))
        || (tagName === "img" && ["src", "alt", "title", "width", "height"].includes(name));
      if (!allowed) element.removeAttribute(attribute.name);
    }

    if (tagName === "a") {
      const href = safeContentUrl(element.getAttribute("href"));
      if (href) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } else {
        element.removeAttribute("href");
      }
    }

    if (tagName === "img") {
      const src = safeContentUrl(element.getAttribute("src"), { image: true });
      if (!src) {
        element.remove();
        continue;
      }
      element.setAttribute("src", src);
      element.setAttribute("loading", "lazy");
      element.setAttribute("decoding", "async");
    }
  }

  return documentNode.body.innerHTML;
}

function applyHighlightsToHtml(html, highlights) {
  if (!highlights.length) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || "";
    const matches = [];
    for (const highlight of highlights) {
      const start = text.indexOf(highlight);
      if (start >= 0) matches.push({ start, end: start + highlight.length });
    }
    matches.sort((a, b) => a.start - b.start);
    const nonOverlapping = matches.filter((match, index, all) => (
      index === 0 || match.start >= all[index - 1].end
    ));
    if (!nonOverlapping.length) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of nonOverlapping) {
      fragment.append(document.createTextNode(text.slice(cursor, match.start)));
      const mark = document.createElement("mark");
      mark.className = "highlighted-text";
      mark.textContent = text.slice(match.start, match.end);
      fragment.append(mark);
      cursor = match.end;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }

  return template.innerHTML;
}

function renderHighlightedContent(book, section, sectionIndex) {
  const content = String(section.content || "");
  const highlights = highlightsFor(book.slug, sectionIndex)
    .map((item) => item.text)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (isHtmlContent(content)) {
    return applyHighlightsToHtml(sanitizeBookHtml(content), highlights);
  }
  if (!highlights.length) return escapeHtml(content);

  const ranges = [];
  for (const text of highlights) {
    const start = content.indexOf(text);
    if (start < 0) continue;
    const end = start + text.length;
    if (ranges.some((range) => start < range.end && end > range.start)) continue;
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (!ranges.length) return escapeHtml(content);

  let cursor = 0;
  let html = "";
  for (const range of ranges) {
    html += escapeHtml(content.slice(cursor, range.start));
    html += `<mark class="highlighted-text">${escapeHtml(content.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  html += escapeHtml(content.slice(cursor));
  return html;
}

function initials(title) {
  return String(title || "FA")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function progressFor(slug, sectionCount = 0) {
  const record = state.progress[slug];
  if (!record || !sectionCount) return 0;
  return Math.min(100, Math.max(0, Math.round(((record.sectionIndex + 1) / sectionCount) * 100)));
}

function hasStarted(slug) {
  return Boolean(state.progress[slug]);
}

function activeSectionIndex(book) {
  const saved = state.progress[book.slug]?.sectionIndex ?? 0;
  return Math.min(Math.max(saved, 0), Math.max(book.sections.length - 1, 0));
}

function saveProgress(slug, sectionIndex, sectionCount) {
  state.progress[slug] = {
    sectionIndex,
    sectionCount,
    percent: Math.min(100, Math.round(((sectionIndex + 1) / sectionCount) * 100)),
    updatedAt: new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.progress, state.progress);
  updateStats();
}

function rememberReadingItem(book) {
  state.readingItems.set(book.slug, {
    slug: book.slug,
    title: book.title,
    original_author: book.original_author,
    cover_url: book.cover_url || "",
    reading_time_minutes: book.reading_time_minutes,
    status: book.status,
    categories: book.categories || [],
    section_count: book.section_count || book.sections?.length || 0,
  });
  writeStorage(STORAGE_KEYS.readingItems, Object.fromEntries(state.readingItems));
}

function toggleBookmark(slug) {
  if (state.bookmarks.has(slug)) {
    state.bookmarks.delete(slug);
  } else {
    state.bookmarks.add(slug);
    const book = state.libraryItems.find((item) => item.slug === slug) || state.currentBook;
    if (book) state.bookmarkItems.set(slug, book);
  }
  writeStorage(STORAGE_KEYS.bookmarks, Array.from(state.bookmarks));
  renderBookLists();
  renderBookmarks();
  updateStats();
  if (state.currentBook?.slug === slug) renderReader(state.currentBook);
}

function createHighlightFromSelection(book) {
  const selection = window.getSelection();
  const text = selection?.toString().replace(/\s+/g, " ").trim();
  const button = elements.reader.querySelector("[data-create-highlight]");
  if (!text || !selection?.rangeCount) {
    if (button) {
      button.textContent = "Blok teks dulu";
      setTimeout(() => { button.textContent = "Highlight"; }, 1200);
    }
    return;
  }

  const range = selection.getRangeAt(0);
  const sectionElement = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement?.closest("[data-reader-section]")
    : range.commonAncestorContainer.closest?.("[data-reader-section]");
  if (!sectionElement || !elements.reader.contains(sectionElement)) {
    if (button) {
      button.textContent = "Pilih teks di reader";
      setTimeout(() => { button.textContent = "Highlight"; }, 1200);
    }
    return;
  }

  const sectionIndex = Number(sectionElement.dataset.readerSection);
  const section = book.sections[sectionIndex];
  const normalizedContent = sectionElement.textContent.replace(/\s+/g, " ").trim();
  if (!normalizedContent.includes(text)) {
    if (button) {
      button.textContent = "Teks terlalu panjang";
      setTimeout(() => { button.textContent = "Highlight"; }, 1200);
    }
    return;
  }

  const item = {
    id: `${book.slug}-${Date.now()}`,
    slug: book.slug,
    title: book.title,
    original_author: book.original_author || "",
    sectionIndex,
    sectionTitle: section.title,
    text,
    createdAt: new Date().toISOString(),
  };
  state.highlights.push(item);
  writeStorage(STORAGE_KEYS.highlights, state.highlights);
  selection.removeAllRanges();
  renderReader(book);
  renderHighlights();
  setSavedTab("highlights");
  setView("bookmarks");
}

function updateStats() {
  elements.savedCount.textContent = formatNumber.format(state.bookmarks.size);
  elements.readingCount.textContent = formatNumber.format(Object.keys(state.progress).length);
}

function setSavedTab(tab) {
  state.activeSavedTab = tab;
  document.querySelectorAll("[data-saved-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.savedTab === tab);
  });
  elements.bookmarkList.classList.toggle("is-hidden", tab !== "bookmarks");
  elements.highlightList.classList.toggle("is-hidden", tab !== "highlights");
  if (tab === "bookmarks") renderBookmarks();
  if (tab === "highlights") renderHighlights();
}

function setView(view) {
  state.activeView = view;
  Object.entries(elements.views).forEach(([key, element]) => {
    element.classList.toggle("active-view", key === view);
  });
  const navView = view === "knowledgeDetail" ? "knowledge"
    : view === "insightDetail" ? "insight"
      : view === "reader" ? "books" : view;
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === navView);
  });
  elements.searchInput.placeholder = navView === "knowledge"
    ? "Cari knowledge, kategori, poin, atau notes…"
    : navView === "insight" ? "Cari insight atau gagasan…"
      : "Cari buku, penulis, atau topik…";
  if (view === "knowledge" && !state.knowledgeItems.length) loadKnowledge();
  if (view === "insight" && !state.insightItems.length) loadInsights();
  if (view === "bookmarks") renderBookmarks();
  if (view === "bookmarks") setSavedTab(state.activeSavedTab);
}

async function loadMeta() {
  const meta = await getJson("/api/meta");
  elements.totalBooks.textContent = formatNumber.format(meta.total);
  for (const category of meta.categories) {
    const option = document.createElement("option");
    option.value = category.slug;
    option.textContent = `${category.name} (${formatNumber.format(category.book_count)})`;
    elements.categoryFilter.append(option);
  }
  updateStats();
}

async function loadBooks({ reset = state.page === 1 } = {}) {
  if (state.booksLoading) return;
  state.booksLoading = true;
  elements.bookLoadStatus.textContent = reset ? "Memuat buku…" : "Memuat buku berikutnya…";

  const params = new URLSearchParams({
    q: elements.searchInput.value.trim(),
    category: elements.categoryFilter.value,
    sort: elements.sortFilter.value,
    page: state.page,
    pageSize: 18,
  });

  try {
    const payload = await getJson(`/api/books?${params}`);
    state.libraryItems = reset
      ? payload.items
      : [...state.libraryItems, ...payload.items];
    for (const item of payload.items) {
      if (state.bookmarks.has(item.slug)) state.bookmarkItems.set(item.slug, item);
      if (state.progress[item.slug]) state.readingItems.set(item.slug, item);
    }
    state.totalPages = payload.totalPages;
    state.booksHasMore = payload.page < payload.totalPages;
    elements.resultMeta.textContent = `${formatNumber.format(payload.total)} hasil`;
    elements.bookLoadStatus.textContent = state.booksHasMore
      ? `${formatNumber.format(state.libraryItems.length)} buku dimuat · scroll untuk lanjut`
      : `Semua ${formatNumber.format(payload.total)} buku sudah dimuat`;
    elements.bookSentinel.classList.toggle("is-hidden", !state.booksHasMore);
    renderBookLists();
    renderContinuePanel();
    renderHome();
  } catch (error) {
    if (!reset) state.page = Math.max(1, state.page - 1);
    elements.bookLoadStatus.textContent = `Gagal memuat buku: ${error.message}`;
  } finally {
    state.booksLoading = false;
  }
}

async function loadKnowledge({ reset = state.knowledgePage === 1 } = {}) {
  if (state.knowledgeLoading) return;
  state.knowledgeLoading = true;
  elements.knowledgeLoadStatus.textContent = reset
    ? "Memuat knowledge…"
    : "Memuat knowledge berikutnya…";

  const params = new URLSearchParams({
    q: elements.searchInput.value.trim(),
    page: state.knowledgePage,
    pageSize: 18,
  });

  try {
    const payload = await getJson(`/api/topics?${params}`);
    state.knowledgeItems = reset
      ? payload.items
      : [...state.knowledgeItems, ...payload.items];
    state.knowledgeTotalPages = payload.totalPages;
    state.knowledgeHasMore = payload.page < payload.totalPages;
    elements.knowledgeMeta.textContent = `${formatNumber.format(payload.total)} knowledge tersedia`;
    elements.knowledgeLoadStatus.textContent = state.knowledgeHasMore
      ? `${formatNumber.format(state.knowledgeItems.length)} knowledge dimuat · scroll untuk lanjut`
      : `Semua ${formatNumber.format(payload.total)} knowledge sudah dimuat`;
    elements.knowledgeSentinel.classList.toggle("is-hidden", !state.knowledgeHasMore);
    renderKnowledge();
  } catch (error) {
    if (!reset) state.knowledgePage = Math.max(1, state.knowledgePage - 1);
    elements.knowledgeLoadStatus.textContent = `Gagal memuat: ${error.message}`;
  } finally {
    state.knowledgeLoading = false;
  }
}

async function loadInsights() {
  elements.insightMeta.textContent = "Memuat insight…";
  try {
    const params = new URLSearchParams({ q: elements.searchInput.value.trim(), limit: 60 });
    params.set("resource", "insights");
    const payload = await getJson(`/api/topics?${params}`);
    state.insightItems = payload.items;
    elements.insightMeta.textContent = `${formatNumber.format(payload.total)} insight tersedia`;
    renderInsights();
    renderHome();
  } catch (error) {
    elements.insightMeta.textContent = `Gagal memuat insight: ${error.message}`;
  }
}

function insightCard(insight, compact = false) {
  return `
    <article class="insight-card ${compact ? "compact" : ""}">
      <div class="tag-row">${insight.status === "draft" ? tag("Draft", "draft-tag") : ""}${(insight.content_types || []).slice(0, 2).map((value) => tag(value)).join("")}</div>
      <h3>${escapeHtml(insight.title || "Tanpa judul")}</h3>
      <p>${escapeHtml(insight.thesis || "Gagasan pilihan dari FA Reader.")}</p>
      <footer><span>${insight.reading_time_minutes || 1} menit baca</span><button type="button" class="ghost-button" data-open-insight="${escapeHtml(insight.id)}">Baca</button></footer>
    </article>`;
}

function wireInsightCards(root = document) {
  root.querySelectorAll("[data-open-insight]").forEach((button) => {
    button.addEventListener("click", () => openInsightDetail(button.dataset.openInsight));
  });
}

function renderInsights() {
  if (!state.insightItems.length) {
    elements.insightList.innerHTML = `<article class="insight-card"><h3>Insight segera hadir</h3><p>Tulisan yang sudah diterbitkan dari Lexis akan muncul di sini.</p></article>`;
    return;
  }
  elements.insightList.innerHTML = state.insightItems.map((item) => insightCard(item)).join("");
  wireInsightCards(elements.insightList);
}

function markdownToHtml(markdown) {
  return escapeHtml(markdown || "")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

async function openInsightDetail(insightId) {
  setView("insightDetail");
  window.scrollTo({ top: 0, behavior: "smooth" });
  elements.insightDetail.innerHTML = `<div class="knowledge-detail-loading">Memuat insight…</div>`;
  try {
    const insight = await getJson(`/api/topics?resource=insights&id=${encodeURIComponent(insightId)}`);
    const sourceUrl = safeContentUrl(insight.canonical_url);
    elements.insightDetail.innerHTML = `
      <header class="knowledge-detail-header"><div class="tag-row">${insight.status === "draft" ? tag("Draft", "draft-tag") : ""}</div><p class="eyebrow">Insight</p><h1>${escapeHtml(insight.title)}</h1><p class="insight-thesis">${escapeHtml(insight.thesis || "")}</p></header>
      <div class="reader-body"><div class="reader-content knowledge-detail-content"><p>${markdownToHtml(insight.content_markdown)}</p></div></div>
      ${insight.attribution ? `<footer class="insight-attribution"><strong>Sumber inspirasi</strong><p>${escapeHtml(insight.attribution)}</p>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Baca sumber asli →</a>` : ""}</footer>` : ""}`;
  } catch (error) {
    elements.insightDetail.innerHTML = `<div class="empty-state"><h2>Insight gagal dimuat</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderKnowledge() {
  if (!state.knowledgeItems.length) {
    elements.knowledgeList.innerHTML = `
      <article class="knowledge-card">
        <h3>Knowledge tidak ditemukan</h3>
        <p>Coba kata kunci lain.</p>
      </article>
    `;
    return;
  }

  elements.knowledgeList.innerHTML = state.knowledgeItems.map((topic) => `
    <article class="knowledge-card">
      <div class="tag-row">
        ${(topic.categories || []).slice(0, 4).map((value) => tag(value)).join("")}
      </div>
      <h3>${escapeHtml(topic.title || "Tanpa judul")}</h3>
      <ul>
        ${(topic.points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
      </ul>
      ${topic.has_note ? `
        <div class="knowledge-card-actions">
          <button type="button" class="primary-button" data-open-topic="${escapeHtml(topic.id)}">Baca Detail</button>
        </div>
      ` : ""}
    </article>
  `).join("");

  elements.knowledgeList.querySelectorAll("[data-open-topic]").forEach((button) => {
    button.addEventListener("click", () => openKnowledgeDetail(button.dataset.openTopic));
  });
}

async function openKnowledgeDetail(topicId) {
  setView("knowledgeDetail");
  window.scrollTo({ top: 0, behavior: "smooth" });
  elements.knowledgeDetail.innerHTML = `
    <div class="knowledge-detail-loading" role="status">Memuat detail knowledge…</div>
  `;
  try {
    const topic = await getJson(`/api/topics?id=${encodeURIComponent(topicId)}`);
    elements.knowledgeDetail.innerHTML = `
      <header class="knowledge-detail-header">
        <div class="tag-row">${(topic.categories || []).slice(0, 6).map((value) => tag(value)).join("")}</div>
        <p class="eyebrow">Knowledge</p>
        <h1>${escapeHtml(topic.title || "Tanpa judul")}</h1>
        ${(topic.points || []).length ? `
          <ul class="knowledge-detail-points">
            ${topic.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
        ` : ""}
      </header>
      <div class="reader-body">
        <div class="reader-content knowledge-detail-content">${sanitizeBookHtml(topic.content)}</div>
      </div>
    `;
  } catch (error) {
    elements.knowledgeDetail.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">!</span>
        <h2>Detail knowledge gagal dimuat</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

function coverContent(book) {
  const coverUrl = safeContentUrl(book.cover_url, { image: true });
  return `
    <span class="cover-fallback" aria-hidden="true">${escapeHtml(initials(book.title))}</span>
    ${coverUrl ? `
      <img class="cover-image" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async">
    ` : ""}
  `;
}

function wireCoverImages(root = document) {
  root.querySelectorAll(".cover-image").forEach((image) => {
    const hideBrokenImage = () => image.remove();
    image.addEventListener("error", hideBrokenImage, { once: true });
    if (image.complete && image.naturalWidth === 0) hideBrokenImage();
  });
}

function bookCard(book) {
  const percent = progressFor(book.slug, book.section_count || book.sections?.length || 0);
  const saved = state.bookmarks.has(book.slug);
  return `
    <article class="book-card ${book.slug === state.selectedSlug ? "active" : ""}">
      <div class="book-card-top">
        <button type="button" class="cover" data-open="${escapeHtml(book.slug)}" aria-label="Buka ${escapeHtml(book.title)}">
          ${coverContent(book)}
        </button>
        <button type="button" class="bookmark-button ${saved ? "saved" : ""}" data-bookmark="${escapeHtml(book.slug)}" aria-label="${saved ? "Hapus bookmark" : "Simpan bookmark"}">
        </button>
      </div>
      <div>
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.original_author || "Penulis belum terdeteksi")} · ${book.reading_time_minutes} menit</p>
      </div>
      <div class="tag-row">
        ${(book.categories || []).slice(0, 2).map((value) => tag(value)).join("")}

      </div>
      <div class="card-footer">
        <span class="popularity-meta">
          ${formatNumber.format(book.unique_readers_30d || 0)} pembaca ·
          ${formatNumber.format(book.total_opens_30d || 0)} dibuka
        </span>
        ${progressRing(percent)}
      </div>
      <button type="button" class="primary-button" data-open="${escapeHtml(book.slug)}">
        ${hasStarted(book.slug) ? "Lanjutkan" : "Mulai baca"}
      </button>
    </article>
  `;
}

function wireBookCards(root = document) {
  wireCoverImages(root);
  root.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => selectBook(button.dataset.open));
  });
  root.querySelectorAll("[data-bookmark]").forEach((button) => {
    button.addEventListener("click", () => toggleBookmark(button.dataset.bookmark));
  });
}

function renderHome() {
  if (!elements.homeShelves) return;
  const books = state.libraryItems.slice(0, 10);
  const knowledge = state.knowledgeItems.slice(0, 5);
  const insights = state.insightItems.slice(0, 10);
  const shelf = (title, view, body) => `
    <section class="content-shelf">
      <header><div><p class="eyebrow">Jelajahi</p><h2>${title}</h2></div><button type="button" class="shelf-link" data-view="${view}">Lihat semua</button></header>
      ${body}
    </section>`;
  elements.homeShelves.innerHTML = [
    shelf("Buku pilihan", "books", `<div class="horizontal-rail">${books.map(bookCard).join("")}</div>`),
    shelf("Knowledge terbaru", "knowledge", `<div class="home-knowledge-list">${knowledge.map((topic) => `<button type="button" class="home-knowledge-item" data-open-topic="${escapeHtml(topic.id)}"><span>${escapeHtml(topic.title || "Tanpa judul")}</span><small>${(topic.points || []).length} poin penting</small></button>`).join("") || "<p>Memuat knowledge…</p>"}</div>`),
    shelf("Insight terbaru", "insight", `<div class="horizontal-rail insight-rail">${insights.map((item) => insightCard(item, true)).join("") || "<p>Insight yang diterbitkan akan tampil di sini.</p>"}</div>`),
  ].join("");
  wireBookCards(elements.homeShelves);
  wireInsightCards(elements.homeShelves);
  elements.homeShelves.querySelectorAll("[data-open-topic]").forEach((button) => button.addEventListener("click", () => openKnowledgeDetail(button.dataset.openTopic)));
  elements.homeShelves.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
}

function renderBookLists() {
  if (!state.libraryItems.length) {
    elements.bookList.innerHTML = `
      <article class="book-card">
        <h3>Belum ada buku untuk filter ini</h3>
        <p>Coba kata kunci atau kategori lain.</p>
      </article>
    `;
    return;
  }
  elements.bookList.innerHTML = state.libraryItems.map(bookCard).join("");
  wireBookCards(elements.bookList);
}

function renderBookmarks() {
  const books = Array.from(state.bookmarks)
    .map((slug) => state.bookmarkItems.get(slug) || state.libraryItems.find((item) => item.slug === slug))
    .filter(Boolean);

  if (!books.length) {
    elements.bookmarkList.innerHTML = `
      <article class="book-card">
        <h3>Belum ada bookmark</h3>
        <p>Simpan buku dari katalog atau reader untuk masuk ke daftar ini.</p>
      </article>
    `;
    return;
  }
  elements.bookmarkList.innerHTML = books.map(bookCard).join("");
  wireBookCards(elements.bookmarkList);
}

function renderHighlights() {
  if (!state.highlights.length) {
    elements.highlightList.innerHTML = `
      <div class="highlight-empty">
        Belum ada highlight. Buka reader, blok teks yang penting, lalu tekan tombol Highlight.
      </div>
    `;
    return;
  }

  elements.highlightList.innerHTML = state.highlights
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => `
      <article class="highlight-card">
        <blockquote>“${escapeHtml(item.text)}”</blockquote>
        <footer>
          <span>${escapeHtml(item.title)} · ${escapeHtml(item.sectionTitle || `Bagian ${item.sectionIndex + 1}`)}</span>
          <button type="button" class="ghost-button" data-open-highlight="${escapeHtml(item.slug)}" data-section-index="${item.sectionIndex}">Buka</button>
        </footer>
      </article>
    `).join("");

  elements.highlightList.querySelectorAll("[data-open-highlight]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slug = button.dataset.openHighlight;
      const sectionIndex = Number(button.dataset.sectionIndex || 0);
      if (!state.progress[slug]) state.progress[slug] = { sectionIndex, sectionCount: sectionIndex + 1, percent: 0, updatedAt: new Date().toISOString() };
      state.progress[slug].sectionIndex = sectionIndex;
      writeStorage(STORAGE_KEYS.progress, state.progress);
      await selectBook(slug);
    });
  });
}

function renderContinuePanel() {
  const candidates = Array.from(state.readingItems.values())
    .filter((book) => state.progress[book.slug])
    .sort((a, b) => new Date(state.progress[b.slug].updatedAt) - new Date(state.progress[a.slug].updatedAt));
  if (!candidates.length) {
    elements.continuePanel.classList.add("is-hidden");
    elements.continuePanel.innerHTML = "";
    return;
  }
  elements.continuePanel.classList.remove("is-hidden");
  elements.continuePanel.innerHTML = `
    <h2>Lanjutkan Membaca</h2>
    <div class="continue-list">
      ${candidates.map((book) => {
        const percent = progressFor(book.slug, book.section_count);
        return `
          <article class="continue-card">
            <button type="button" class="cover" data-open="${escapeHtml(book.slug)}" aria-label="Buka ${escapeHtml(book.title)}">${coverContent(book)}</button>
            <div>
              <h3>${escapeHtml(book.title)}</h3>
              <p>${escapeHtml(book.original_author || "Penulis belum terdeteksi")} · progress ${percent}%</p>
              <div class="progress-track"><span class="progress-bar" style="width:${percent}%"></span></div>
            </div>
            <button type="button" class="primary-button" data-open="${escapeHtml(book.slug)}">Lanjutkan</button>
          </article>
        `;
      }).join("")}
    </div>
  `;
  wireBookCards(elements.continuePanel);
}

async function selectBook(slug) {
  state.selectedSlug = slug;
  const book = await getJson(`/api/books/${encodeURIComponent(slug)}`);
  state.currentBook = book;
  trackBookEvent("book_opened", slug);
  rememberReadingItem(book);
  if (state.bookmarks.has(slug)) state.bookmarkItems.set(slug, book);
  if (!state.progress[slug] && book.sections.length) {
    saveProgress(slug, 0, book.sections.length);
  }
  renderReader(book);
  setView("reader");
}

function renderReader(book) {
  const index = activeSectionIndex(book);
  const percent = progressFor(book.slug, book.sections.length);
  const saved = state.bookmarks.has(book.slug);
  elements.reader.innerHTML = `

    <div class="reader-shell">
      <aside class="toc">
        <strong>Daftar isi</strong>
        ${book.sections.map((section, sectionIndex) => `
          <button type="button" class="${sectionIndex === index ? "active" : ""}" data-section="${sectionIndex}">
            ${sectionIndex + 1}. ${escapeHtml(section.title)}
          </button>
        `).join("")}
      </aside>
      <article class="reader-article">
        <header class="reader-header">
          <div class="tag-row">${book.categories.map((value) => tag(value)).join("")}</div>
          <h2>${escapeHtml(book.title)}</h2>
          <div class="reader-meta">
            ${escapeHtml(book.original_author || "Penulis belum terdeteksi")}
            · ${formatNumber.format(book.word_count)} kata
            · ${book.reading_time_minutes} menit baca
          </div>
          <p>${escapeHtml(book.description || "")}</p>
          <div class="reader-inline-settings">
            <div class="font-size-control" aria-label="Ubah ukuran font">
              <button type="button" data-font-scale="-0.1" aria-label="Perkecil font">A−</button>
              <span data-font-scale-label>${Math.round(state.fontScale * 100)}%</span>
              <button type="button" data-font-scale="0.1" aria-label="Perbesar font">A+</button>
            </div>
            <div class="reader-commerce-actions">
              ${book.purchase_url ? `
                <a class="buy-original-button" href="${escapeHtml(book.purchase_url)}" target="_blank" rel="noopener noreferrer">
                  Beli buku asli
                </a>
              ` : ""}
              <button class="support-button compact-support" type="button" data-support-open>Support</button>
            </div>
          </div>
          <div class="reader-toolbar">
            ${progressRing(percent, "reader-progress-ring")}
            <button type="button" class="reader-action icon-action highlight-action" data-create-highlight aria-label="Highlight teks" title="Highlight teks"></button>
            <button type="button" class="reader-action icon-action bookmark-button ${saved ? "saved" : ""}" data-reader-bookmark="${escapeHtml(book.slug)}" aria-label="${saved ? "Hapus bookmark" : "Simpan bookmark"}" title="${saved ? "Hapus bookmark" : "Simpan bookmark"}">
            </button>
          </div>
        </header>
        <div class="reader-body">
          ${book.sections.map((section, sectionIndex) => `
            <section class="reader-section ${sectionIndex === index ? "active" : ""}" data-reader-section="${sectionIndex}">
              <p class="eyebrow">Bagian ${sectionIndex + 1} dari ${book.sections.length}</p>
              <h3>${escapeHtml(section.title)}</h3>
              <div class="reader-content">${renderHighlightedContent(book, section, sectionIndex)}</div>
            </section>
          `).join("")}
        </div>
      </article>
    </div>
  `;

  elements.reader.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => setReaderSection(book, Number(button.dataset.section)));
  });
  elements.reader.querySelector("[data-reader-bookmark]")?.addEventListener("click", () => {
    toggleBookmark(book.slug);
  });
  elements.reader.querySelector("[data-create-highlight]")?.addEventListener("click", () => {
    createHighlightFromSelection(book);
  });
  elements.reader.querySelectorAll("[data-font-scale]").forEach((button) => {
    button.addEventListener("click", () => changeFontScale(Number(button.dataset.fontScale)));
  });
  applyFontScale();
  setupReaderScrollTracking(book);
  requestAnimationFrame(() => {
    const target = elements.reader.querySelector(`[data-reader-section="${index}"]`);
    if (target) target.scrollIntoView({ block: "start" });
  });
}

function setReaderSection(book, index) {
  const nextIndex = Math.min(Math.max(index, 0), book.sections.length - 1);
  saveProgress(book.slug, nextIndex, book.sections.length);
  updateReaderProgressUI(book, nextIndex);
  const target = elements.reader.querySelector(`[data-reader-section="${nextIndex}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  renderBookLists();
  renderContinuePanel();
  renderHome();
}

function updateReaderProgressUI(book, sectionIndex) {
  const percent = Math.min(100, Math.round(((sectionIndex + 1) / book.sections.length) * 100));
  const ring = elements.reader.querySelector(".reader-toolbar .progress-ring");
  if (ring) {
    ring.style.setProperty("--progress-angle", `${percent * 3.6}deg`);
    ring.setAttribute("aria-label", `Progress ${percent}%`);
    const label = ring.querySelector("span");
    if (label) label.textContent = `${percent}%`;
  }
  elements.reader.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.section) === sectionIndex);
  });
  elements.reader.querySelectorAll("[data-reader-section]").forEach((section) => {
    section.classList.toggle("active", Number(section.dataset.readerSection) === sectionIndex);
  });
}

function progressRing(percent, extraClass = "") {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <span class="progress-ring ${extraClass}" style="--progress-angle:${value * 3.6}deg" aria-label="Progress ${value}%">
      <span>${value}%</span>
    </span>
  `;
}

function setupReaderScrollTracking(book) {
  if (state.readerScrollCleanup) state.readerScrollCleanup();
  const sections = Array.from(elements.reader.querySelectorAll("[data-reader-section]"));
  if (!sections.length) return;
  let ticking = false;
  const syncActiveSection = () => {
    ticking = false;
    const anchor = Math.max(120, window.innerHeight * 0.28);
    let activeIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.bottom < 120) continue;
      const distance = Math.abs(rect.top - anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        activeIndex = Number(section.dataset.readerSection);
      }
    }
    const lastSection = sections[sections.length - 1];
    if (lastSection.getBoundingClientRect().bottom <= window.innerHeight * 0.95) {
      trackBookCompletion(book.slug);
    }
    const currentIndex = state.progress[book.slug]?.sectionIndex ?? 0;
    if (activeIndex !== currentIndex) {
      saveProgress(book.slug, activeIndex, book.sections.length);
      updateReaderProgressUI(book, activeIndex);
      renderBookLists();
      renderContinuePanel();
    }
  };
  const onScroll = () => {
    if (!state.currentBook || state.currentBook.slug !== book.slug) {
      window.removeEventListener("scroll", onScroll);
      return;
    }
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(syncActiveSection);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  requestAnimationFrame(syncActiveSection);
  state.readerScrollCleanup = () => {
    window.removeEventListener("scroll", onScroll);
    state.readerScrollCleanup = null;
  };
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.activeView.startsWith("knowledge")) {
    state.knowledgePage = 1;
    loadKnowledge();
  } else if (state.activeView.startsWith("insight")) {
    loadInsights();
  } else {
    state.page = 1;
    loadBooks();
    setView("books");
  }
});

elements.searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    if (state.activeView.startsWith("knowledge")) {
      state.knowledgePage = 1;
      loadKnowledge();
    } else if (state.activeView.startsWith("insight")) {
      loadInsights();
    } else {
      state.page = 1;
      loadBooks();
    }
  }, 300);
});

elements.categoryFilter.addEventListener("change", () => {
  state.page = 1;
  loadBooks();
});

elements.sortFilter.addEventListener("change", () => {
  state.page = 1;
  loadBooks();
});

function setupInfiniteScroll() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (
        entry.target === elements.bookSentinel
        && state.activeView === "books"
        && state.booksHasMore
        && !state.booksLoading
      ) {
        state.page += 1;
        loadBooks({ reset: false });
      }
      if (
        entry.target === elements.knowledgeSentinel
        && state.activeView.startsWith("knowledge")
        && state.knowledgeHasMore
        && !state.knowledgeLoading
      ) {
        state.knowledgePage += 1;
        loadKnowledge({ reset: false });
      }
    }
  }, { rootMargin: "500px 0px" });

  observer.observe(elements.bookSentinel);
  observer.observe(elements.knowledgeSentinel);
}

elements.knowledgeBackButton?.addEventListener("click", () => {
  setView("knowledge");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

elements.insightBackButton?.addEventListener("click", () => {
  setView("insight");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.querySelectorAll("[data-view]").forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    setView(item.dataset.view);
  });
});

function openSupportModal() {
  elements.supportModal?.classList.remove("is-hidden");
  document.body.classList.add("modal-open");
}

function closeSupportModal() {
  elements.supportModal?.classList.add("is-hidden");
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-support-open], [data-support-close]");
  if (!target) return;
  if (target.matches("[data-support-open]")) openSupportModal();
  if (target.matches("[data-support-close]")) closeSupportModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSupportModal();
});

document.querySelectorAll("[data-saved-tab]").forEach((button) => {
  button.addEventListener("click", () => setSavedTab(button.dataset.savedTab));
});

try {
  applyFontScale();
  await loadMeta();
  await loadBooks();
  await loadKnowledge();
  await loadInsights();
  setupInfiniteScroll();
  updateStats();
} catch (error) {
  elements.reader.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">!</span>
      <h2>Gagal memuat data</h2>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
}
