-- ============================================================
-- Royal Energy Alchemy — Knowledge Hub Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- ── KNOWLEDGE TOPICS ─────────────────────────────────────────
-- Extracted/AI-computed themes from sessions. Auto-populated
-- by the knowledge-hub function from real session data.
CREATE TABLE IF NOT EXISTS knowledge_topics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           text NOT NULL,
  frequency       integer DEFAULT 0,
  trend_direction text DEFAULT 'stable',  -- 'rising' | 'stable' | 'declining'
  source          text DEFAULT 'computed', -- 'computed' | 'manual' | 'ai'
  category        text,                   -- 'protection' | 'clearing' | 'emotional' | 'relationship' | 'attachment' | 'environmental'
  last_computed_at timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- ── CONTENT IDEAS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_ideas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text,
  idea_type    text, -- 'video' | 'short_form' | 'long_form' | 'podcast'
  title        text NOT NULL,
  description  text,
  source_count integer DEFAULT 0,  -- how many clients this is based on
  status       text DEFAULT 'new', -- 'new' | 'in_progress' | 'published' | 'archived'
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

-- ── SCRIPT VAULT ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS script_vault (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  content_type text, -- 'short_video' | 'long_video' | 'facebook_post' | 'instagram_caption' | 'podcast_outline'
  content      text,
  topic        text,
  status       text DEFAULT 'draft', -- 'draft' | 'ready' | 'published'
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

-- ── BOOK PROJECTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  subtitle    text,
  description text,
  status      text DEFAULT 'active', -- 'active' | 'paused' | 'archived'
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  deleted_at  timestamptz
);

-- ── BOOK EVIDENCE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_project_id uuid REFERENCES book_projects(id) ON DELETE SET NULL,
  category        text NOT NULL, -- 'relationship_issues' | 'house_clearing' | 'protection' | 'attachment' | 'environmental' | 'emotional'
  session_id      uuid,
  session_note_id uuid,
  summary         text,
  findings        text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- ── BOOK CHAPTERS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_chapters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_project_id uuid REFERENCES book_projects(id) ON DELETE CASCADE,
  chapter_number  integer,
  title           text NOT NULL,
  patterns        text,
  statistics      text,
  notes           text,
  status          text DEFAULT 'outline', -- 'outline' | 'draft' | 'complete'
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- ── TRAINING COURSES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  level        text, -- 'level_1' | 'level_2' | 'advanced' | 'specialized'
  description  text,
  status       text DEFAULT 'planning', -- 'planning' | 'in_progress' | 'complete' | 'published'
  module_count integer DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

-- ── TRAINING MODULES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_modules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid REFERENCES training_courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  module_type  text DEFAULT 'lesson', -- 'lesson' | 'slide' | 'worksheet' | 'handout' | 'quiz'
  content      text,
  order_index  integer DEFAULT 0,
  status       text DEFAULT 'draft', -- 'draft' | 'ready' | 'published'
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

-- ── RESEARCH PATTERNS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_patterns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            text NOT NULL,
  frequency        integer DEFAULT 0,
  growth_trend     text DEFAULT 'stable', -- 'rising' | 'stable' | 'declining'
  category         text, -- 'relationship' | 'environmental' | 'emotional' | 'protection' | 'attachment'
  notes            text,
  last_computed_at timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz
);

-- ── RESEARCH OPPORTUNITIES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_opportunities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  opportunity_type text DEFAULT 'pattern_investigation', -- 'future_study' | 'pattern_investigation' | 'outcome_analysis'
  status           text DEFAULT 'open', -- 'open' | 'in_progress' | 'complete'
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz
);

-- ── RLS — deny all direct access, all reads go through service_role ──────────
ALTER TABLE knowledge_topics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ideas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_vault             ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_evidence            ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_chapters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_modules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_patterns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_opportunities   ENABLE ROW LEVEL SECURITY;

-- ── SEED: Book Projects ───────────────────────────────────────
INSERT INTO book_projects (title, subtitle, description, status) VALUES
  ('Spiritual Attachments', 'A Practitioner''s Field Guide', 'Documenting case studies and patterns in spiritual attachment work — identification, removal, and protection protocols.', 'active'),
  ('Energy Hygiene', 'Daily Practices for Energetic Wellbeing', 'A practical guide to maintaining energetic cleanliness for everyday individuals and sensitive practitioners.', 'active'),
  ('The Healer''s Casebook', 'Real Sessions, Real Results', 'Anonymized case studies demonstrating transformation outcomes across distance and in-person energy work.', 'active')
ON CONFLICT DO NOTHING;

-- ── SEED: Book Chapters (for Spiritual Attachments) ──────────
-- (Inserted after book_projects so we can reference by subquery)
INSERT INTO book_chapters (book_project_id, chapter_number, title, status, notes)
SELECT id, 1, 'Recognizing Attachment Signatures', 'outline', 'Common presenting symptoms: fatigue, relationship conflict, recurring dreams, inexplicable mood shifts'
FROM book_projects WHERE title = 'Spiritual Attachments' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO book_chapters (book_project_id, chapter_number, title, status, notes)
SELECT id, 2, 'The Removal Process', 'draft', 'Step-by-step distance and in-person protocols. Case examples.'
FROM book_projects WHERE title = 'Spiritual Attachments' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO book_chapters (book_project_id, chapter_number, title, status, notes)
SELECT id, 3, 'Protection After Clearing', 'outline', 'Post-session recommendations, cord removal, energetic shields'
FROM book_projects WHERE title = 'Spiritual Attachments' LIMIT 1
ON CONFLICT DO NOTHING;

-- ── SEED: Training Courses ────────────────────────────────────
INSERT INTO training_courses (title, level, description, status, module_count) VALUES
  ('Level 1 Practitioner Foundations', 'level_1', 'Introduction to energy reading, basic clearing techniques, and client intake processes.', 'planning', 0),
  ('Level 2 Advanced Clearing', 'level_2', 'Deep attachment work, cord removal, house clearing protocols, distance healing.', 'planning', 0),
  ('Protection Work Specialist', 'specialized', 'Shields, cords, entity boundaries. Full protection framework for practitioners and clients.', 'planning', 0),
  ('House & Space Clearing', 'specialized', 'Environmental energy assessment, clearing rooms and properties, ongoing maintenance protocols.', 'planning', 0)
ON CONFLICT DO NOTHING;

-- ── SEED: Research Opportunities ─────────────────────────────
INSERT INTO research_opportunities (title, description, opportunity_type, status) VALUES
  ('Attachment Recurrence Rate Study', 'Investigate the rate at which clients experience reattachment after clearing sessions. What environmental or behavioral factors correlate?', 'future_study', 'open'),
  ('Dream Pattern to Outcome Correlation', 'Cross-reference clients who report recurring dreams in intake with session outcomes. Do specific dream types predict session type?', 'pattern_investigation', 'open'),
  ('Distance vs. In-Person Outcome Analysis', 'Compare state_before / state_after scores for distance healing sessions versus in-person. Statistical significance?', 'outcome_analysis', 'open'),
  ('Relationship Issue Resolution Timelines', 'Track clients presenting with relationship concerns: how many sessions until resolution? What recommendations correlate with fastest outcomes?', 'pattern_investigation', 'open')
ON CONFLICT DO NOTHING;
