# Importer PostgreSQL dan Panel Admin

## 1. Validasi katalog

Validasi tidak membutuhkan database dan tidak menulis data:

```powershell
npm run import:validate
```

Validasi memeriksa:

- Seluruh field wajib.
- Format checksum SHA-256.
- Duplikasi slug dan checksum.
- Struktur bagian dan urutan `order_index`.
- Keberadaan quality status dan issue.

Hasil terakhir:

- 1.114 buku valid.
- 1.104 `ready_for_review`.
- 10 `needs_review`.
- 0 error struktur.

## 2. Menyiapkan PostgreSQL

1. Buat database kosong.
2. Jalankan `database/schema.sql`.
3. Salin `.env.example` menjadi `.env` atau set `DATABASE_URL`.
4. Jalankan importer.

Untuk Supabase gunakan importer batch:

```powershell
npm run import:supabase
```

Importer ini mengirim data secara batch agar 1.114 buku dan lebih dari 10.000 bagian tidak membutuhkan ribuan round-trip terpisah.

Contoh:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/ebook_summary_reader"
npm run import:postgres
```

Atau:

```powershell
node scripts/import-postgres.mjs `
  --database-url "postgresql://postgres:postgres@127.0.0.1:5432/ebook_summary_reader" `
  --catalog ".\data\processed\full\_catalog.json"
```

## 3. Perilaku importer

- Seluruh import berjalan dalam satu transaksi.
- Jika satu operasi gagal, batch dibatalkan.
- Buku di-upsert berdasarkan `slug`.
- PDF sumber di-upsert berdasarkan checksum.
- Bagian, kategori otomatis, tag otomatis, dan issue terbuka diganti dengan hasil pipeline terbaru.
- Status `published`, `unpublished`, dan `rejected` tidak ditimpa oleh import ulang.
- Setiap proses membuat catatan `ingestion_batches`.

Importer sengaja tidak menerbitkan buku. Status maksimal dari pipeline adalah `ready_for_review`.

## 4. Menjalankan panel admin

```powershell
npm run admin
```

Buka:

```text
http://127.0.0.1:4175
```

Panel menyediakan:

- Ringkasan jumlah katalog.
- Pencarian judul dan penulis.
- Filter quality status dan keputusan review.
- Detail metadata.
- Daftar quality issue.
- Preview bagian dan isi rangkuman.
- Keputusan pending, approved, atau rejected.
- Catatan reviewer.

## 5. Penyimpanan review lokal

Prototype panel membaca katalog JSON dan menyimpan keputusan ke:

```text
data/reviews/overrides.json
```

File katalog hasil pipeline tidak diubah. Pendekatan ini membuat prototype aman digunakan sebelum PostgreSQL aktif.

Pada tahap integrasi berikutnya, endpoint review dipindahkan ke tabel:

- `books.status`
- `content_issues`
- `content_audit_log`

## 6. Pengujian yang telah dilakukan

- Katalog penuh tampil: 1.114 buku.
- Filter `needs_review` menampilkan tepat 10 buku.
- Pencarian `Atomic Habits` menghasilkan tepat satu buku.
- Detail `untitled.pdf` menampilkan lima issue kualitas.
- Keputusan `rejected` beserta catatan dapat disimpan.
- Statistik review berubah setelah penyimpanan.
- Tidak ada overflow horizontal pada viewport desktop.
- Tidak ditemukan error console aplikasi saat pengujian.

## 7. Status Supabase

Import penuh telah berhasil dijalankan:

- 1.114 buku.
- 10.478 bagian.
- 1.114 source record.
- 14 kategori.
- 7.170 tag unik.
- 8.528 relasi buku-tag.
- 130 quality issue terbuka.

Seluruh buku masih berstatus `ready_for_review` atau `needs_review`. Belum ada buku published sehingga Data API publik belum menampilkan isi katalog.
