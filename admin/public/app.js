const state = {
  page: 1,
  totalPages: 1,
  selectedSlug: null,
  selectedDecision: "pending",
  searchTimer: null,
};

const elements = {
  stats: document.querySelector("#stats"),
  search: document.querySelector("#searchInput"),
  status: document.querySelector("#statusFilter"),
  decision: document.querySelector("#decisionFilter"),
  list: document.querySelector("#bookList"),
  resultCount: document.querySelector("#resultCount"),
  pageLabel: document.querySelector("#pageLabel"),
  previous: document.querySelector("#previousPage"),
  next: document.querySelector("#nextPage"),
  detail: document.querySelector("#detail"),
  template: document.querySelector("#detailTemplate"),
};

const formatNumber = new Intl.NumberFormat("id-ID");

async function getJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Permintaan gagal.");
  return payload;
}

function badge(text, type = "") {
  const span = document.createElement("span");
  span.className = `badge ${type}`.trim();
  span.textContent = text;
  return span;
}

async function loadStats() {
  const stats = await getJson("/api/stats");
  const cards = [
    ["Total katalog", stats.total],
    ["Siap direview", stats.ready_for_review],
    ["Perlu pemeriksaan", stats.needs_review],
    ["Published", stats.published],
    ["Ditolak", stats.rejected],
  ];
  elements.stats.replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span>${label}</span><strong>${formatNumber.format(value)}</strong>`;
    return card;
  }));
}

async function loadBooks() {
  const params = new URLSearchParams({
    q: elements.search.value,
    status: elements.status.value,
    decision: elements.decision.value,
    page: state.page,
    pageSize: 25,
  });
  const payload = await getJson(`/api/books?${params}`);
  state.totalPages = payload.totalPages;
  elements.resultCount.textContent = `${formatNumber.format(payload.total)} buku`;
  elements.pageLabel.textContent = `${payload.page} / ${payload.totalPages}`;
  elements.previous.disabled = payload.page <= 1;
  elements.next.disabled = payload.page >= payload.totalPages;

  const fragment = document.createDocumentFragment();
  for (const book of payload.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `book-item ${state.selectedSlug === book.slug ? "active" : ""}`;
    button.dataset.slug = book.slug;
    const statusType = book.status === "needs_review" ? "warning" : "";
    const decisionType = book.review.decision === "approved"
      ? "approved"
      : book.review.decision === "rejected"
        ? "rejected"
        : "";
    button.innerHTML = `
      <h3>${escapeHtml(book.title)}</h3>
      <p>${escapeHtml(book.original_author || "Penulis belum terdeteksi")}</p>
      <div class="book-meta">
        <span class="badge ${statusType}">${book.status === "needs_review" ? "Periksa" : book.status}</span>
        <span class="badge ${decisionType}">${book.review.decision}</span>
        <span class="badge">${book.section_count} bagian</span>
      </div>
    `;
    button.addEventListener("click", () => selectBook(book.slug));
    fragment.append(button);
  }
  elements.list.replaceChildren(fragment);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function selectBook(slug) {
  state.selectedSlug = slug;
  await loadBooks();
  const book = await getJson(`/api/books/${encodeURIComponent(slug)}`);
  renderDetail(book);
}

function renderDetail(book) {
  const content = elements.template.content.cloneNode(true);
  const find = (role) => content.querySelector(`[data-role="${role}"]`);
  const statuses = find("statuses");
  statuses.append(
    badge(
      book.status === "needs_review" ? "Perlu pemeriksaan" : book.status,
      book.status === "needs_review" ? "warning" : "",
    ),
    badge(
      book.review.decision,
      book.review.decision === "approved"
        ? "approved"
        : book.review.decision === "rejected"
          ? "rejected"
          : "",
    ),
  );
  find("title").textContent = book.title;
  find("author").textContent = book.original_author || "Penulis belum terdeteksi";
  find("source").href = book.source_url;
  find("description").textContent = book.description;

  const metadata = [
    ["Halaman", book.page_count],
    ["Jumlah kata", formatNumber.format(book.word_count)],
    ["Durasi baca", `${book.reading_time_minutes} menit`],
    ["Bagian", book.sections.length],
  ];
  find("metadata").replaceChildren(...metadata.map(([label, value]) => {
    const item = document.createElement("div");
    item.className = "metadata-item";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return item;
  }));
  find("categories").replaceChildren(...book.categories.map((value) => badge(value)));

  const issues = find("issues");
  if (!book.quality.issues.length) {
    issues.innerHTML = `<p class="no-issues">Tidak ada issue pemblokir dari pipeline.</p>`;
  } else {
    issues.replaceChildren(...book.quality.issues.map((issue) => {
      const item = document.createElement("div");
      item.className = `issue ${issue.severity}`;
      item.innerHTML = `<strong>${escapeHtml(issue.code)}</strong><br>${escapeHtml(issue.message)}`;
      return item;
    }));
  }

  state.selectedDecision = book.review.decision;
  const decisionButtons = content.querySelectorAll("[data-decision]");
  decisionButtons.forEach((button) => {
    button.classList.toggle("selected", button.dataset.decision === state.selectedDecision);
    button.addEventListener("click", () => {
      state.selectedDecision = button.dataset.decision;
      decisionButtons.forEach((item) => item.classList.toggle(
        "selected",
        item.dataset.decision === state.selectedDecision,
      ));
    });
  });

  const notes = find("notes");
  notes.value = book.review.notes;
  const rightsVerified = find("rightsVerified");
  const rightsNotes = find("rightsNotes");
  rightsVerified.checked = Boolean(book.rights_verified);
  rightsNotes.value = book.rights_notes || "";
  const saveStatus = find("saveStatus");
  find("save").addEventListener("click", async () => {
    saveStatus.textContent = "Menyimpan…";
    try {
      await getJson(`/api/books/${encodeURIComponent(book.slug)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: state.selectedDecision,
          notes: notes.value,
          rights_verified: rightsVerified.checked,
          rights_notes: rightsNotes.value,
        }),
      });
      saveStatus.textContent = "Tersimpan";
      await Promise.all([loadStats(), loadBooks()]);
    } catch (error) {
      saveStatus.textContent = error.message;
    }
  });

  find("sectionCount").textContent = `${book.sections.length} bagian`;
  find("sections").replaceChildren(...book.sections.map((section, index) => {
    const details = document.createElement("details");
    details.className = "section-card";
    if (index === 0) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${index + 1}. ${section.title} · ${formatNumber.format(section.word_count)} kata`;
    const paragraph = document.createElement("p");
    paragraph.textContent = section.content;
    details.append(summary, paragraph);
    return details;
  }));

  elements.detail.replaceChildren(content);
}

elements.search.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.page = 1;
    loadBooks();
  }, 250);
});
elements.status.addEventListener("change", () => {
  state.page = 1;
  loadBooks();
});
elements.decision.addEventListener("change", () => {
  state.page = 1;
  loadBooks();
});
elements.previous.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  loadBooks();
});
elements.next.addEventListener("click", () => {
  state.page = Math.min(state.totalPages, state.page + 1);
  loadBooks();
});

await Promise.all([loadStats(), loadBooks()]);
