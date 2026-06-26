const state = {
  page: 1,
  totalPages: 1,
  selectedSlug: null,
  selectedDecision: "pending",
  searchTimer: null,
};

const apiBase = window.FA_ADMIN_API_BASE
  || (location.port === "4175" ? "/api" : "/api/admin");

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
  const headers = new Headers(options?.headers || {});
  const storedPassword = sessionStorage.getItem("fa-reader-admin-password");
  if (storedPassword) headers.set("X-Admin-Password", storedPassword);
  const response = await fetch(`${apiBase}${url}`, { ...options, headers });
  const payload = await response.json();
  if (response.status === 401 && payload.code === "ADMIN_PASSWORD_REQUIRED") {
    const password = prompt("Masukkan password admin");
    if (!password) throw new Error("Password admin diperlukan.");
    sessionStorage.setItem("fa-reader-admin-password", password);
    return getJson(url, options);
  }
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
  const stats = await getJson("/stats");
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
  const payload = await getJson(`/books?${params}`);
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
  const book = await getJson(`/books/${encodeURIComponent(slug)}`);
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

  const bookTitleInput = find("bookTitleInput");
  const bookAuthorInput = find("bookAuthorInput");
  const bookPageCountInput = find("bookPageCountInput");
  const bookPurchaseUrlInput = find("bookPurchaseUrlInput");
  const bookDescriptionInput = find("bookDescriptionInput");
  const metadataSaveStatus = find("metadataSaveStatus");
  bookTitleInput.value = book.title || "";
  bookAuthorInput.value = book.original_author || "";
  bookPageCountInput.value = book.page_count || 0;
  bookPurchaseUrlInput.value = book.purchase_url || "";
  bookDescriptionInput.value = book.description || "";
  find("saveMetadata").addEventListener("click", async () => {
    metadataSaveStatus.textContent = "Menyimpan…";
    try {
      const updated = await getJson(`/books/${encodeURIComponent(book.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: bookTitleInput.value,
          original_author: bookAuthorInput.value,
          page_count: bookPageCountInput.value,
          purchase_url: bookPurchaseUrlInput.value,
          description: bookDescriptionInput.value,
        }),
      });
      metadataSaveStatus.textContent = "Tersimpan";
      await Promise.all([loadStats(), loadBooks()]);
      renderDetail(updated);
    } catch (error) {
      metadataSaveStatus.textContent = error.message;
    }
  });

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
      await getJson(`/books/${encodeURIComponent(book.slug)}/review`, {
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
  const newSectionForm = find("newSectionForm");
  const newSectionStatus = find("newSectionStatus");
  newSectionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    newSectionStatus.textContent = "Menambahkan…";
    const formData = new FormData(newSectionForm);
    try {
      const updated = await getJson(`/books/${encodeURIComponent(book.slug)}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sectionPayloadFromForm(formData)),
      });
      newSectionStatus.textContent = "Bagian ditambahkan";
      await Promise.all([loadStats(), loadBooks()]);
      renderDetail(updated);
    } catch (error) {
      newSectionStatus.textContent = error.message;
    }
  });
  find("sections").replaceChildren(...book.sections.map((section, index) => (
    createSectionEditor(section, index, book.slug)
  )));

  elements.detail.replaceChildren(content);
}

function sectionPayloadFromForm(formData) {
  const orderIndex = formData.get("order_index");
  return {
    order_index: orderIndex === "" ? undefined : Number(orderIndex),
    title: formData.get("title"),
    heading_label: formData.get("heading_label"),
    content: formData.get("content"),
  };
}

function createSectionEditor(section, index, slug) {
  const form = document.createElement("form");
  form.className = "section-editor";
  form.innerHTML = `
    <div class="section-editor-header">
      <strong>${index + 1}. ${escapeHtml(section.title)}</strong>
      <span>${formatNumber.format(section.word_count)} kata</span>
    </div>
    <div class="section-form-grid">
      <label>
        Urutan
        <input name="order_index" type="number" min="0" value="${Number(section.order_index)}">
      </label>
      <label>
        Judul
        <input name="title" type="text" value="${escapeHtml(section.title)}">
      </label>
      <label>
        Label heading
        <input name="heading_label" type="text" value="${escapeHtml(section.heading_label || "")}">
      </label>
    </div>
    <label>
      Isi bagian
      <textarea name="content" rows="10">${escapeHtml(section.content)}</textarea>
    </label>
    <div class="save-row">
      <span data-role="sectionStatus"></span>
      <button type="submit" class="primary-button">Simpan bagian</button>
    </div>
  `;
  const status = form.querySelector('[data-role="sectionStatus"]');
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Menyimpan…";
    try {
      const formData = new FormData(form);
      await getJson(`/sections/${encodeURIComponent(section.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sectionPayloadFromForm(formData)),
      });
      status.textContent = "Tersimpan";
      const updated = await getJson(`/books/${encodeURIComponent(slug)}`);
      await Promise.all([loadStats(), loadBooks()]);
      renderDetail(updated);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  return form;
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
