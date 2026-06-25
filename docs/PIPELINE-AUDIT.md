# Audit Pipeline

Tanggal audit: 23 Juni 2026

## Audit penuh

- Sumber: `belajar-scraping/pdf_books_c0`
- Total diproses: 1.114 PDF
- Berhasil diproses: 1.114
- Gagal diproses: 0
- Siap untuk review admin: 1.104
- Perlu pemeriksaan khusus: 10

Statistik:

| Metrik | Nilai |
|---|---:|
| Rata-rata halaman | 10,93 |
| Rata-rata kata | 2.746 |
| Median kata | 2.753 |
| Kata minimum | 0 |
| Kata maksimum | 3.785 |

Masalah yang tersisa:

- 9 PDF memiliki struktur valid tetapi tidak menggunakan pola heading yang dapat dipastikan secara otomatis.
- 1 PDF, `untitled.pdf`, rusak/tidak mempunyai isi.
- Peringatan bagian sangat pendek ditemukan pada sebagian buku dan harus terlihat di panel admin, tetapi tidak selalu memblokir review.

Parser telah diperluas untuk mengenali:

- `Bagian N`
- `Aturan N`
- `Kebiasaan N`
- `Hukum N`
- `Prinsip N`
- `Pilar N`
- `Pelajaran N`
- `Langkah N`
- `Rahasia N`
- `Level N`

## Batch pengujian awal

- Sumber: `belajar-scraping/pdf_books_c0`
- Total dataset tersedia: 1.114 PDF
- Sampel diuji: 30 PDF
- Strategi sampel: file tersebar merata secara alfabetis ditambah `untitled.pdf` sebagai kasus anomali

## Hasil

| Metrik | Hasil |
|---|---:|
| Berhasil diproses | 30 |
| Gagal dibuka atau diekstrak | 0 |
| Metadata judul terambil | 30 |
| Dokumen normal dengan penulis asli terambil | 29 |
| Siap untuk review admin | 28 |
| Perlu pemeriksaan khusus | 2 |

Pada dokumen normal, pipeline berhasil menghasilkan:

- Judul buku.
- Penulis asli.
- Penerbit rangkuman.
- URL sumber.
- Jumlah halaman.
- Jumlah kata.
- Estimasi waktu baca.
- Struktur bagian.
- Isi bersih per bagian.
- Saran kategori dan tag.
- Checksum untuk deteksi file duplikat.

Kisaran sampel normal:

- Jumlah kata: sekitar 2.400–3.400 kata.
- Estimasi waktu baca: 13–18 menit pada kecepatan 200 kata/menit.
- Struktur: umumnya 6–11 bagian.

## Kasus yang berhasil ditangkap

### `untitled.pdf`

- Hanya satu halaman.
- Tidak mempunyai isi rangkuman.
- Tidak mempunyai judul valid.
- Tidak mempunyai penulis asli valid.
- Harus berstatus `needs_review`.

### Buku tanpa heading `Bagian`

`the-seven-spiritual-laws-of-success.pdf` mempunyai isi yang cukup, tetapi pola heading berbeda sehingga hanya menghasilkan satu bagian. Pipeline menandainya untuk review struktur, bukan langsung menganggapnya siap.

## Temuan

1. Struktur PDF cukup konsisten untuk ekstraksi otomatis.
2. Pemisahan paragraf dapat menggunakan jeda paragraf yang tersimpan di PDF.
3. Pola metadata halaman pertama konsisten pada sampel normal.
4. Heading utama biasanya mengikuti pola `Bagian N: Judul`.
5. Sebagian kecil buku memerlukan fallback pemisahan bagian yang lebih cerdas.
6. Klasifikasi kategori saat ini berbasis kata kunci dan harus dianggap sebagai saran admin.

## Batasan

- Belum membandingkan metadata otomatis dengan seluruh data CSV.
- Belum mendeteksi kemiripan isi antarjudul.
- Belum menghasilkan embedding atau indeks pencarian.
- Belum memiliki panel admin untuk koreksi hasil.

## Rekomendasi langkah berikutnya

1. Audit acak minimal 50 hasil berstatus `ready_for_review`.
2. Tambahkan fallback sectioning berbasis review admin untuk sembilan dokumen khusus.
3. Tambahkan deteksi duplikat berdasarkan kemiripan isi.
4. Buat importer JSON ke PostgreSQL.
5. Bangun panel admin sederhana sebelum katalog pengguna.
