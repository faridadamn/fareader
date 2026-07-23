const state = {
  resource: "books",
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
  bookFilters: document.querySelector("#bookFilters"),
  loginWall: document.querySelector("#loginWall"),
  loginForm: document.querySelector("#loginForm"),
  passwordInput: document.querySelector("#adminPasswordInput"),
  loginError: document.querySelector("#loginError"),
  loginButton: document.querySelector("#loginButton"),
  togglePassword: document.querySelector("#togglePassword"),
  logoutButton: document.querySelector("#logoutButton"),
  adminTopbar: document.querySelector("#adminTopbar"),
  adminMain: document.querySelector("#adminMain"),
};

const formatNumber = new Intl.NumberFormat("id-ID");

async function getJson(url, options) {
  const headers = new Headers(options?.headers || {});
  const storedPassword = sessionStorage.getItem("fa-reader-admin-password");
  if (storedPassword) headers.set("X-Admin-Password", storedPassword);
  const response = await fetch(`${apiBase}${url}`, { ...options, headers });
  const payload = await response.json();
  if (response.status === 401 && payload.code === "ADMIN_PASSWORD_REQUIRED") {
    sessionStorage.removeItem("fa-reader-admin-password");
    showLoginWall("Sesi berakhir atau password tidak valid.");
  }
  if (!response.ok) throw new Error(payload.error || "Permintaan gagal.");
  return payload;
}

function showLoginWall(message = "") {
  elements.loginWall.classList.remove("is-hidden");
  elements.adminTopbar.classList.add("is-hidden");
  elements.adminMain.classList.add("is-hidden");
  elements.loginError.textContent = message;
  requestAnimationFrame(() => elements.passwordInput.focus());
}

function showAdmin() {
  elements.loginWall.classList.add("is-hidden");
  elements.adminTopbar.classList.remove("is-hidden");
  elements.adminMain.classList.remove("is-hidden");
  elements.loginError.textContent = "";
  elements.passwordInput.value = "";
}

async function validatePassword(password) {
  const response = await fetch(`${apiBase}/stats`, {
    headers: { "X-Admin-Password": password },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Password admin tidak valid.");
  return payload;
}

async function bootstrapAdmin() {
  const storedPassword = sessionStorage.getItem("fa-reader-admin-password");
  if (!storedPassword) {
    showLoginWall();
    return;
  }
  try {
    await validatePassword(storedPassword);
    showAdmin();
    await Promise.all([loadStats(), loadBooks()]);
  } catch {
    sessionStorage.removeItem("fa-reader-admin-password");
    showLoginWall("Silakan masuk kembali untuk melanjutkan.");
  }
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
    ["Total buku", stats.total],
    ["Knowledge", stats.knowledge],
    ["Insight", stats.insights],
    ["Draft Insight", stats.insight_draft],
    ["Insight Published", stats.insight_published],
  ];
  elements.stats.replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span>${label}</span><strong>${formatNumber.format(value)}</strong>`;
    return card;
  }));
}

async function loadBooks() {
  if (state.resource !== "books") return loadContentItems();
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

async function loadContentItems() {
  const params = new URLSearchParams({
    resource: state.resource,
    q: elements.search.value,
    page: state.page,
    pageSize: 25,
  });
  const payload = await getJson(`/books?${params}`);
  state.totalPages = payload.totalPages;
  const label = state.resource === "topics" ? "knowledge" : "insight";
  elements.resultCount.textContent = `${formatNumber.format(payload.total)} ${label}`;
  elements.pageLabel.textContent = `${payload.page} / ${payload.totalPages}`;
  elements.previous.disabled = payload.page <= 1;
  elements.next.disabled = payload.page >= payload.totalPages;
  elements.list.innerHTML = payload.items.map((item) => `
    <button type="button" class="book-item ${state.selectedSlug === item.id ? "active" : ""}" data-content-id="${escapeHtml(item.id)}">
      <h3>${escapeHtml(item.title || "Tanpa judul")}</h3>
      <p>${state.resource === "topics"
        ? `${(item.points || []).length} poin · ${item.has_note ? "ada detail" : "tanpa detail"}`
        : escapeHtml(item.thesis || "Tanpa tesis")}</p>
      <div class="book-meta">${state.resource === "insights" ? `<span class="badge ${item.status === "published" ? "approved" : "warning"}">${escapeHtml(item.status)}</span>` : ""}</div>
    </button>`).join("");
  elements.list.querySelectorAll("[data-content-id]").forEach((button) => {
    button.addEventListener("click", () => selectContent(button.dataset.contentId));
  });
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
  if (state.resource !== "books") return selectContent(slug);
  state.selectedSlug = slug;
  await loadBooks();
  const book = await getJson(`/books/${encodeURIComponent(slug)}`);
  renderDetail(book);
}

async function selectContent(id) {
  state.selectedSlug = id;
  await loadContentItems();
  const item = await getJson(`/books?resource=${state.resource}&id=${encodeURIComponent(id)}`);
  renderContentDetail(item);
}

function textLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function renderContentDetail(item) {
  if (state.resource === "topics") {
    elements.detail.innerHTML = `
      <article class="content-editor">
        <div class="detail-heading"><div><span class="badge approved">Knowledge</span><h2>${escapeHtml(item.title || "Tanpa judul")}</h2></div></div>
        <label>Judul<input data-field="title" value="${escapeHtml(item.title || "")}"></label>
        <label>Kategori <small>satu kategori per baris</small><textarea data-field="categories" rows="4">${escapeHtml(textLines(item.categories))}</textarea></label>
        <label>Poin utama <small>satu poin per baris</small><textarea data-field="points" rows="9">${escapeHtml(textLines(item.points))}</textarea></label>
        <label>Isi detail<textarea data-field="note_content" rows="18">${escapeHtml(item.note_content || "")}</textarea></label>
        <div class="save-row"><span data-save-status></span><button type="button" class="primary-button" data-save-content>Simpan Knowledge</button></div>
      </article>`;
  } else {
    const posts = Array.isArray(item.posts) ? item.posts : [];
    elements.detail.innerHTML = `
      <article class="content-editor">
        <div class="detail-heading"><div><span class="badge ${item.status === "published" ? "approved" : "warning"}">${escapeHtml(item.status)}</span><h2>${escapeHtml(item.title || "Tanpa judul")}</h2></div></div>
        <div class="edit-grid compact-edit-grid">
          <label>Judul<input data-field="title" value="${escapeHtml(item.title || "")}"></label>
          <label>Status<select data-field="status"><option value="draft" ${item.status === "draft" ? "selected" : ""}>Draft</option><option value="published" ${item.status === "published" ? "selected" : ""}>Published</option></select></label>
        </div>
        <label>Tesis<textarea data-field="thesis" rows="3">${escapeHtml(item.thesis || "")}</textarea></label>
        <label>Jenis konten <small>satu jenis per baris</small><textarea data-field="content_types" rows="3">${escapeHtml(textLines(item.content_types))}</textarea></label>
        <section class="post-editors"><h3>Isi Insight</h3>${posts.map((post, index) => `<label>Bagian ${index + 1}<textarea data-post-index="${index}" rows="7">${escapeHtml(post.text || "")}</textarea></label>`).join("")}</section>
        <div class="save-row"><span data-save-status></span><button type="button" class="primary-button" data-save-content>Simpan Insight</button></div>
      </article>`;
  }
  elements.detail.querySelector("[data-save-content]").addEventListener("click", saveContentDetail);
}

async function saveContentDetail() {
  const status = elements.detail.querySelector("[data-save-status]");
  const value = (name) => elements.detail.querySelector(`[data-field="${name}"]`)?.value || "";
  status.textContent = "Menyimpan…";
  try {
    const payload = state.resource === "topics" ? {
      title: value("title"), categories: value("categories").split("\n"),
      points: value("points").split("\n"), note_content: value("note_content"),
    } : {
      title: value("title"), status: value("status"), thesis: value("thesis"),
      content_types: value("content_types").split("\n"),
      posts: Array.from(elements.detail.querySelectorAll("[data-post-index]")).map((field) => ({ text: field.value })),
    };
    const updated = await getJson(`/books?resource=${state.resource}&id=${encodeURIComponent(state.selectedSlug)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    status.textContent = "Tersimpan";
    await Promise.all([loadStats(), loadContentItems()]);
    renderContentDetail(updated);
  } catch (error) { status.textContent = error.message; }
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

document.querySelectorAll("[data-content-tab]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.resource = button.dataset.contentTab;
    state.page = 1;
    state.selectedSlug = null;
    document.querySelectorAll("[data-content-tab]").forEach((item) => item.classList.toggle("active", item === button));
    elements.bookFilters.classList.toggle("is-hidden", state.resource !== "books");
    elements.search.placeholder = state.resource === "books" ? "Judul atau penulis"
      : state.resource === "topics" ? "Cari knowledge" : "Cari insight";
    elements.detail.innerHTML = `<div class="empty-state"><span class="empty-icon">⌁</span><h2>Pilih ${state.resource === "topics" ? "knowledge" : state.resource === "insights" ? "insight" : "buku"}</h2><p>Detail dan editor konten akan tampil di sini.</p></div>`;
    await loadBooks();
  });
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = elements.passwordInput.value;
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "Memeriksa…";
  elements.loginError.textContent = "";
  try {
    await validatePassword(password);
    sessionStorage.setItem("fa-reader-admin-password", password);
    showAdmin();
    await Promise.all([loadStats(), loadBooks()]);
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.passwordInput.select();
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "Masuk ke Admin";
  }
});

elements.togglePassword.addEventListener("click", () => {
  const visible = elements.passwordInput.type === "text";
  elements.passwordInput.type = visible ? "password" : "text";
  elements.togglePassword.textContent = visible ? "Lihat" : "Tutup";
  elements.togglePassword.setAttribute("aria-label", visible ? "Tampilkan password" : "Sembunyikan password");
});

elements.logoutButton.addEventListener("click", () => {
  sessionStorage.removeItem("fa-reader-admin-password");
  showLoginWall("Anda sudah keluar dari panel admin.");
});

await bootstrapAdmin();
