# FA Reader V2

FA Reader V2 menggabungkan dua pengalaman dalam satu aplikasi tanpa menghapus data yang ada di project Supabase `lexis`.

## Menu utama

1. **Beranda** — ringkasan jumlah buku dan knowledge topic.
2. **Buku** — membaca katalog `books` dan isi `book_sections` dari FA Reader.
3. **Knowledge** — membaca `topics`, insight `points`, kategori `categories`, dan catatan terkait dari `notes` milik Lexis Library.

## Mapping Supabase

| Area | Tabel |
|---|---|
| Katalog buku | `books`, `book_sections`, `book_categories`, `categories` |
| Knowledge Lexis | `topics`, `notes` |
| Fitur akun tahap berikutnya | `app_users`, `reading_progress`, `highlights`, `collections`, `section_bookmarks` |

Tidak ada migration atau penghapusan tabel pada tahap ini.

## Menjalankan lokal

Project memakai dependency `postgres` yang sudah tersedia di root repo.

```bash
DATABASE_URL="postgresql://..." node v2/server.mjs
```

Lalu buka:

```text
http://localhost:4177
```

Untuk menampilkan buku `ready_for_review` selama development:

```bash
PREVIEW_CATALOG=1 DATABASE_URL="postgresql://..." node v2/server.mjs
```

## Endpoint awal

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/books?q=`
- `GET /api/books/:slug`
- `GET /api/topics?q=&category=`
- `GET /api/topics/:id`

## Catatan data Lexis

Beberapa record `topics` hasil impor CSV memiliki array kategori atau points yang tidak sepenuhnya konsisten. Endpoint V2 melakukan normalisasi defensif agar UI tetap dapat dibaca. Pembersihan data dilakukan pada tahap berikutnya, setelah dibuat laporan data bermasalah dan sebelum ada perubahan permanen.

## Tahap berikutnya

- Auth Supabase dan profile per user.
- Progress baca, bookmark, dan highlight tersinkronisasi.
- Catatan pribadi per topic, terpisah dari `notes` import.
- Search terpadu buku + knowledge.
- Admin review untuk memperbaiki topic yang format hasil impornya rusak.
