# PRD — Ebook Summary Reader

## 1. Ringkasan produk

Ebook Summary Reader adalah aplikasi perpustakaan dan pembaca rangkuman buku berbahasa Indonesia. Produk mengubah koleksi PDF rangkuman yang saat ini tersebar sebagai file menjadi katalog yang mudah dicari, dibaca, disimpan, dan dilanjutkan lintas perangkat.

Produk tidak membuat rangkuman baru pada MVP. Konten utama berasal dari PDF yang sudah tersedia, kemudian diekstrak menjadi teks terstruktur agar pengalaman membaca lebih nyaman daripada membuka PDF mentah.

## 2. Latar belakang dan temuan data

Dataset yang diperiksa:

- Lokasi: `belajar-scraping/pdf_books_c0`
- Jumlah: 1.114 file PDF
- Ukuran total: sekitar 68,9 MB
- Ukuran per file: 41–70 KB, median sekitar 61,8 KB
- Seluruh file berhasil dibuka dan diekstrak
- Seluruh file memiliki URL sumber dari `www.f15library.com`
- Konten dominan berupa rangkuman buku dalam bahasa Indonesia
- Panjang dominan: 9–13 halaman
- Rentang keseluruhan: 1–17 halaman
- Tidak tersedia katalog terpisah, kategori, cover, atau metadata terstruktur
- Metadata bawaan PDF tidak dapat dijadikan sumber utama
- Ada minimal satu data tidak valid: `untitled.pdf`, hanya satu halaman dan tidak mempunyai isi rangkuman

Distribusi jumlah halaman:

| Halaman | Jumlah file |
|---:|---:|
| 1 | 1 |
| 7 | 10 |
| 8 | 55 |
| 9 | 165 |
| 10 | 229 |
| 11 | 244 |
| 12 | 227 |
| 13 | 110 |
| 14 | 49 |
| 15 | 16 |
| 16 | 6 |
| 17 | 2 |

Implikasi produk:

- Aplikasi sebaiknya membaca teks hasil ekstraksi, bukan hanya menampilkan PDF.
- Pipeline impor wajib mengekstrak judul buku, penulis asli, sumber, bagian, dan isi.
- Kategori dan tag perlu dibuat saat proses kurasi.
- File asli tetap disimpan sebagai bukti sumber dan fallback.
- Konten yang gagal validasi tidak boleh langsung dipublikasikan.

## 3. Masalah pengguna

Koleksi saat ini sulit digunakan karena:

- Pengguna harus mengetahui nama file untuk menemukan buku.
- Tidak ada pencarian berdasarkan topik, penulis, atau isi.
- Membaca PDF di layar ponsel kurang nyaman.
- Tidak ada progres baca, bookmark, highlight, atau catatan.
- Tidak ada rekomendasi atau pengelompokan berdasarkan minat.
- Tidak ada indikasi durasi membaca atau bagian yang sudah selesai.

## 4. Tujuan

### Tujuan bisnis

- Mengubah dataset menjadi produk konten yang dapat digunakan.
- Meningkatkan konsumsi rangkuman dan tingkat penyelesaian bacaan.
- Menyiapkan fondasi untuk model gratis, premium, atau organisasi.
- Membuat pipeline yang dapat menerima koleksi PDF tambahan.

### Tujuan pengguna

- Menemukan buku relevan dalam waktu kurang dari satu menit.
- Membaca rangkuman dengan nyaman di ponsel.
- Melanjutkan bacaan dari posisi terakhir.
- Menyimpan insight penting sebagai highlight atau catatan.
- Mengetahui inti buku tanpa membaca file PDF secara manual.

### Bukan tujuan MVP

- Menyediakan ebook versi penuh.
- Menghasilkan ulang seluruh rangkuman dengan AI.
- Marketplace atau penjualan buku.
- Fitur sosial, komentar publik, dan komunitas.
- Audiobook penuh.
- Sinkronisasi dengan Kindle atau perangkat e-reader.

## 5. Target pengguna

### Persona utama: pembaca praktis

- Profesional, pelajar, atau pemilik bisnis.
- Ingin memahami gagasan utama buku dalam 10–20 menit.
- Membaca terutama melalui ponsel.
- Tertarik pada produktivitas, bisnis, psikologi, keuangan, dan pengembangan diri.

### Persona sekunder: pembelajar terstruktur

- Membaca beberapa rangkuman untuk mempelajari satu topik.
- Membutuhkan bookmark, highlight, catatan, dan koleksi.
- Ingin kembali ke insight yang pernah dibaca.

## 6. Nilai utama produk

“Pahami inti buku dalam bahasa Indonesia, simpan insight penting, dan lanjutkan membaca kapan saja.”

## 7. Ruang lingkup MVP

### 7.1 Onboarding

- Pengguna memilih minimal tiga topik minat.
- Pengguna dapat melewati proses pendaftaran dan masuk sebagai tamu.
- Pendaftaran diperlukan untuk sinkronisasi progres, bookmark, dan catatan.

Kriteria penerimaan:

- Minat tersimpan dan digunakan untuk menyusun halaman beranda.
- Pengguna dapat mulai membaca tanpa proses lebih dari tiga langkah.

### 7.2 Beranda

Komponen:

- Lanjutkan membaca.
- Pilihan berdasarkan minat.
- Rangkuman populer.
- Baru ditambahkan.
- Kategori.
- Bacaan singkat.

Kriteria penerimaan:

- Buku yang terakhir dibaca tampil paling atas.
- Setiap kartu menampilkan judul, penulis, kategori, dan estimasi waktu baca.

### 7.3 Katalog dan pencarian

Kemampuan:

- Pencarian judul, penulis, kategori, tag, dan isi rangkuman.
- Filter kategori dan durasi baca.
- Urutkan berdasarkan relevansi, terbaru, dan populer.
- Riwayat pencarian lokal.

Kriteria penerimaan:

- Hasil judul muncul saat pengguna mengetik sebagian judul.
- Pencarian isi mengarahkan pengguna ke rangkuman yang relevan.
- Hasil pencarian tidak menampilkan konten berstatus draft atau rejected.

### 7.4 Detail buku

Informasi:

- Judul.
- Penulis asli.
- Deskripsi singkat.
- Kategori dan tag.
- Estimasi waktu baca.
- Jumlah bagian.
- Sumber dan atribusi.
- Status baca.
- Tombol mulai atau lanjutkan.
- Tombol simpan ke koleksi.

Kriteria penerimaan:

- Pengguna dapat membuka reader dari detail buku.
- Posisi terakhir digunakan jika buku pernah dibaca.

### 7.5 Reader

Kemampuan:

- Tampilan teks responsif.
- Daftar isi berdasarkan bagian.
- Ukuran font, tinggi baris, tema terang, sepia, dan gelap.
- Progres per bagian dan per buku.
- Navigasi bagian sebelumnya/berikutnya.
- Mode layar penuh.
- Tautan untuk membuka PDF asli sebagai fallback.

Kriteria penerimaan:

- Posisi baca disimpan otomatis.
- Pengguna kembali ke posisi terakhir setelah menutup aplikasi.
- Perubahan tema dan tipografi tersimpan di perangkat.

### 7.6 Highlight, bookmark, dan catatan

- Highlight potongan teks.
- Pilihan warna highlight.
- Catatan pribadi pada highlight.
- Bookmark per bagian.
- Halaman kumpulan insight pengguna.

Kriteria penerimaan:

- Highlight tetap terhubung ke buku dan bagian asal.
- Menekan highlight dari halaman insight membuka posisi teks terkait.

### 7.7 Koleksi pribadi

- Tambahkan buku ke “Ingin Dibaca”.
- Buat koleksi khusus.
- Status: belum dibaca, sedang dibaca, selesai.

Kriteria penerimaan:

- Satu buku dapat berada di lebih dari satu koleksi.
- Status selesai tercatat saat progres mencapai batas yang ditentukan.

### 7.8 Admin dan kurasi konten

- Daftar hasil impor.
- Status: imported, needs_review, published, rejected.
- Edit judul, penulis, kategori, tag, deskripsi, dan bagian.
- Tampilkan file sumber dan hasil ekstraksi secara berdampingan.
- Tandai duplikat atau konten rusak.
- Publikasi massal hanya untuk item yang lolos validasi.

Kriteria penerimaan:

- `untitled.pdf` masuk ke `needs_review`, bukan published.
- Konten tanpa judul, penulis, sumber, atau isi tidak dapat dipublikasikan.
- Semua perubahan admin memiliki catatan waktu dan pengguna.

## 8. Fitur fase berikutnya

### Fase 2

- Unduh rangkuman untuk dibaca offline.
- Rekomendasi berdasarkan riwayat baca dan topik.
- Target membaca mingguan.
- Streak dan statistik membaca.
- Bagikan kartu insight.
- Text-to-speech untuk isi rangkuman.
- Pencarian semantik.

### Fase 3

- Tanya jawab berbasis isi rangkuman dengan jawaban dan kutipan sumber.
- Kuis pemahaman per buku.
- Ringkasan ultra-singkat “5 menit”.
- Jalur belajar berisi beberapa buku.
- Dashboard organisasi dan assignment bacaan.

## 9. Model data inti

### Book

| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | ID internal |
| slug | string | URL unik |
| title | string | Judul buku |
| original_author | string | Penulis buku asli |
| summary_publisher | string | Pembuat/penerbit rangkuman |
| source_url | string | URL sumber |
| source_file | string | Path atau object key PDF |
| language | string | Default `id` |
| description | text | Deskripsi katalog |
| reading_time_minutes | integer | Estimasi waktu baca |
| page_count | integer | Jumlah halaman PDF |
| word_count | integer | Jumlah kata hasil ekstraksi |
| cover_url | string nullable | Cover yang sah digunakan |
| status | enum | imported/needs_review/published/rejected |
| published_at | timestamp nullable | Waktu publikasi |

### BookSection

| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | ID bagian |
| book_id | UUID | Relasi buku |
| order_index | integer | Urutan |
| title | string | Judul bagian |
| content | text | Isi bersih |
| source_page_start | integer | Halaman awal PDF |
| source_page_end | integer | Halaman akhir PDF |

### Category dan Tag

- Category: kategori utama, maksimal dua per buku.
- Tag: topik lebih spesifik dan dapat berjumlah banyak.

Kategori awal yang disarankan:

- Bisnis & Kewirausahaan
- Produktivitas
- Keuangan & Investasi
- Psikologi
- Pengembangan Diri
- Kepemimpinan
- Komunikasi
- Teknologi
- Sejarah & Biografi
- Filsafat
- Sains
- Kesehatan
- Parenting & Pendidikan
- Fiksi

### UserReadingProgress

- user_id
- book_id
- section_id
- position_percent
- book_progress_percent
- started_at
- last_read_at
- completed_at

### Highlight

- user_id
- book_id
- section_id
- selected_text
- text_start
- text_end
- color
- note
- created_at

## 10. Pipeline data

Setiap PDF melewati tahapan:

1. Penemuan file dan pembuatan checksum.
2. Validasi format dan kemampuan ekstraksi.
3. Ekstraksi teks per halaman.
4. Ekstraksi metadata dari halaman pertama.
5. Pembersihan header, footer, dan teks berulang.
6. Pemisahan isi berdasarkan pola `Bagian`, heading, dan urutan halaman.
7. Perhitungan jumlah kata dan estimasi waktu baca.
8. Klasifikasi kategori dan tag.
9. Pemeriksaan kualitas otomatis.
10. Pemeriksaan manual untuk item bermasalah.
11. Publikasi ke katalog.
12. Pembuatan indeks pencarian.

Aturan validasi minimum:

- PDF dapat dibuka.
- Minimal dua halaman atau melewati pemeriksaan manual.
- Judul dan penulis asli berhasil ditemukan.
- URL sumber valid.
- Isi bersih memiliki batas minimal kata.
- Tidak identik dengan item lain berdasarkan checksum atau kemiripan teks.
- Tidak berisi halaman kosong berlebihan.

## 11. Pencarian dan rekomendasi

### MVP

- Full-text search pada judul, penulis, deskripsi, tag, dan isi bagian.
- Bobot relevansi: judul > penulis > tag > heading > isi.
- Rekomendasi berbasis kategori pilihan dan buku yang sedang dibaca.

### Fase berikutnya

- Embedding per bagian.
- Pencarian semantik.
- Rekomendasi hibrida berdasarkan isi dan perilaku pengguna.

## 12. Persyaratan nonfungsional

### Performa

- Beranda tampil dalam maksimal 2,5 detik pada koneksi seluler normal.
- Pencarian memberikan hasil awal dalam maksimal 500 ms.
- Reader membuka bagian pertama dalam maksimal 1 detik setelah data tersedia.
- Daftar panjang menggunakan pagination atau infinite loading.

### Aksesibilitas

- Kontras minimal mengikuti WCAG AA.
- Ukuran font reader dapat diperbesar.
- Seluruh navigasi utama dapat digunakan dengan keyboard.
- Komponen memiliki label untuk screen reader.

### Keamanan dan privasi

- Catatan dan highlight bersifat privat secara default.
- Password tidak disimpan langsung; gunakan penyedia autentikasi atau hashing yang sesuai.
- Admin menggunakan role-based access control.
- Operasi publikasi dan penghapusan memiliki audit log.

### Keandalan

- File asli tidak diubah oleh pipeline.
- Proses impor bersifat idempotent menggunakan checksum.
- Kegagalan satu file tidak menghentikan seluruh batch.
- Backup database dan object storage dilakukan terjadwal.

## 13. Analitik produk

Event minimum:

- `book_impression`
- `book_detail_viewed`
- `search_performed`
- `reader_opened`
- `section_completed`
- `book_completed`
- `highlight_created`
- `bookmark_created`
- `collection_item_added`

Metrik utama:

- Persentase pengguna yang membuka reader setelah melihat detail buku.
- Persentase penyelesaian rangkuman.
- Jumlah buku selesai per pengguna per minggu.
- Retensi pengguna hari ke-7 dan hari ke-30.
- Persentase pencarian tanpa hasil.

North Star Metric:

- Jumlah rangkuman yang diselesaikan pengguna aktif per minggu.

## 14. Kriteria keberhasilan MVP

- Minimal 95% dataset lolos ekstraksi otomatis.
- 100% item published memiliki judul, penulis, sumber, kategori, dan isi.
- Pengguna dapat mencari, membuka, dan melanjutkan rangkuman.
- Progres baca tersimpan dengan benar pada minimal 99% sesi.
- Pencarian tanpa hasil berada di bawah 10% setelah katalog lengkap.
- Minimal 30% pengguna baru menyelesaikan satu rangkuman dalam tujuh hari.

## 15. Risiko dan mitigasi

### Hak cipta dan lisensi

Dataset menunjukkan bahwa konten berasal dari pihak ketiga. Rangkuman buku tetap dapat dianggap sebagai karya turunan dan penggunaan cover juga memiliki hak tersendiri.

Mitigasi:

- Verifikasi izin penggunaan dan distribusi sebelum peluncuran publik.
- Simpan sumber dan atribusi pada setiap buku.
- Jangan mengambil cover dari internet tanpa lisensi yang jelas.
- Sediakan proses takedown.
- Lakukan tinjauan legal untuk model komersial.

### Metadata tidak konsisten

Label `Author` di awal PDF mengacu pada F15 Library, sedangkan penulis buku asli muncul di bagian isi.

Mitigasi:

- Gunakan parser khusus berdasarkan pola dokumen.
- Pisahkan `original_author` dan `summary_publisher`.
- Masukkan hasil yang meragukan ke antrean review.

### Kategori belum tersedia

Mitigasi:

- Gunakan klasifikasi otomatis sebagai saran.
- Admin menyetujui kategori sebelum publikasi.

### Konten rusak atau kosong

Mitigasi:

- Terapkan batas minimum halaman, kata, dan heading.
- Karantina otomatis untuk data anomali seperti `untitled.pdf`.

## 16. Keputusan produk yang direkomendasikan

- Bangun sebagai PWA responsif terlebih dahulu agar satu aplikasi dapat digunakan di desktop dan ponsel.
- Jadikan teks terstruktur sebagai pengalaman utama dan PDF sebagai fallback.
- Pisahkan pipeline ingestion dari aplikasi pengguna.
- Jangan mempublikasikan seluruh 1.114 judul tanpa proses legal dan quality review.
- Mulai dengan 50–100 judul yang sudah dikurasi untuk validasi pengalaman pengguna, lalu perluas katalog bertahap.

