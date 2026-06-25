# Ebook Summary Reader

Prototype awal untuk mengubah koleksi PDF rangkuman menjadi JSON terstruktur yang siap dipakai oleh katalog, pencarian, reader, dan panel admin.

## Status saat ini

- Input: PDF dari `../belajar-scraping/pdf_books_c0`
- Output: satu JSON per buku, katalog gabungan, dan laporan ingestion
- Ekstraksi: judul, penulis asli, penerbit rangkuman, URL sumber, isi, bagian, jumlah kata, durasi baca, kategori, tag, dan status kualitas
- File bermasalah tidak dipublikasikan otomatis; statusnya `needs_review` atau `rejected`
- Audit penuh: 1.114 PDF berhasil diproses tanpa kegagalan
- Status Supabase saat ini: 1.104 `ready_for_review`, 9 `needs_review`, 1 `rejected`, dan 0 `published`

## Persiapan

Pastikan Node.js tersedia, lalu dari folder proyek jalankan:

```powershell
npm install
```

Konfigurasi contoh tersedia di `.env.example`.

## Menjalankan sampel 30 PDF

```powershell
npm run ingest:sample
```

Hasil disimpan ke:

```text
data/processed/
├── _catalog.json
├── _ingestion-report.json
└── {slug-buku}.json
```

## Menjalankan seluruh dataset

```powershell
npm run ingest
```

Hasil audit penuh yang sudah dibuat tersedia di:

```text
data/processed/full/
```

## Memvalidasi data sebelum import

```powershell
npm run import:validate
```

## Import ke PostgreSQL

Jalankan `database/schema.sql`, atur `DATABASE_URL`, lalu:

```powershell
npm run import:postgres
```

Untuk Supabase:

```powershell
npm run import:supabase
```

Status database saat ini:

- Schema dan RLS telah terpasang.
- 1.114 buku serta 10.478 bagian telah diimpor.
- Review lokal untuk `untitled` sudah dimigrasikan menjadi `rejected`.
- Belum ada buku published.

## Panel admin

```powershell
npm run admin
```

Buka `http://127.0.0.1:4175`. Panel admin membaca dan menyimpan keputusan review langsung ke Supabase melalui `DATABASE_URL` di file `.env`.

## Public reader app

Mode publik hanya menampilkan buku dengan status `published`:

```powershell
npm run web
```

Buka `http://127.0.0.1:4176`.

Untuk development, gunakan mode preview agar buku `ready_for_review` bisa dilihat tanpa mem-publish konten:

```powershell
npm run web:preview
```

Fitur reader saat ini:

- UI brandkit FA Reader: navy, teal, white, card rounded, mobile-first.
- Logo menggunakan asset FA Reader di `web/public/assets/fa-reader-logo.png`.
- Progress baca per buku tersimpan otomatis di browser perangkat.
- Bookmark buku tersimpan otomatis di browser perangkat.
- Highlight teks tersimpan otomatis di browser perangkat dan tampil di tab `Highlight`.
- Halaman simpanan memiliki tab `Bookmark` dan `Highlight`.
- Panel `Lanjutkan Membaca` menampilkan semua buku yang sedang dibaca.
- Reader memiliki daftar isi, continuous scroll antar section, dan progress bar otomatis.
- Reader memiliki kontrol ukuran font `A− / A+` yang tersimpan otomatis di browser perangkat.
- Layout sudah disiapkan untuk wrapper mobile Capacitor: responsive, bottom navigation, dan safe-area padding.

Catatan: progress dan bookmark masih local-first via browser storage. Setelah auth Supabase dibuat, data ini bisa disinkronkan ke database per user.

## Mobile app dengan Capacitor

Wrapper Android Capacitor tersedia di folder `android/`.

```powershell
npm install
npm run cap:sync
npm run android:build
```

File web mobile memakai asset static dari `web/public`. Untuk aplikasi mobile yang berjalan di WebView, arahkan API ke backend publik dengan mengubah:

```javascript
// web/public/config.js
window.FA_READER_API_BASE = "https://domain-backend-kamu.com";
```

Setelah mengubah `config.js`, jalankan ulang:

```powershell
npm run cap:sync
```

Catatan: backend Node di `web/server.mjs` tetap diperlukan untuk endpoint `/api/meta`, `/api/books`, dan `/api/books/:slug`. Jangan menaruh `DATABASE_URL` langsung di aplikasi mobile.

Dokumentasi lengkap:

- `docs/DATABASE-SCHEMA.md`
- `docs/IMPORTER-AND-ADMIN.md`

## Opsi CLI

```powershell
node scripts/ingest-pdfs.mjs `
  --input "..\belajar-scraping\pdf_books_c0" `
  --output ".\data\processed" `
  --limit 30 `
  --reading-speed 200
```

| Opsi | Fungsi |
|---|---|
| `--input` | Folder sumber PDF |
| `--output` | Folder hasil JSON |
| `--limit` | Batas jumlah file; `0` berarti semua |
| `--reading-speed` | Jumlah kata per menit untuk estimasi durasi |

## Struktur output buku

```json
{
  "schema_version": "1.0",
  "source_file": "atomic-habits.pdf",
  "checksum_sha256": "...",
  "title": "Atomic Habits",
  "slug": "atomic-habits",
  "original_author": "James Clear",
  "summary_publisher": "F15 LIBRARY",
  "source_url": "https://www.f15library.com/...",
  "language": "id",
  "page_count": 10,
  "word_count": 2800,
  "reading_time_minutes": 14,
  "categories": ["Produktivitas"],
  "tags": [],
  "description": "...",
  "sections": [],
  "quality": {
    "status": "ready_for_review",
    "issues": []
  }
}
```

## Quality gate

Status `needs_review` diberikan jika:

- Judul kosong atau `Untitled`.
- Penulis asli tidak ditemukan.
- URL sumber tidak valid.
- PDF kurang dari dua halaman.
- Isi kurang dari 800 kata.
- Struktur `Bagian` tidak berhasil ditemukan.

Peringatan bagian yang sangat pendek tetap dicatat, tetapi tidak selalu memblokir proses review.

## Catatan arsitektur

- PDF tetap menjadi sumber utama pipeline.
- CSV lama dapat digunakan sebagai pembanding audit, tetapi pipeline tidak bergantung padanya.
- Output belum boleh langsung dianggap `published`. Status terbaik dari proses otomatis adalah `ready_for_review`.
- Verifikasi hak penggunaan konten tetap wajib sebelum katalog tersedia untuk publik.
