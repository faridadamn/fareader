BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE content_status AS ENUM (
  'imported',
  'processing',
  'needs_review',
  'ready_for_review',
  'published',
  'unpublished',
  'rejected'
);

CREATE TYPE issue_severity AS ENUM ('warning', 'error');
CREATE TYPE reading_status AS ENUM ('unread', 'reading', 'completed');
CREATE TYPE collection_visibility AS ENUM ('private', 'unlisted', 'public');

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider_id text UNIQUE,
  email citext UNIQUE,
  display_name text,
  avatar_url text,
  preferred_language text NOT NULL DEFAULT 'id',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_directory text NOT NULL,
  schema_version text NOT NULL DEFAULT '1.0',
  total_selected integer NOT NULL DEFAULT 0 CHECK (total_selected >= 0),
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  report jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext NOT NULL UNIQUE,
  title text NOT NULL,
  original_author text,
  summary_publisher text NOT NULL,
  language text NOT NULL DEFAULT 'id',
  description text,
  cover_url text,
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  reading_time_minutes integer NOT NULL DEFAULT 1
    CHECK (reading_time_minutes > 0),
  status content_status NOT NULL DEFAULT 'imported',
  rights_verified boolean NOT NULL DEFAULT false,
  rights_notes text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(original_author, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) STORED,
  CONSTRAINT published_book_requires_rights CHECK (
    status <> 'published' OR rights_verified = true
  ),
  CONSTRAINT published_book_requires_metadata CHECK (
    status <> 'published'
    OR (
      length(trim(title)) > 0
      AND original_author IS NOT NULL
      AND length(trim(original_author)) > 0
      AND page_count >= 2
      AND word_count >= 800
    )
  )
);

CREATE INDEX books_status_idx ON books (status);
CREATE INDEX books_author_idx ON books (original_author);
CREATE INDEX books_published_at_idx ON books (published_at DESC);
CREATE INDEX books_search_idx ON books USING gin (search_document);

CREATE TABLE book_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ingestion_batch_id uuid REFERENCES ingestion_batches(id) ON DELETE SET NULL,
  source_file text NOT NULL,
  source_path text,
  source_url text NOT NULL,
  checksum_sha256 char(64) NOT NULL UNIQUE,
  file_size_bytes bigint CHECK (file_size_bytes >= 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX book_sources_book_idx ON book_sources (book_id);
CREATE INDEX book_sources_batch_idx ON book_sources (ingestion_batch_id);

CREATE TABLE book_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  order_index integer NOT NULL CHECK (order_index >= 0),
  title text NOT NULL,
  heading_label text,
  content text NOT NULL,
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  source_page_start integer CHECK (source_page_start > 0),
  source_page_end integer CHECK (source_page_end > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) STORED,
  UNIQUE (book_id, order_index),
  CHECK (
    source_page_start IS NULL
    OR source_page_end IS NULL
    OR source_page_end >= source_page_start
  )
);

CREATE INDEX book_sections_book_idx
  ON book_sections (book_id, order_index);
CREATE INDEX book_sections_search_idx
  ON book_sections USING gin (search_document);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext NOT NULL UNIQUE,
  name citext NOT NULL UNIQUE,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_categories (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence numeric(5, 2) CHECK (confidence BETWEEN 0 AND 100),
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'automatic'
    CHECK (source IN ('automatic', 'manual')),
  PRIMARY KEY (book_id, category_id)
);

CREATE INDEX book_categories_category_idx
  ON book_categories (category_id, is_primary);

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext NOT NULL UNIQUE,
  name citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_tags (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'automatic'
    CHECK (source IN ('automatic', 'manual')),
  PRIMARY KEY (book_id, tag_id)
);

CREATE INDEX book_tags_tag_idx ON book_tags (tag_id);

CREATE TABLE content_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  code text NOT NULL,
  severity issue_severity NOT NULL,
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolution_notes text,
  resolved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_issues_open_idx
  ON content_issues (book_id, resolved, severity);

CREATE TABLE user_interests (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE reading_progress (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section_id uuid REFERENCES book_sections(id) ON DELETE SET NULL,
  status reading_status NOT NULL DEFAULT 'unread',
  section_position_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (section_position_percent BETWEEN 0 AND 100),
  book_progress_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (book_progress_percent BETWEEN 0 AND 100),
  started_at timestamptz,
  last_read_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX reading_progress_continue_idx
  ON reading_progress (user_id, last_read_at DESC)
  WHERE status = 'reading';

CREATE TABLE highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section_id uuid REFERENCES book_sections(id) ON DELETE SET NULL,
  content_version integer NOT NULL DEFAULT 1,
  selected_text text NOT NULL,
  context_before text,
  context_after text,
  text_start integer CHECK (text_start >= 0),
  text_end integer CHECK (text_end >= 0),
  color text NOT NULL DEFAULT 'yellow',
  note text,
  is_orphaned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    text_start IS NULL
    OR text_end IS NULL
    OR text_end >= text_start
  )
);

CREATE INDEX highlights_user_idx
  ON highlights (user_id, created_at DESC);
CREATE INDEX highlights_book_idx
  ON highlights (user_id, book_id);

CREATE TABLE section_bookmarks (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES book_sections(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section_id)
);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  visibility collection_visibility NOT NULL DEFAULT 'private',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX collections_user_idx
  ON collections (user_id, updated_at DESC);

CREATE TABLE collection_books (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, book_id)
);

CREATE TABLE content_audit_log (
  id bigserial PRIMARY KEY,
  book_id uuid REFERENCES books(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_audit_log_book_idx
  ON content_audit_log (book_id, created_at DESC);

CREATE TABLE product_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  session_id text,
  event_name text NOT NULL,
  book_id uuid REFERENCES books(id) ON DELETE SET NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_events_name_time_idx
  ON product_events (event_name, occurred_at DESC);
CREATE INDEX product_events_user_time_idx
  ON product_events (user_id, occurred_at DESC);

INSERT INTO categories (slug, name, display_order) VALUES
  ('bisnis-kewirausahaan', 'Bisnis & Kewirausahaan', 10),
  ('produktivitas', 'Produktivitas', 20),
  ('keuangan-investasi', 'Keuangan & Investasi', 30),
  ('psikologi', 'Psikologi', 40),
  ('pengembangan-diri', 'Pengembangan Diri', 50),
  ('kepemimpinan', 'Kepemimpinan', 60),
  ('komunikasi', 'Komunikasi', 70),
  ('teknologi', 'Teknologi', 80),
  ('sejarah-biografi', 'Sejarah & Biografi', 90),
  ('filsafat', 'Filsafat', 100),
  ('sains', 'Sains', 110),
  ('kesehatan', 'Kesehatan', 120),
  ('parenting-pendidikan', 'Parenting & Pendidikan', 130),
  ('fiksi', 'Fiksi', 140)
ON CONFLICT DO NOTHING;

COMMIT;
