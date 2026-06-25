BEGIN;

-- Hapus akses default Supabase pada tabel aplikasi.
REVOKE ALL ON TABLE
  app_users,
  ingestion_batches,
  books,
  book_sources,
  book_sections,
  categories,
  book_categories,
  tags,
  book_tags,
  content_issues,
  user_interests,
  reading_progress,
  highlights,
  section_bookmarks,
  collections,
  collection_books,
  content_audit_log,
  product_events
FROM anon, authenticated;

-- Semua tabel publik aplikasi wajib melewati RLS.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;

-- Katalog publik: hanya konten yang benar-benar published.
GRANT SELECT ON books, book_sections, categories, book_categories, tags, book_tags
TO anon, authenticated;

CREATE POLICY books_public_read
ON books FOR SELECT
TO anon, authenticated
USING (status = 'published');

CREATE POLICY book_sections_public_read
ON book_sections FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM books
    WHERE books.id = book_sections.book_id
      AND books.status = 'published'
  )
);

CREATE POLICY categories_public_read
ON categories FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY tags_public_read
ON tags FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY book_categories_public_read
ON book_categories FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM books
    WHERE books.id = book_categories.book_id
      AND books.status = 'published'
  )
);

CREATE POLICY book_tags_public_read
ON book_tags FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM books
    WHERE books.id = book_tags.book_id
      AND books.status = 'published'
  )
);

-- Profil pengguna. auth_provider_id menyimpan auth.users.id.
GRANT SELECT, INSERT, UPDATE ON app_users TO authenticated;

CREATE POLICY app_users_read_own
ON app_users FOR SELECT
TO authenticated
USING (auth_provider_id = auth.uid()::text);

CREATE POLICY app_users_insert_own
ON app_users FOR INSERT
TO authenticated
WITH CHECK (auth_provider_id = auth.uid()::text);

CREATE POLICY app_users_update_own
ON app_users FOR UPDATE
TO authenticated
USING (auth_provider_id = auth.uid()::text)
WITH CHECK (auth_provider_id = auth.uid()::text);

-- Minat pengguna.
GRANT SELECT, INSERT, DELETE ON user_interests TO authenticated;

CREATE POLICY user_interests_manage_own
ON user_interests FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = user_interests.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = user_interests.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Progres membaca.
GRANT SELECT, INSERT, UPDATE, DELETE ON reading_progress TO authenticated;

CREATE POLICY reading_progress_manage_own
ON reading_progress FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = reading_progress.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = reading_progress.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Highlight dan catatan pribadi.
GRANT SELECT, INSERT, UPDATE, DELETE ON highlights TO authenticated;

CREATE POLICY highlights_manage_own
ON highlights FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = highlights.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = highlights.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Bookmark bagian.
GRANT SELECT, INSERT, DELETE ON section_bookmarks TO authenticated;

CREATE POLICY section_bookmarks_manage_own
ON section_bookmarks FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = section_bookmarks.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = section_bookmarks.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Koleksi pribadi.
GRANT SELECT, INSERT, UPDATE, DELETE ON collections, collection_books
TO authenticated;

CREATE POLICY collections_manage_own
ON collections FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = collections.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = collections.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

CREATE POLICY collection_books_manage_own
ON collection_books FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM collections
    JOIN app_users ON app_users.id = collections.user_id
    WHERE collections.id = collection_books.collection_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM collections
    JOIN app_users ON app_users.id = collections.user_id
    WHERE collections.id = collection_books.collection_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Analitik: pengguna hanya dapat menulis event miliknya sendiri.
GRANT INSERT ON product_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE product_events_id_seq TO authenticated;

CREATE POLICY product_events_insert_own
ON product_events FOR INSERT
TO authenticated
WITH CHECK (
  user_id IS NULL
  OR EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.id = product_events.user_id
      AND app_users.auth_provider_id = auth.uid()::text
  )
);

-- Tidak ada GRANT/policy untuk tabel operasional berikut:
-- ingestion_batches, book_sources, content_issues, content_audit_log.
-- Hanya koneksi backend/database owner yang dapat mengaksesnya.

COMMIT;
