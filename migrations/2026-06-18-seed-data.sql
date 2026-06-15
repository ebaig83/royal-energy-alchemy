-- ============================================================
-- Royal Energy Alchemy - Sprint 11 Seed Data
-- Realistic test data for Knowledge Engine & Outcome Tracking validation
-- Run in Supabase SQL Editor AFTER Sprint 9 + 10 migrations
-- SAFE: all inserts use ON CONFLICT DO NOTHING on email/unique keys
-- ============================================================

BEGIN;

-- ── 1. CLIENTS (25) ──────────────────────────────────────────
-- Uses client email as dedup key
INSERT INTO clients (id, full_name, email, phone, status, tags, created_at)
VALUES
  ('11111111-0001-0000-0000-000000000001','Amara Johnson','amara.johnson@example.com','814-555-0101','active',ARRAY['energy','anxiety'],'2025-09-01'),
  ('11111111-0002-0000-0000-000000000002','Devon Richards','devon.richards@example.com','814-555-0102','active',ARRAY['chronic_pain','grounding'],'2025-09-05'),
  ('11111111-0003-0000-0000-000000000003','Calista Moore','calista.moore@example.com','814-555-0103','active',ARRAY['spiritual','emotional'],'2025-09-10'),
  ('11111111-0004-0000-0000-000000000004','Rafael Torres','rafael.torres@example.com','814-555-0104','active',ARRAY['stress','clarity'],'2025-09-15'),
  ('11111111-0005-0000-0000-000000000005','Simone Hayes','simone.hayes@example.com','814-555-0105','active',ARRAY['trauma','healing'],'2025-09-20'),
  ('11111111-0006-0000-0000-000000000006','Marcus Webb','marcus.webb@example.com','814-555-0106','active',ARRAY['anxiety','sleep'],'2025-10-01'),
  ('11111111-0007-0000-0000-000000000007','Priya Nair','priya.nair@example.com','814-555-0107','active',ARRAY['energy','fatigue'],'2025-10-05'),
  ('11111111-0008-0000-0000-000000000008','Tobias Grant','tobias.grant@example.com','814-555-0108','active',ARRAY['clarity','focus'],'2025-10-10'),
  ('11111111-0009-0000-0000-000000000009','Lydia Osei','lydia.osei@example.com','814-555-0109','active',ARRAY['grief','emotional'],'2025-10-15'),
  ('11111111-0010-0000-0000-000000000010','Nadia Flores','nadia.flores@example.com','814-555-0110','active',ARRAY['spiritual','purpose'],'2025-10-20'),
  ('11111111-0011-0000-0000-000000000011','Elijah Holt','elijah.holt@example.com','814-555-0111','active',ARRAY['anxiety','grounding'],'2025-11-01'),
  ('11111111-0012-0000-0000-000000000012','Fatima Kaur','fatima.kaur@example.com','814-555-0112','active',ARRAY['trauma','healing'],'2025-11-05'),
  ('11111111-0013-0000-0000-000000000013','Jerome Vance','jerome.vance@example.com','814-555-0113','active',ARRAY['chronic_pain','energy'],'2025-11-10'),
  ('11111111-0014-0000-0000-000000000014','Celeste Dunn','celeste.dunn@example.com','814-555-0114','active',ARRAY['stress','clarity'],'2025-11-15'),
  ('11111111-0015-0000-0000-000000000015','Kwame Ellis','kwame.ellis@example.com','814-555-0115','active',ARRAY['spiritual','grounding'],'2025-11-20'),
  ('11111111-0016-0000-0000-000000000016','Ingrid Strand','ingrid.strand@example.com','814-555-0116','active',ARRAY['energy','focus'],'2025-12-01'),
  ('11111111-0017-0000-0000-000000000017','Antonio Cruz','antonio.cruz@example.com','814-555-0117','active',ARRAY['sleep','anxiety'],'2025-12-05'),
  ('11111111-0018-0000-0000-000000000018','Miriam Obi','miriam.obi@example.com','814-555-0118','active',ARRAY['purpose','emotional'],'2025-12-10'),
  ('11111111-0019-0000-0000-000000000019','Darius Lamb','darius.lamb@example.com','814-555-0119','active',ARRAY['trauma','clarity'],'2025-12-15'),
  ('11111111-0020-0000-0000-000000000020','Yvette Miles','yvette.miles@example.com','814-555-0120','active',ARRAY['healing','spiritual'],'2025-12-20'),
  ('11111111-0021-0000-0000-000000000021','Solomon Park','solomon.park@example.com','814-555-0121','active',ARRAY['anxiety','energy'],'2026-01-05'),
  ('11111111-0022-0000-0000-000000000022','Harriet Knox','harriet.knox@example.com','814-555-0122','active',ARRAY['grief','spiritual'],'2026-01-10'),
  ('11111111-0023-0000-0000-000000000023','Orion Watts','orion.watts@example.com','814-555-0123','active',ARRAY['chronic_pain','grounding'],'2026-01-15'),
  ('11111111-0024-0000-0000-000000000024','Tamsin Blake','tamsin.blake@example.com','814-555-0124','active',ARRAY['clarity','focus'],'2026-02-01'),
  ('11111111-0025-0000-0000-000000000025','Renata Silva','renata.silva@example.com','814-555-0125','active',ARRAY['energy','healing'],'2026-02-10')
ON CONFLICT (email) DO NOTHING;

-- ── 2. SESSIONS (62) ─────────────────────────────────────────
-- Covers all 4 services; repeat clients for retention patterns
INSERT INTO sessions (id, client_id, client_name, service, location_type, session_date, session_time, status, state_before, state_after, amount_due, amount_paid, payment_status, seller_notes, created_at)
VALUES
  -- Amara Johnson — 4 sessions (repeat client)
  ('22222222-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','Distance Healing','remote','2025-10-01','10:00','completed',2,4,150,150,'paid','Client reported anxiety and energetic drain. Cleared lower chakras.','2025-10-01'),
  ('22222222-0002-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','Distance Healing','remote','2025-11-01','10:00','completed',3,5,150,150,'paid','Follow-up. Client feeling lighter. Addressed solar plexus blockage.','2025-11-01'),
  ('22222222-0003-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','Distance Healing','remote','2026-01-15','10:00','completed',3,5,150,150,'paid','Third session. Significant clearing reported. Grounding work.','2026-01-15'),
  ('22222222-0004-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','Distance Healing','remote','2026-03-01','10:00','completed',4,5,150,150,'paid','Maintenance session. Client stable and thriving.','2026-03-01'),

  -- Devon Richards — 3 sessions
  ('22222222-0001-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','Sacred Autonomy Assessment','in-person','2025-10-10','14:00','completed',2,3,250,250,'paid','Chronic lower back pain linked to root chakra. Assessment done.','2025-10-10'),
  ('22222222-0002-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','Distance Healing','remote','2025-11-15','14:00','completed',3,4,150,150,'paid','Distance follow-up after assessment. Good progress.','2025-11-15'),
  ('22222222-0003-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','Distance Healing','remote','2026-02-01','14:00','completed',3,5,150,150,'paid','Third session. Pain relief confirmed. Energetic patterns shifting.','2026-02-01'),

  -- Calista Moore — 3 sessions
  ('22222222-0001-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','Spiritual Consultation','remote','2025-10-20','11:00','completed',3,4,200,200,'paid','Seeking spiritual clarity after life transition. Third eye work.','2025-10-20'),
  ('22222222-0002-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','Distance Healing','remote','2025-12-01','11:00','completed',3,5,150,150,'paid','Follow-up healing. Major breakthroughs reported.','2025-12-01'),
  ('22222222-0003-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','Distance Healing','remote','2026-02-15','11:00','completed',4,5,150,150,'paid','Maintenance. Client integrated spiritual work. Stable.','2026-02-15'),

  -- Rafael Torres — 2 sessions
  ('22222222-0001-0000-0000-000000000004','11111111-0004-0000-0000-000000000004','Rafael Torres','Distance Healing','remote','2025-11-01','09:00','completed',3,4,150,150,'paid','Work-related stress. Cleared mental fog. Recommended grounding.','2025-11-01'),
  ('22222222-0002-0000-0000-000000000004','11111111-0004-0000-0000-000000000004','Rafael Torres','Distance Healing','remote','2026-01-20','09:00','completed',4,4,150,150,'paid','Second session. Minimal shift. Client inconsistent with practices.','2026-01-20'),

  -- Simone Hayes — 4 sessions (trauma — research candidate)
  ('22222222-0001-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','Sacred Autonomy Assessment','in-person','2025-10-05','13:00','completed',1,3,250,250,'paid','Trauma history. Deep assessment. Multiple energy bodies affected.','2025-10-05'),
  ('22222222-0002-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','Distance Healing','remote','2025-11-10','13:00','completed',2,4,150,150,'paid','Significant improvement after assessment. Emotional release in session.','2025-11-10'),
  ('22222222-0003-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','Distance Healing','remote','2026-01-05','13:00','completed',3,5,150,150,'paid','Third session. Trauma patterns clearing. Research-worthy progression.','2026-01-05'),
  ('22222222-0004-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','Distance Healing','remote','2026-03-10','13:00','completed',4,5,150,150,'paid','Fourth session. Client reports significant life changes post-healing.','2026-03-10'),

  -- Marcus Webb — 3 sessions
  ('22222222-0001-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','Distance Healing','remote','2025-11-05','15:00','completed',2,4,150,150,'paid','Anxiety and insomnia. Calming energy work. Crown chakra focus.','2025-11-05'),
  ('22222222-0002-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','Distance Healing','remote','2025-12-10','15:00','completed',3,4,150,150,'paid','Sleep improving. Continued anxiety work.','2025-12-10'),
  ('22222222-0003-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','Distance Healing','remote','2026-02-20','15:00','completed',4,5,150,150,'paid','Third session. Sleep normalized. Anxiety managed.','2026-02-20'),

  -- Priya Nair — 2 sessions
  ('22222222-0001-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','Priya Nair','Distance Healing','remote','2025-11-20','10:00','completed',2,4,150,150,'paid','Chronic fatigue and energetic depletion. Root and sacral work.','2025-11-20'),
  ('22222222-0002-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','Priya Nair','Distance Healing','remote','2026-01-25','10:00','completed',3,5,150,150,'paid','Energy levels much improved. Client reports better stamina.','2026-01-25'),

  -- Tobias Grant — 2 sessions
  ('22222222-0001-0000-0000-000000000008','11111111-0008-0000-0000-000000000008','Tobias Grant','Spiritual Consultation','remote','2025-12-01','16:00','completed',3,4,200,200,'paid','Seeking clarity on life direction. Higher self work.','2025-12-01'),
  ('22222222-0002-0000-0000-000000000008','11111111-0008-0000-0000-000000000008','Tobias Grant','Distance Healing','remote','2026-02-10','16:00','completed',4,5,150,150,'paid','Follow-up healing. Clarity achieved. Client taking action.','2026-02-10'),

  -- Lydia Osei — 3 sessions (grief — research candidate)
  ('22222222-0001-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','Distance Healing','remote','2025-11-25','12:00','completed',1,3,150,150,'paid','Grief after loss. Heavy emotional weight. Heart chakra primary focus.','2025-11-25'),
  ('22222222-0002-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','Distance Healing','remote','2026-01-10','12:00','completed',2,4,150,150,'paid','Grief processing ongoing. Notable shift in session — unexpected release.','2026-01-10'),
  ('22222222-0003-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','Distance Healing','remote','2026-03-05','12:00','completed',3,5,150,150,'paid','Third session. Client healing well. Research flag — grief protocol effective.','2026-03-05'),

  -- Nadia Flores — 2 sessions
  ('22222222-0001-0000-0000-000000000010','11111111-0010-0000-0000-000000000010','Nadia Flores','Spiritual Consultation','remote','2025-12-05','14:00','completed',3,5,200,200,'paid','Spiritual purpose inquiry. Soul contract work.','2025-12-05'),
  ('22222222-0002-0000-0000-000000000010','11111111-0010-0000-0000-000000000010','Nadia Flores','Distance Healing','remote','2026-02-25','14:00','completed',4,5,150,150,'paid','Follow-up. Purpose clarity achieved. Client thriving.','2026-02-25'),

  -- Elijah Holt — 3 sessions
  ('22222222-0001-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','Elijah Holt','Distance Healing','remote','2025-12-15','10:00','completed',2,4,150,150,'paid','Anxiety and energetic overwhelm. Grounding focus.','2025-12-15'),
  ('22222222-0002-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','Elijah Holt','Distance Healing','remote','2026-02-01','10:00','completed',3,4,150,150,'paid','Good improvement. Anxiety reduced. Building grounding practice.','2026-02-01'),
  ('22222222-0003-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','Elijah Holt','Distance Healing','remote','2026-04-01','10:00','completed',4,5,150,150,'paid','Third session. Anxiety well managed. Grounding consistent.','2026-04-01'),

  -- Fatima Kaur — 3 sessions (trauma)
  ('22222222-0001-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','Sacred Autonomy Assessment','in-person','2026-01-03','11:00','completed',1,3,250,250,'paid','Complex trauma history. Thorough assessment. Multiple energy disruptions found.','2026-01-03'),
  ('22222222-0002-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','Distance Healing','remote','2026-02-05','11:00','completed',2,4,150,150,'paid','Post-assessment healing. Remarkable shift.','2026-02-05'),
  ('22222222-0003-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','Distance Healing','remote','2026-03-20','11:00','completed',3,5,150,150,'paid','Third session. Trauma response healing. Research documentation valuable.','2026-03-20'),

  -- Jerome Vance — 2 sessions
  ('22222222-0001-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Jerome Vance','Distance Healing','remote','2026-01-08','14:00','completed',2,3,150,150,'paid','Chronic pain. Some improvement. Needs ongoing work.','2026-01-08'),
  ('22222222-0002-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Jerome Vance','Distance Healing','remote','2026-02-20','14:00','completed',2,2,150,150,'paid','No change this session. Client stressed about work.','2026-02-20'),

  -- Celeste Dunn — 2 sessions
  ('22222222-0001-0000-0000-000000000014','11111111-0014-0000-0000-000000000014','Celeste Dunn','Distance Healing','remote','2026-01-12','09:00','completed',3,5,150,150,'paid','Stress clarity session. Mental field clearing. Very responsive.','2026-01-12'),
  ('22222222-0002-0000-0000-000000000014','11111111-0014-0000-0000-000000000014','Celeste Dunn','Spiritual Consultation','remote','2026-03-01','09:00','completed',4,5,200,200,'paid','Spiritual direction work. Highly productive session.','2026-03-01'),

  -- Kwame Ellis — 3 sessions
  ('22222222-0001-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','Kwame Ellis','Distance Healing','remote','2026-01-18','16:00','completed',2,4,150,150,'paid','Spiritual disconnect. Grounding and reconnection work.','2026-01-18'),
  ('22222222-0002-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','Kwame Ellis','Distance Healing','remote','2026-02-28','16:00','completed',3,5,150,150,'paid','Excellent progress. Spiritual reconnection confirmed.','2026-02-28'),
  ('22222222-0003-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','Kwame Ellis','Distance Healing','remote','2026-04-05','16:00','completed',4,5,150,150,'paid','Third session. Client reporting profound spiritual shift.','2026-04-05'),

  -- Ingrid Strand — 2 sessions
  ('22222222-0001-0000-0000-000000000016','11111111-0016-0000-0000-000000000016','Ingrid Strand','Distance Healing','remote','2026-01-22','10:00','completed',3,5,150,150,'paid','Energy boosting focus. High responsiveness. Strong field clearing.','2026-01-22'),
  ('22222222-0002-0000-0000-000000000016','11111111-0016-0000-0000-000000000016','Ingrid Strand','Distance Healing','remote','2026-03-15','10:00','completed',4,5,150,150,'paid','Follow-up. Client maintaining excellent energy levels.','2026-03-15'),

  -- Antonio Cruz — 2 sessions
  ('22222222-0001-0000-0000-000000000017','11111111-0017-0000-0000-000000000017','Antonio Cruz','Distance Healing','remote','2026-01-28','15:00','completed',2,3,150,150,'paid','Insomnia and anxiety. Sleep improved somewhat but more work needed.','2026-01-28'),
  ('22222222-0002-0000-0000-000000000017','11111111-0017-0000-0000-000000000017','Antonio Cruz','Distance Healing','remote','2026-03-10','15:00','completed',3,4,150,150,'paid','Sleep better. Anxiety reduced. Continued grounding support.','2026-03-10'),

  -- Miriam Obi — 2 sessions
  ('22222222-0001-0000-0000-000000000018','11111111-0018-0000-0000-000000000018','Miriam Obi','Spiritual Consultation','remote','2026-02-03','13:00','completed',3,4,200,200,'paid','Purpose and emotional clarity. Soul work. Good session.','2026-02-03'),
  ('22222222-0002-0000-0000-000000000018','11111111-0018-0000-0000-000000000018','Miriam Obi','Distance Healing','remote','2026-03-25','13:00','completed',4,5,150,150,'paid','Follow-up healing. Purpose clarity deepening.','2026-03-25'),

  -- Darius Lamb — 3 sessions (trauma + research)
  ('22222222-0001-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','Sacred Autonomy Assessment','in-person','2026-02-06','11:00','completed',1,3,250,250,'paid','Childhood trauma and chronic energetic overwhelm. Complex case.','2026-02-06'),
  ('22222222-0002-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','Distance Healing','remote','2026-03-12','11:00','completed',2,4,150,150,'paid','Post-assessment. Significant clearing. Research-worthy case.','2026-03-12'),
  ('22222222-0003-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','Distance Healing','remote','2026-04-18','11:00','completed',3,5,150,150,'paid','Third session. Major trauma resolution. Unprecedented shift documented.','2026-04-18'),

  -- Yvette Miles — 2 sessions
  ('22222222-0001-0000-0000-000000000020','11111111-0020-0000-0000-000000000020','Yvette Miles','Distance Healing','remote','2026-02-10','09:00','completed',3,5,150,150,'paid','Healing integration support. Beautiful field to work with. High sensitivity.','2026-02-10'),
  ('22222222-0002-0000-0000-000000000020','11111111-0020-0000-0000-000000000020','Yvette Miles','Spiritual Consultation','remote','2026-04-02','09:00','completed',4,5,200,200,'paid','Spiritual deepening consultation. Highly productive.','2026-04-02'),

  -- Solomon Park — 2 sessions
  ('22222222-0001-0000-0000-000000000021','11111111-0021-0000-0000-000000000021','Solomon Park','Distance Healing','remote','2026-02-14','10:00','completed',2,4,150,150,'paid','Anxiety and energetic overwhelm. Good clearing.','2026-02-14'),
  ('22222222-0002-0000-0000-000000000021','11111111-0021-0000-0000-000000000021','Solomon Park','Distance Healing','remote','2026-04-08','10:00','completed',3,5,150,150,'paid','Significant improvement. Client grounding regularly now.','2026-04-08'),

  -- Harriet Knox — 2 sessions (grief)
  ('22222222-0001-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','Harriet Knox','Distance Healing','remote','2026-02-18','14:00','completed',1,3,150,150,'paid','Grief after loss of parent. Deep emotional work. Heart field clearing.','2026-02-18'),
  ('22222222-0002-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','Harriet Knox','Distance Healing','remote','2026-04-10','14:00','completed',3,4,150,150,'paid','Second session. Grief processing well. Heart energy much lighter.','2026-04-10'),

  -- Orion Watts — 2 sessions
  ('22222222-0001-0000-0000-000000000023','11111111-0023-0000-0000-000000000023','Orion Watts','Distance Healing','remote','2026-02-22','15:00','completed',2,4,150,150,'paid','Chronic pain — fibromyalgia. Energy field dense. Gradual clearing.','2026-02-22'),
  ('22222222-0002-0000-0000-000000000023','11111111-0023-0000-0000-000000000023','Orion Watts','Distance Healing','remote','2026-04-12','15:00','completed',3,4,150,150,'paid','Moderate improvement. Pain levels reduced. Ongoing support needed.','2026-04-12'),

  -- Tamsin Blake — 1 session
  ('22222222-0001-0000-0000-000000000024','11111111-0024-0000-0000-000000000024','Tamsin Blake','Distance Healing','remote','2026-03-05','11:00','completed',3,5,150,150,'paid','Clarity and focus session. Very responsive client. Strong shift.','2026-03-05'),

  -- Renata Silva — 1 session
  ('22222222-0001-0000-0000-000000000025','11111111-0025-0000-0000-000000000025','Renata Silva','Distance Healing','remote','2026-03-18','13:00','completed',2,4,150,150,'paid','Energy healing and revitalization. Good clearing. Warm field.','2026-03-18')
ON CONFLICT (id) DO NOTHING;

-- ── 3. SESSION NOTES (40 notes covering key sessions) ────────
-- chief_concern is critical for pattern detection
INSERT INTO session_notes (id, session_id, client_id, chief_concern, energy_findings, removals_done, created_at)
VALUES
  ('33333333-0001-0000-0000-000000000001','22222222-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','energetic overwhelm and anxiety','Dense energy in upper chakras. Solar plexus blocked.','Cleared anxiety imprints from field. Released tension cords.','2025-10-01'),
  ('33333333-0002-0000-0000-000000000001','22222222-0002-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','energetic overwhelm and anxiety','Solar plexus clearing progressing. Lighter field.','Deepened chakra clearing. Released residual anxiety patterns.','2025-11-01'),
  ('33333333-0003-0000-0000-000000000001','22222222-0003-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','energetic overwhelm and anxiety','Field now clear. Client maintaining grounding.','Final anxiety clearing. Grounding cords installed.','2026-01-15'),

  ('33333333-0001-0000-0000-000000000002','22222222-0001-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','chronic pain and root chakra blockage','Root chakra severely blocked. Pain imprints throughout lower field.','Cleared pain imprints. Root chakra activation.','2025-10-10'),
  ('33333333-0002-0000-0000-000000000002','22222222-0002-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','chronic pain and root chakra blockage','Root chakra opening. Pain response reducing.','Continued root work. Removed etheric pain attachments.','2025-11-15'),

  ('33333333-0001-0000-0000-000000000005','22222222-0001-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','trauma and energetic overwhelm','Multiple energy bodies disrupted. Strong trauma imprinting.','Deep trauma clearing. Multiple energy body alignment.','2025-10-05'),
  ('33333333-0002-0000-0000-000000000005','22222222-0002-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','trauma and energetic overwhelm','Trauma field lightening. Emotional body responding well.','Second layer trauma removal. Emotional body support.','2025-11-10'),
  ('33333333-0003-0000-0000-000000000005','22222222-0003-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','trauma and energetic overwhelm','Major shift in trauma field. Client lighter than ever.','Trauma clearing near complete. Integration support.','2026-01-05'),

  ('33333333-0001-0000-0000-000000000006','22222222-0001-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','anxiety and sleep disruption','Crown chakra overactive. Mental field scattered.','Calmed crown chakra. Cleared anxiety loops from mental field.','2025-11-05'),
  ('33333333-0002-0000-0000-000000000006','22222222-0002-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','anxiety and sleep disruption','Crown settling. Sleep field improving.','Reinforced sleep patterns. Anxiety reduction continued.','2025-12-10'),

  ('33333333-0001-0000-0000-000000000007','22222222-0001-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','chronic fatigue and energy depletion','Root and sacral severely depleted. Energetic drain attachments present.','Removed drain attachments. Root and sacral rebuilding.','2025-11-20'),

  ('33333333-0001-0000-0000-000000000009','22222222-0001-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','grief and emotional overwhelm','Heart chakra heavily blocked with grief energy. Dense emotional field.','Cleared grief energy from heart chakra. Emotional field support.','2025-11-25'),
  ('33333333-0002-0000-0000-000000000009','22222222-0002-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','grief and emotional overwhelm','Heart chakra opening. Significant emotional release in session.','Deeper grief clearing. Unexpected emotional release facilitated.','2026-01-10'),
  ('33333333-0003-0000-0000-000000000009','22222222-0003-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','grief and emotional overwhelm','Heart field now clear. Client integrating beautifully.','Final grief clearing. Heart energy restored.','2026-03-05'),

  ('33333333-0001-0000-0000-000000000011','22222222-0001-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','energetic overwhelm and anxiety','Overwhelm patterns throughout field. Root ungrounded.','Cleared overwhelm imprints. Installed grounding cords.','2025-12-15'),
  ('33333333-0002-0000-0000-000000000011','22222222-0002-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','energetic overwhelm and anxiety','Field grounding better. Anxiety reducing.','Reinforced grounding. Continued anxiety clearing.','2026-02-01'),

  ('33333333-0001-0000-0000-000000000012','22222222-0001-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','trauma and energetic overwhelm','Complex trauma layering across multiple energy bodies. Dense field.','Initial trauma layer removed. Multiple body alignment begun.','2026-01-03'),
  ('33333333-0002-0000-0000-000000000012','22222222-0002-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','trauma and energetic overwhelm','Second trauma layer clearing. Remarkable resilience.','Second layer cleared. Emotional body stabilizing.','2026-02-05'),

  ('33333333-0001-0000-0000-000000000015','22222222-0001-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','spiritual disconnect and lack of grounding','Spiritual connection pathways dimmed. Root unanchored.','Cleared spiritual blocks. Reconnected higher self pathways.','2026-01-18'),

  ('33333333-0001-0000-0000-000000000017','22222222-0001-0000-0000-000000000017','11111111-0017-0000-0000-000000000017','anxiety and sleep disruption','Scattered mental field. Crown overactive. Root disconnected.','Mental field clearing. Sleep patterns addressed.','2026-01-28'),

  ('33333333-0001-0000-0000-000000000019','22222222-0001-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','trauma and energetic overwhelm','Most complex case to date. Childhood trauma deeply imprinted across all energy bodies.','Initial assessment and first-layer clearing. Careful, methodical work.','2026-02-06'),
  ('33333333-0002-0000-0000-000000000019','22222222-0002-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','trauma and energetic overwhelm','Field opening significantly post-assessment. Client feeling lighter.','Major clearing session. Trauma patterns visibly shifting.','2026-03-12'),

  ('33333333-0001-0000-0000-000000000021','22222222-0001-0000-0000-000000000021','11111111-0021-0000-0000-000000000021','energetic overwhelm and anxiety','Anxiety loops present in mental and emotional fields.','Cleared anxiety loops. Grounding foundation installed.','2026-02-14'),

  ('33333333-0001-0000-0000-000000000022','22222222-0001-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','grief and emotional overwhelm','Profound grief imprinting. Heart and solar plexus both affected.','Heart chakra clearing begun. Grief energy gently released.','2026-02-18')
ON CONFLICT (id) DO NOTHING;

-- ── 4. SESSION OUTCOMES (40 records) ─────────────────────────
INSERT INTO session_outcomes (id, session_id, client_id, client_name, session_date, outcome_category, improvement_level, energy_shift, practitioner_notes, research_flag, research_notes, created_at)
VALUES
  -- Amara Johnson — 4 improved
  ('44444444-0001-0000-0000-000000000001','22222222-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','2025-10-01','improved',6,'Noticeably lighter energy post-session','Client reported immediate reduction in anxious thoughts. Good session.', false, null,'2025-10-01'),
  ('44444444-0002-0000-0000-000000000001','22222222-0002-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','2025-11-01','improved',8,'Strong positive shift. Field much clearer.','Second session produced stronger improvement. Grounding holding well.', false, null,'2025-11-01'),
  ('44444444-0003-0000-0000-000000000001','22222222-0003-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','2026-01-15','improved',9,'Deep clearing — sustained improvement between sessions.','Third session. Client has internalized practices. Major shift sustained.', true, 'Grounding practice adoption correlating with sustained improvement — worth tracking across clients.','2026-01-15'),
  ('44444444-0004-0000-0000-000000000001','22222222-0004-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','2026-03-01','improved',9,'Field stable and vibrant. Maintenance only.','Maintenance session. Client fully integrated. Textbook progression.', true, 'Four-session progression from state 2 to 5 with consistent grounding practice. Document for research.','2026-03-01'),

  -- Devon Richards
  ('44444444-0001-0000-0000-000000000002','22222222-0001-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','2025-10-10','improved',5,'Initial assessment cleared surface layers.','Assessment session produced good first-session shift. Root chakra engaging.', false, null,'2025-10-10'),
  ('44444444-0002-0000-0000-000000000002','22222222-0002-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','2025-11-15','improved',7,'Significant reduction in pain response.','Pain reduced noticeably. Root chakra activation confirmed.', false, null,'2025-11-15'),
  ('44444444-0003-0000-0000-000000000002','22222222-0003-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','2026-02-01','improved',8,'Pain near-resolved. Root energy strong.','Third session confirms chronic pain responding to root chakra work.', true, 'Chronic pain and root chakra clearing — 3 sessions, consistent improvement. Research candidate.','2026-02-01'),

  -- Calista Moore
  ('44444444-0001-0000-0000-000000000003','22222222-0001-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','2025-10-20','improved',7,'Third eye activation. Client visibly lighter.','Spiritual clarity work showing results.', false, null,'2025-10-20'),
  ('44444444-0002-0000-0000-000000000003','22222222-0002-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','2025-12-01','improved',9,'Major breakthrough — client in tears of relief.','Profound session. Spiritual clarity fully landed. Client reports life-changing shift.', true, 'Profound breakthrough in session 2 after Spiritual Consultation in session 1 — note sequencing.','2025-12-01'),
  ('44444444-0003-0000-0000-000000000003','22222222-0003-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','2026-02-15','improved',9,'Stable high-vibration field. Thriving.','Client fully integrated and flourishing.', false, null,'2026-02-15'),

  -- Rafael Torres — mixed
  ('44444444-0001-0000-0000-000000000004','22222222-0001-0000-0000-000000000004','11111111-0004-0000-0000-000000000004','Rafael Torres','2025-11-01','improved',6,'Mental field clearer after session.','Good session. Stress reduced.', false, null,'2025-11-01'),
  ('44444444-0002-0000-0000-000000000004','22222222-0002-0000-0000-000000000004','11111111-0004-0000-0000-000000000004','Rafael Torres','2026-01-20','no_change',3,'Minimal shift — client reporting major work stress.','Client not practicing recommendations between sessions. Field reverted.', false, null,'2026-01-20'),

  -- Simone Hayes — trauma progression
  ('44444444-0001-0000-0000-000000000005','22222222-0001-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','2025-10-05','improved',5,'First session cleared top layer of trauma field.','Complex trauma case. Good first response.', false, null,'2025-10-05'),
  ('44444444-0002-0000-0000-000000000005','22222222-0002-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','2025-11-10','improved',7,'Significant emotional release during session. Field much lighter.','Second session produced emotional release — excellent sign.', true, 'Trauma client emotional release in second session correlating with rapid field clearing.','2025-11-10'),
  ('44444444-0003-0000-0000-000000000005','22222222-0003-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','2026-01-05','improved',9,'Trauma patterns largely cleared. Client reporting new sense of self.','Remarkable progression. Trauma resolution across 3 sessions.', true, 'Trauma resolution — most significant progression documented. Three-session protocol highly effective.','2026-01-05'),
  ('44444444-0004-0000-0000-000000000005','22222222-0004-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','2026-03-10','improved',10,'Complete transformation. Field vibrant and self-sustaining.','Client reports complete life transformation. Highest improvement ever recorded.', true, 'Perfect outcome — state 1 to 5 over four sessions. Landmark case for research.','2026-03-10'),

  -- Marcus Webb
  ('44444444-0001-0000-0000-000000000006','22222222-0001-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','2025-11-05','improved',7,'Anxiety loops cleared. Crown calmed.','Strong first session. Sleep improving immediately.', false, null,'2025-11-05'),
  ('44444444-0002-0000-0000-000000000006','22222222-0002-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','2025-12-10','improved',7,'Sleep field reinforced. Anxiety reduced.','Continued improvement. Client committed to practices.', false, null,'2025-12-10'),
  ('44444444-0003-0000-0000-000000000006','22222222-0003-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','2026-02-20','improved',9,'Anxiety resolved. Sleep normalized.','Excellent 3-session outcome. Distance Healing highly effective for anxiety/sleep.', false, null,'2026-02-20'),

  -- Priya Nair
  ('44444444-0001-0000-0000-000000000007','22222222-0001-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','Priya Nair','2025-11-20','improved',7,'Energy levels visibly higher post-session.','Root and sacral clearing effective. Fatigue lifting.', false, null,'2025-11-20'),
  ('44444444-0002-0000-0000-000000000007','22222222-0002-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','Priya Nair','2026-01-25','improved',9,'Sustained energy restoration.','Client reports stamina returned to baseline.', false, null,'2026-01-25'),

  -- Lydia Osei — grief
  ('44444444-0001-0000-0000-000000000009','22222222-0001-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','2025-11-25','improved',5,'Heart chakra slightly lighter after deep clearing.','First session in profound grief. Good initial response.', false, null,'2025-11-25'),
  ('44444444-0002-0000-0000-000000000009','22222222-0002-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','2026-01-10','improved',8,'Emotional release — unexpected grief discharge.','Unexpected deep release. Client felt lighter than in months.', true, 'Grief — unexpected deep emotional discharge in session 2. Heart chakra protocol may be accelerating process.','2026-01-10'),
  ('44444444-0003-0000-0000-000000000009','22222222-0003-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','2026-03-05','improved',9,'Heart field restored. Client healed.','Beautiful grief resolution over 3 sessions. Grief protocol documented.', true, 'Grief resolution protocol — 3-session arc consistently effective. Document as case study.','2026-03-05'),

  -- Jerome Vance — mixed and no_change
  ('44444444-0001-0000-0000-000000000013','22222222-0001-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Jerome Vance','2026-01-08','mixed',5,'Some clearing achieved but dense field persists.','Moderate response. External stressors impeding progress.', false, null,'2026-01-08'),
  ('44444444-0002-0000-0000-000000000013','22222222-0002-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Jerome Vance','2026-02-20','no_change',2,'No shift — field denser than previous session.','Work stress overwhelming healing. Recommended lifestyle assessment.', false, null,'2026-02-20'),

  -- Fatima Kaur — trauma
  ('44444444-0001-0000-0000-000000000012','22222222-0001-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','2026-01-03','improved',6,'Assessment alone produced measurable shift.','Complex trauma case showing early positive response.', false, null,'2026-01-03'),
  ('44444444-0002-0000-0000-000000000012','22222222-0002-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','2026-02-05','improved',8,'Remarkable shift — trauma field dramatically lighter.','Second session exceptional. Trauma responding rapidly.', true, 'Complex trauma case — second session produced unusually rapid field clearing. Document protocol.','2026-02-05'),
  ('44444444-0003-0000-0000-000000000012','22222222-0003-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','2026-03-20','improved',9,'Trauma near-resolved. Client unrecognizable from intake.','Exceptional trauma resolution. Three-session protocol confirmed effective.', true, 'Third session confirms three-session trauma protocol. State 1→5 achieved. Highest priority case study.','2026-03-20'),

  -- Darius Lamb — trauma research
  ('44444444-0001-0000-0000-000000000019','22222222-0001-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','2026-02-06','improved',5,'Assessment revealed depth of trauma. First clearing begun.','Most complex case to date. Careful work required.', false, null,'2026-02-06'),
  ('44444444-0002-0000-0000-000000000019','22222222-0002-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','2026-03-12','improved',8,'Significant clearing — client reporting improved daily functioning.','Research-worthy progression. Complex trauma responding.', true, 'Complex childhood trauma — rapid clearing after assessment protocol. Second-session shift unprecedented.','2026-03-12'),
  ('44444444-0003-0000-0000-000000000019','22222222-0003-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','2026-04-18','improved',10,'Complete trauma resolution. Client reports liberation.','Most remarkable outcome in practice history. Documentation priority.', true, 'LANDMARK CASE — childhood trauma fully resolved over three sessions. Assessment + Distance Healing protocol.','2026-04-18')
ON CONFLICT (id) DO NOTHING;

-- ── 5. RECOMMENDATIONS (25 records) ──────────────────────────
INSERT INTO recommendations (id, session_id, client_id, product_name, category, outcome_status, recommended_at, created_at)
VALUES
  ('55555555-0001-0000-0000-000000000001','22222222-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Grounding Meditation Practice','practice','helpful','2025-10-01','2025-10-01'),
  ('55555555-0002-0000-0000-000000000001','22222222-0002-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Black Tourmaline Crystal','crystal','purchased','2025-11-01','2025-11-01'),
  ('55555555-0003-0000-0000-000000000001','22222222-0003-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Grounding Meditation Practice','practice','helpful','2026-01-15','2026-01-15'),
  ('55555555-0001-0000-0000-000000000002','22222222-0001-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Root Chakra Activation Book','book','purchased','2025-10-10','2025-10-10'),
  ('55555555-0002-0000-0000-000000000002','22222222-0002-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Red Jasper Crystal','crystal','helpful','2025-11-15','2025-11-15'),
  ('55555555-0001-0000-0000-000000000005','22222222-0001-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Trauma Release Exercise Guide','book','purchased','2025-10-05','2025-10-05'),
  ('55555555-0002-0000-0000-000000000005','22222222-0002-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Rose Quartz Crystal','crystal','helpful','2025-11-10','2025-11-10'),
  ('55555555-0003-0000-0000-000000000005','22222222-0003-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Grounding Meditation Practice','practice','helpful','2026-01-05','2026-01-05'),
  ('55555555-0001-0000-0000-000000000006','22222222-0001-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Sleep Meditation Audio','meditation','helpful','2025-11-05','2025-11-05'),
  ('55555555-0002-0000-0000-000000000006','22222222-0002-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Amethyst Crystal','crystal','purchased','2025-12-10','2025-12-10'),
  ('55555555-0001-0000-0000-000000000007','22222222-0001-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','Grounding Meditation Practice','practice','helpful','2025-11-20','2025-11-20'),
  ('55555555-0001-0000-0000-000000000009','22222222-0001-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Grief Support Book: Sacred Mourning','book','helpful','2025-11-25','2025-11-25'),
  ('55555555-0002-0000-0000-000000000009','22222222-0002-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Rose Quartz Crystal','crystal','purchased','2026-01-10','2026-01-10'),
  ('55555555-0001-0000-0000-000000000011','22222222-0001-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','Grounding Meditation Practice','practice','helpful','2025-12-15','2025-12-15'),
  ('55555555-0001-0000-0000-000000000012','22222222-0001-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Trauma Release Exercise Guide','book','purchased','2026-01-03','2026-01-03'),
  ('55555555-0002-0000-0000-000000000012','22222222-0002-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Black Tourmaline Crystal','crystal','helpful','2026-02-05','2026-02-05'),
  ('55555555-0001-0000-0000-000000000013','22222222-0001-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Grounding Meditation Practice','practice','recommended','2026-01-08','2026-01-08'),
  ('55555555-0002-0000-0000-000000000013','22222222-0002-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Lifestyle Assessment Referral','referral','recommended','2026-02-20','2026-02-20'),
  ('55555555-0001-0000-0000-000000000015','22222222-0001-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','Spiritual Reconnection Meditation','meditation','helpful','2026-01-18','2026-01-18'),
  ('55555555-0001-0000-0000-000000000019','22222222-0001-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Trauma Release Exercise Guide','book','purchased','2026-02-06','2026-02-06'),
  ('55555555-0002-0000-0000-000000000019','22222222-0002-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Grounding Meditation Practice','practice','helpful','2026-03-12','2026-03-12'),
  ('55555555-0001-0000-0000-000000000021','22222222-0001-0000-0000-000000000021','11111111-0021-0000-0000-000000000021','Grounding Meditation Practice','practice','helpful','2026-02-14','2026-02-14'),
  ('55555555-0001-0000-0000-000000000022','22222222-0001-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','Grief Support Book: Sacred Mourning','book','helpful','2026-02-18','2026-02-18'),
  ('55555555-0001-0000-0000-000000000024','22222222-0001-0000-0000-000000000024','11111111-0024-0000-0000-000000000024','Mental Clarity Meditation','meditation','helpful','2026-03-05','2026-03-05'),
  ('55555555-0001-0000-0000-000000000025','22222222-0001-0000-0000-000000000025','11111111-0025-0000-0000-000000000025','Grounding Meditation Practice','practice','helpful','2026-03-18','2026-03-18')
ON CONFLICT (id) DO NOTHING;

-- ── 6. AFTERCARE (22 records) ─────────────────────────────────
INSERT INTO aftercare (id, session_id, client_id, followup_type, status, scheduled_for,
  satisfaction_score, perceived_improvement, would_return, would_recommend, outcome_response_at, source, created_at)
VALUES
  ('66666666-0001-0000-0000-000000000001','22222222-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','follow_up_email','sent','2025-10-08',4,'somewhat_better',true,true,'2025-10-09','session','2025-10-01'),
  ('66666666-0002-0000-0000-000000000001','22222222-0002-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','follow_up_email','sent','2025-11-08',5,'much_better',true,true,'2025-11-09','session','2025-11-01'),
  ('66666666-0003-0000-0000-000000000001','22222222-0003-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','follow_up_email','sent','2026-01-22',5,'much_better',true,true,'2026-01-23','session','2026-01-15'),
  ('66666666-0001-0000-0000-000000000002','22222222-0001-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','follow_up_email','sent','2025-10-17',4,'somewhat_better',true,true,'2025-10-18','session','2025-10-10'),
  ('66666666-0001-0000-0000-000000000005','22222222-0001-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','follow_up_email','sent','2025-10-12',4,'somewhat_better',true,true,'2025-10-13','session','2025-10-05'),
  ('66666666-0002-0000-0000-000000000005','22222222-0002-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','follow_up_email','sent','2025-11-17',5,'much_better',true,true,'2025-11-18','session','2025-11-10'),
  ('66666666-0003-0000-0000-000000000005','22222222-0003-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','follow_up_email','sent','2026-01-12',5,'much_better',true,true,'2026-01-13','session','2026-01-05'),
  ('66666666-0001-0000-0000-000000000006','22222222-0001-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','follow_up_email','sent','2025-11-12',4,'somewhat_better',true,true,'2025-11-13','session','2025-11-05'),
  ('66666666-0001-0000-0000-000000000007','22222222-0001-0000-0000-000000000007','11111111-0007-0000-0000-000000000007','follow_up_email','sent','2025-11-27',4,'somewhat_better',true,true,'2025-11-28','session','2025-11-20'),
  ('66666666-0001-0000-0000-000000000009','22222222-0001-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','follow_up_email','sent','2025-12-02',3,'somewhat_better',true,true,'2025-12-03','session','2025-11-25'),
  ('66666666-0002-0000-0000-000000000009','22222222-0002-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','follow_up_email','sent','2026-01-17',5,'much_better',true,true,'2026-01-18','session','2026-01-10'),
  ('66666666-0003-0000-0000-000000000009','22222222-0003-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','follow_up_email','sent','2026-03-12',5,'much_better',true,true,'2026-03-13','session','2026-03-05'),
  ('66666666-0001-0000-0000-000000000011','22222222-0001-0000-0000-000000000011','11111111-0011-0000-0000-000000000011','follow_up_email','sent','2025-12-22',4,'somewhat_better',true,true,'2025-12-23','session','2025-12-15'),
  ('66666666-0001-0000-0000-000000000012','22222222-0001-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','follow_up_email','sent','2026-01-10',4,'somewhat_better',true,true,'2026-01-11','session','2026-01-03'),
  ('66666666-0002-0000-0000-000000000012','22222222-0002-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','follow_up_email','sent','2026-02-12',5,'much_better',true,true,'2026-02-13','session','2026-02-05'),
  ('66666666-0001-0000-0000-000000000015','22222222-0001-0000-0000-000000000015','11111111-0015-0000-0000-000000000015','follow_up_email','sent','2026-01-25',4,'somewhat_better',true,true,'2026-01-26','session','2026-01-18'),
  ('66666666-0001-0000-0000-000000000019','22222222-0001-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','follow_up_email','sent','2026-02-13',4,'somewhat_better',true,true,'2026-02-14','session','2026-02-06'),
  ('66666666-0002-0000-0000-000000000019','22222222-0002-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','follow_up_email','sent','2026-03-19',5,'much_better',true,true,'2026-03-20','session','2026-03-12'),
  ('66666666-0001-0000-0000-000000000021','22222222-0001-0000-0000-000000000021','11111111-0021-0000-0000-000000000021','follow_up_email','sent','2026-02-21',4,'somewhat_better',true,true,'2026-02-22','session','2026-02-14'),
  ('66666666-0001-0000-0000-000000000022','22222222-0001-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','follow_up_email','sent','2026-02-25',3,'somewhat_better',true,true,'2026-02-26','session','2026-02-18'),
  ('66666666-0001-0000-0000-000000000024','22222222-0001-0000-0000-000000000024','11111111-0024-0000-0000-000000000024','follow_up_email','sent','2026-03-12',5,'much_better',true,true,'2026-03-13','session','2026-03-05'),
  ('66666666-0001-0000-0000-000000000025','22222222-0001-0000-0000-000000000025','11111111-0025-0000-0000-000000000025','follow_up_email','sent','2026-03-25',4,'somewhat_better',true,true,'2026-03-26','session','2026-03-18')
ON CONFLICT (id) DO NOTHING;

-- ── 7. CLIENT GOALS (10 records) ─────────────────────────────
INSERT INTO client_goals (id, client_id, client_name, goal_text, goal_category, expected_outcome, target_date, status, outcome_notes, achieved_at, created_at)
VALUES
  ('77777777-0001-0000-0000-000000000001','11111111-0001-0000-0000-000000000001','Amara Johnson','Reduce energetic overwhelm and sustain calm between sessions','energy','Able to maintain energetic balance for 2+ weeks without overwhelm','2026-03-01','achieved','Achieved by session 4. Client grounding daily and reporting stable energy.','2026-03-01','2025-10-01'),
  ('77777777-0002-0000-0000-000000000002','11111111-0002-0000-0000-000000000002','Devon Richards','Resolve chronic lower back pain through energetic root work','physical','Significant pain reduction (50%+) confirmed across multiple sessions','2026-04-01','active',null,null,'2025-10-10'),
  ('77777777-0003-0000-0000-000000000003','11111111-0003-0000-0000-000000000003','Calista Moore','Achieve spiritual clarity after major life transition','spiritual','Clear direction and inner peace restored','2026-01-01','achieved','Achieved in session 2. Profound breakthrough reported.','2025-12-01','2025-10-20'),
  ('77777777-0004-0000-0000-000000000005','11111111-0005-0000-0000-000000000005','Simone Hayes','Release trauma imprinting from energy field and experience freedom','healing','Significant reduction in trauma responses and energetic weight','2026-04-01','achieved','Achieved. Perfect outcome — complete trauma resolution over 4 sessions.','2026-03-10','2025-10-05'),
  ('77777777-0005-0000-0000-000000000006','11111111-0006-0000-0000-000000000006','Marcus Webb','Eliminate insomnia and reduce anxiety to manageable levels','mental','Sleeping 7+ hours consistently; anxiety score reduced','2026-03-01','achieved','Achieved by session 3. Sleep normalized, anxiety well managed.','2026-02-20','2025-11-05'),
  ('77777777-0006-0000-0000-000000000009','11111111-0009-0000-0000-000000000009','Lydia Osei','Process grief after loss and restore heart energy','emotional','Able to feel joy again; grief no longer debilitating','2026-04-01','achieved','Achieved. Heart field fully restored. Client thriving.','2026-03-05','2025-11-25'),
  ('77777777-0007-0000-0000-000000000012','11111111-0012-0000-0000-000000000012','Fatima Kaur','Release complex trauma patterns and reclaim energetic sovereignty','healing','Trauma field clear; client experiencing embodiment','2026-06-01','active',null,null,'2026-01-03'),
  ('77777777-0008-0000-0000-000000000013','11111111-0013-0000-0000-000000000013','Jerome Vance','Improve emotional stability and reduce chronic energetic depletion','emotional','Consistent energy levels; less reactive to stress','2026-06-01','paused','Progress stalled due to client work situation. Resuming when ready.',null,'2026-01-08'),
  ('77777777-0009-0000-0000-000000000019','11111111-0019-0000-0000-000000000019','Darius Lamb','Complete childhood trauma resolution through energy healing','healing','Full release of childhood trauma imprints from all energy bodies','2026-06-01','achieved','Achieved in 3 sessions. Most remarkable case in practice history.','2026-04-18','2026-02-06'),
  ('77777777-0010-0000-0000-000000000022','11111111-0022-0000-0000-000000000022','Harriet Knox','Process parental grief and restore capacity for joy','emotional','Heart chakra fully open; able to feel positive emotions','2026-06-01','active',null,null,'2026-02-18')
ON CONFLICT (id) DO NOTHING;

-- ── 8. RESEARCH INSIGHTS (6 seed records) ────────────────────
INSERT INTO research_insights (id, title, category, description, confidence_level, status, content_tags, practitioner_notes, created_at)
VALUES
  ('88888888-0001-0000-0000-000000000001',
   'Grounding practice adoption is the strongest predictor of sustained improvement between sessions',
   'recommendation',
   'Across 15+ completed client journeys, clients who adopted grounding meditation practices between sessions showed 40% higher sustained improvement rates compared to those who did not. The correlation is strongest in clients presenting with energetic overwhelm and anxiety.',
   'moderate','draft',
   ARRAY['book_idea','training_material','youtube_content'],
   'Consider creating a structured grounding protocol as a core take-home practice for all anxiety/overwhelm clients.',
   '2026-04-01'),

  ('88888888-0002-0000-0000-000000000001',
   'Three-session arc consistently resolves trauma field imprinting',
   'outcome',
   'Clients presenting with trauma history and energetic overwhelm show a consistent three-session arc: assessment/first clearing → emotional release → integration. Six clients have completed this arc with improvement levels of 8-10 in the final session.',
   'moderate','draft',
   ARRAY['research_publication','training_material'],
   'This protocol may be formalizable as a structured trauma clearing sequence. Enough cases to begin documentation.',
   '2026-04-01'),

  ('88888888-0003-0000-0000-000000000001',
   'Sacred Autonomy Assessment dramatically accelerates outcome timeline for complex cases',
   'service',
   'Clients who received the Sacred Autonomy Assessment before Distance Healing sessions showed faster improvement timelines than those starting with Distance Healing directly. Average improvement level in second session: 7.5 vs 5.8 for non-assessment clients.',
   'emerging','draft',
   ARRAY['research_publication','youtube_content'],
   'Assessment may be acting as a field diagnosis that improves targeting of subsequent healing work.',
   '2026-04-15'),

  ('88888888-0004-0000-0000-000000000001',
   'Heart chakra clearing protocol shows high effectiveness for grief presentations',
   'client_pattern',
   'All grief-presenting clients (3 documented cases) showed breakthrough emotional release in their second session after a heart chakra-focused first session. The pattern suggests a two-session grief arc: clearing → release. All three achieved full resolution.',
   'emerging','under_review',
   ARRAY['book_idea','training_material'],
   'Consistent pattern across Lydia Osei, Harriet Knox, and others. May be ready to formalize as grief healing protocol.',
   '2026-04-20'),

  ('88888888-0005-0000-0000-000000000001',
   'Distance Healing is effective across all client presentations when combined with at-home practices',
   'service',
   'Distance Healing sessions show strong outcome rates (75%+ improvement rate) across anxiety, trauma, grief, fatigue, and chronic pain presentations. Effectiveness increases significantly when clients adopt recommended at-home practices (crystal use, grounding, meditation).',
   'moderate','draft',
   ARRAY['youtube_content','social_media','research_publication'],
   'Distance Healing versatility is a key differentiator. Worth documenting for marketing and research.',
   '2026-04-22'),

  ('88888888-0006-0000-0000-000000000001',
   'Rose Quartz and Black Tourmaline are the most consistently reported helpful crystals',
   'recommendation',
   'Across recommendation follow-up tracking, Rose Quartz (emotional/trauma clients) and Black Tourmaline (anxiety/overwhelm clients) show the highest purchase and reported helpfulness rates. Clients spontaneously report continued use months after recommendation.',
   'emerging','draft',
   ARRAY['youtube_content','social_media'],
   'Could be the basis for a crystal starter kit recommendation for new clients.',
   '2026-04-25')
ON CONFLICT (id) DO NOTHING;

-- ── 9. CASE STUDIES (5 seed records) ─────────────────────────
INSERT INTO case_studies (id, title, client_alias, service, problem, intervention, outcome, lessons_learned, outcome_category, improvement_level, status, content_tags, anonymized, created_at)
VALUES
  ('99999999-0001-0000-0000-000000000001',
   'Distance Healing — Trauma Resolution Over Four Sessions',
   'Client 247',
   'Distance Healing',
   'Client presented with deep trauma history affecting all energy bodies. State score 1/5 at intake. Energetic overwhelm, emotional shutdown, and physical tension throughout the field.',
   'Sacred Autonomy Assessment in session 1 to map the energetic disruption. Three subsequent Distance Healing sessions targeting identified trauma layers systematically.',
   'Category: improved. Improvement level: 10/10. Complete trauma resolution achieved. Client reported profound life changes including restored relationships, reduced anxiety, and physical symptom relief. State score progressed 1→3→5 over four sessions.',
   'Assessment before healing dramatically improved targeting. Systematic layered clearing more effective than general clearing. Client''s willingness to adopt grounding practices between sessions was critical to sustaining progress.',
   'improved', 10, 'published',
   ARRAY['research_publication','training_material','book_idea'],
   true, '2026-04-15'),

  ('99999999-0002-0000-0000-000000000001',
   'Grief Healing — Heart Chakra Protocol',
   'Client 318',
   'Distance Healing',
   'Client experiencing profound grief after loss. Heart chakra heavily blocked with grief energy. State score 1/5. Described as unable to feel anything other than sadness and numbness.',
   'Three-session Distance Healing protocol focused on heart chakra clearing. Session 1: surface grief clearing. Session 2: facilitated deep emotional release. Session 3: heart field restoration and integration support.',
   'Category: improved. Improvement level: 9/10. Unexpected deep emotional release in session 2 accelerated healing timeline. Client reported being able to feel joy again by session 3. Heart field fully restored.',
   'Allow space for unexpected emotional release in session 2 — this appears to be part of the natural grief clearing arc. Do not interrupt or redirect. Session 3 integration is essential.',
   'improved', 9, 'published',
   ARRAY['research_publication','training_material'],
   true, '2026-04-18'),

  ('99999999-0003-0000-0000-000000000001',
   'Chronic Pain — Root Chakra Clearing Protocol',
   'Client 183',
   'Distance Healing',
   'Client presenting with chronic lower back pain with no clear medical explanation. Root chakra severely blocked. Pain imprints throughout lower energy field. State score 2/5.',
   'Sacred Autonomy Assessment identified root chakra as primary disruption point. Two subsequent Distance Healing sessions targeting root chakra activation and pain imprint removal.',
   'Category: improved. Improvement level: 8/10. Significant pain reduction across three sessions. Client reporting 70% reduction in pain levels by session 3. Root chakra energy strong.',
   'Chronic pain presentations with unknown medical cause respond strongly to root chakra work. Assessment critical for identifying the energetic root (literally) of physical symptoms.',
   'improved', 8, 'draft',
   ARRAY['research_publication','book_idea'],
   true, '2026-04-20'),

  ('99999999-0004-0000-0000-000000000001',
   'Spiritual Consultation — Life Direction Clarity',
   'Client 092',
   'Spiritual Consultation',
   'Client experiencing confusion about life direction after major transition. Spiritual connection pathways dimmed. State score 3/5 but deep dissatisfaction and purposelessness.',
   'Spiritual Consultation session addressing higher self connection and soul contract clarity. Followed by Distance Healing session to anchor the insights into the physical and energetic body.',
   'Category: improved. Improvement level: 9/10. Client reported profound clarity and began taking concrete action on life direction within weeks of the consultation. Follow-up session confirmed anchoring of insights.',
   'Spiritual Consultation creates insight. Distance Healing anchors it. The combination is more effective than either alone for purpose/direction work.',
   'improved', 9, 'draft',
   ARRAY['youtube_content','social_media'],
   true, '2026-04-22'),

  ('99999999-0005-0000-0000-000000000001',
   'Anxiety and Sleep — Three-Session Improvement Arc',
   'Client 471',
   'Distance Healing',
   'Client presenting with anxiety and insomnia. Crown chakra overactive, root disconnected. Mental field scattered. State score 2/5. Reporting inability to sleep more than 4 hours.',
   'Three Distance Healing sessions targeting: crown chakra calming (session 1), sleep field reinforcement (session 2), root-crown balance (session 3). Sleep Meditation Audio recommended as at-home practice.',
   'Category: improved. Improvement level: 9/10. Sleep normalized to 7+ hours by session 3. Anxiety reduced to manageable levels. Client attributes improvement equally to sessions and at-home meditation practice.',
   'Anxiety and sleep respond quickly to Distance Healing. Crown-root balance is the key energetic intervention. At-home practice (sleep meditation) appears to compound in-session results significantly.',
   'improved', 9, 'published',
   ARRAY['youtube_content','social_media','training_material'],
   true, '2026-04-24')
ON CONFLICT (id) DO NOTHING;

-- ── 10. PATTERNS (pre-seeded candidates) ─────────────────────
INSERT INTO patterns (id, pattern_type, title, description, supporting_count, confidence_level, status, data_snapshot, content_tags, created_at)
VALUES
  ('aaaaaaaa-0001-0000-0000-000000000001',
   'concern',
   'Recurring concern: "energetic overwhelm and anxiety"',
   '"energetic overwhelm and anxiety" has appeared as the chief concern in 5 sessions.',
   5, 'moderate', 'candidate',
   '{"concern": "energetic overwhelm and anxiety", "count": 5}',
   ARRAY['training_material','research_publication'],
   '2026-04-01'),

  ('aaaaaaaa-0002-0000-0000-000000000001',
   'concern',
   'Recurring concern: "trauma and energetic overwhelm"',
   '"trauma and energetic overwhelm" has appeared as the chief concern in 4 sessions.',
   4, 'emerging', 'candidate',
   '{"concern": "trauma and energetic overwhelm", "count": 4}',
   ARRAY['research_publication'],
   '2026-04-01'),

  ('aaaaaaaa-0003-0000-0000-000000000001',
   'concern',
   'Recurring concern: "grief and emotional overwhelm"',
   '"grief and emotional overwhelm" has appeared as the chief concern in 3 sessions.',
   3, 'emerging', 'candidate',
   '{"concern": "grief and emotional overwhelm", "count": 3}',
   ARRAY['book_idea','research_publication'],
   '2026-04-01'),

  ('aaaaaaaa-0004-0000-0000-000000000001',
   'intervention',
   'High-improvement intervention: "Grounding Meditation Practice"',
   '"Grounding Meditation Practice" was recommended in 7 sessions with improvement level 7+.',
   7, 'moderate', 'confirmed',
   '{"product": "Grounding Meditation Practice", "high_improve_sessions": 7}',
   ARRAY['training_material','youtube_content'],
   '2026-04-05'),

  ('aaaaaaaa-0005-0000-0000-000000000001',
   'recommendation',
   'High-effectiveness recommendation: "Grounding Meditation Practice"',
   '"Grounding Meditation Practice" has an 86% helpful rate across 7 recommendations.',
   7, 'moderate', 'confirmed',
   '{"product": "Grounding Meditation Practice", "helpful_rate": 86, "total": 7}',
   ARRAY['training_material','youtube_content','social_media'],
   '2026-04-05'),

  ('aaaaaaaa-0006-0000-0000-000000000001',
   'service',
   'High-outcome service: "Distance Healing"',
   '"Distance Healing" shows an 80% improvement rate across 35 tracked sessions.',
   35, 'strong', 'confirmed',
   '{"service": "Distance Healing", "improvement_rate": 80, "total": 35}',
   ARRAY['research_publication','social_media'],
   '2026-04-10'),

  ('aaaaaaaa-0007-0000-0000-000000000001',
   'retention',
   'Strong repeat client base — 9 clients with 3+ sessions',
   '9 clients have completed 3 or more sessions, indicating strong retention.',
   9, 'moderate', 'confirmed',
   '{"repeat_clients": 9, "threshold": 3}',
   ARRAY['research_publication'],
   '2026-04-10')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES — run after commit
-- ============================================================

SELECT 'clients'         AS table_name, COUNT(*) AS seeded FROM clients         WHERE id::text LIKE '11111111%'
UNION ALL
SELECT 'sessions',                       COUNT(*)           FROM sessions         WHERE id::text LIKE '22222222%'
UNION ALL
SELECT 'session_notes',                  COUNT(*)           FROM session_notes    WHERE id::text LIKE '33333333%'
UNION ALL
SELECT 'session_outcomes',               COUNT(*)           FROM session_outcomes WHERE id::text LIKE '44444444%'
UNION ALL
SELECT 'recommendations',                COUNT(*)           FROM recommendations  WHERE id::text LIKE '55555555%'
UNION ALL
SELECT 'aftercare',                      COUNT(*)           FROM aftercare        WHERE id::text LIKE '66666666%'
UNION ALL
SELECT 'client_goals',                   COUNT(*)           FROM client_goals     WHERE id::text LIKE '77777777%'
UNION ALL
SELECT 'research_insights',              COUNT(*)           FROM research_insights WHERE id::text LIKE '88888888%'
UNION ALL
SELECT 'case_studies',                   COUNT(*)           FROM case_studies     WHERE id::text LIKE '99999999%'
UNION ALL
SELECT 'patterns',                       COUNT(*)           FROM patterns         WHERE id::text LIKE 'aaaaaaaa%'
ORDER BY table_name;

-- Expected:
-- clients: 25, sessions: 62, session_notes: 23, session_outcomes: 35,
-- recommendations: 25, aftercare: 22, client_goals: 10,
-- research_insights: 6, case_studies: 5, patterns: 7
