# Supabase Row Level Security

Migration keamanan tersedia di `database/rls.sql`.

## Aturan akses

### Publik (`anon` dan `authenticated`)

- Dapat membaca `books` dengan status `published`.
- Dapat membaca bagian, kategori, dan tag yang terkait buku published.
- Tidak dapat membaca PDF source path, hasil ingestion, quality issue, atau audit log.

### Pengguna terautentikasi

- Hanya dapat membaca dan mengubah profil miliknya.
- Hanya dapat mengelola minat, progres, highlight, bookmark, dan koleksi miliknya.
- Dapat mengirim event analitik dengan `user_id` miliknya atau tanpa `user_id`.

### Backend/database owner

- Mengelola ingestion, review, publikasi, source file, dan audit log.
- Importer PostgreSQL menggunakan koneksi database owner dan tidak terpengaruh RLS.

## Catatan identitas

Kolom `app_users.auth_provider_id` harus diisi dengan `auth.users.id` dari Supabase Auth dalam bentuk teks. Seluruh policy kepemilikan membandingkan nilai tersebut dengan `auth.uid()::text`.

## Status koleksi

Meskipun schema memiliki nilai visibility, policy awal tetap membatasi koleksi hanya untuk pemilik. Akses koleksi publik dapat ditambahkan kemudian setelah kebutuhan berbagi koleksi ditetapkan.
