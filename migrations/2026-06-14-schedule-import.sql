-- ===================================================================
-- Royal Energy Alchemy — Daron's Schedule Import  (June 8 – July 19)
-- Run in: Supabase → SQL Editor → New Query
-- Dedup:  WHERE NOT EXISTS on (session_date, session_time, client_name)
--         so re-running this is always safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- HELPER: one reusable insert pattern
--   INSERT ... SELECT ... FROM (VALUES ...) AS v(...) WHERE NOT EXISTS
-- ===================================================================

-- ── COMPLETED SESSIONS  June 8–12 ───────────────────────────────────

INSERT INTO sessions
  (client_name,session_date,session_time,service,amount_due,amount_paid,payment_status,status,location_type,seller_notes,source)
SELECT v.n,v.d::date,v.t::time,v.svc,NULLIF(v.due,'null')::numeric,NULLIF(v.paid,'null')::numeric,v.pst,v.st,v.loc,v.notes,'manual'
FROM (VALUES
  ('Maureen Rexrode',        '2026-06-08','13:00','Distance Energy Session',          'null','null','unpaid',  'completed','distance','Panel client. 1pm.'),
  ('Hilda',                  '2026-06-08','14:00','Energy Session — Round 2',          '80',  '80',  'paid',    'completed','distance','Round 2.'),
  ('Brandon',                '2026-06-08','15:00','Energy Session — Round 2',          'null','null','unpaid',  'completed','distance','Round 2.'),
  ('Daniel Voysey',          '2026-06-08','15:30','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Phone: +44 2819519774.'),
  ('Nancy Brooking',         '2026-06-08','16:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Phone: 519-636-0095'),
  ('Marcella Sierra Nevada', '2026-06-08','21:00','Energy Session — Round 2',           '70',  '70',  'paid',    'completed','distance','Round 2.'),
  ('Daryl Sobalik',          '2026-06-09','10:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance',''),
  ('Toril Hoaoneland',       '2026-06-09','11:00','Energy Session',                    'null','null','unpaid',  'completed','distance','Nottestad.'),
  ('Leah Welch',             '2026-06-09','15:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Mom. Phone: 1-803-419-0459'),
  ('Tammy Mattie',           '2026-06-09','17:00','Distance Energy Session',            '70',  '0',   'unpaid',  'completed','distance',''),
  ('Cindy Brown',            '2026-06-09','19:00','Distance Energy Session',            '70',  '0',   'unpaid',  'completed','distance',''),
  ('Carol McClelland',       '2026-06-09','20:30','Spiritual Guidance — 30 min',        '50',  '50',  'paid',    'completed','distance','1/2 hour.'),
  ('Satie',                  '2026-06-10','09:00','Energy Session — Round 2',           '70',  '70',  'paid',    'completed','distance','Round 2. WhatsApp.'),
  ('Jared',                  '2026-06-10','11:00','Energy Session',                    'null','null','unpaid',  'completed','distance','Kasy Walker.'),
  ('Heather Anderson',       '2026-06-10','13:00','Distance Energy Session',            '70',  '0',   'unpaid',  'completed','distance','Phone: 902-642-3134'),
  ('Amber Silliman',         '2026-06-10','14:15','Energy Session — Round 2',           '70',  '70',  'paid',    'completed','distance','Round 2.'),
  ('Maureen Goodman',        '2026-06-10','17:00','Distance Energy Session',            '90',  '90',  'paid',    'completed','distance','Phone: 543-251-9786'),
  ('Melissa Wisdom',         '2026-06-10','19:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Phone: 573-243-9198'),
  ('Janet E. Unterkofter',   '2026-06-11','11:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Phone: 571-136-0525'),
  ('Patricia Karnes',        '2026-06-11','13:00','Distance Energy Session',           '100', '100',  'paid',    'completed','distance',''),
  ('Casey Varnes',           '2026-06-11','15:00','Distance Energy Session',            '90',  '90',  'paid',    'completed','distance',''),
  ('Valorie Strickland',     '2026-06-11','17:00','Energy Session — Round 2',           '70',  '70',  'paid',    'completed','distance','2nd Round.'),
  ('Kelly',                  '2026-06-11','19:00','Energy Session — Exchange',          'null','null','paid',    'completed','distance','Exchange — no charge.'),
  ('Taylore McMane',         '2026-06-12','11:00','Distance Energy Session',            '70',  '70',  'paid',    'completed','distance','Phone: 978-552-7779'),
  ('Ingyrtha Rodriguez',     '2026-06-12','13:00','Energy Session — Round 2',          '140', '140',  'paid',    'completed','distance','2nd Round. $140.'),
  ('Marjo Gunnison',         '2026-06-12','15:00','Energy Session',                    'null','null','paid',    'completed','distance','Friend / exchange.'),
  ('Sandras Sister',         '2026-06-12','17:00','Distance Energy Session',            '65',  '65',  'paid',    'completed','distance','Phone: 917-600-5515'),
  ('Tracy Silva',            '2026-06-12','19:00','Distance Energy Session',           '100', '100',  'paid',    'completed','distance','')
) AS v(n,d,t,svc,due,paid,pst,st,loc,notes)
WHERE NOT EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.session_date = v.d::date
    AND s.session_time = v.t::time
    AND s.client_name  = v.n
);

-- ── CONFIRMED SESSIONS  June 22 – July 15 ───────────────────────────

INSERT INTO sessions
  (client_name,session_date,session_time,service,amount_due,amount_paid,payment_status,status,location_type,seller_notes,source)
SELECT v.n,v.d::date,v.t::time,v.svc,NULLIF(v.due,'null')::numeric,NULLIF(v.paid,'null')::numeric,v.pst,v.st,v.loc,v.notes,'manual'
FROM (VALUES
  ('Michele Solang',         '2026-06-22','10:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('David Thorp',            '2026-06-22','12:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Phone: 479-677-0234'),
  ('Michelle',               '2026-06-22','14:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance','Susan From. Phone: 919-716-2533'),
  ('Susan Plotinsky',        '2026-06-22','16:00','Energy Session — 2nd Round',         '70',  '0',   'unpaid',  'confirmed','distance','2nd Round.'),
  ('Renee Rice',             '2026-06-22','18:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Cell. Phone: 650-303-9858'),
  ('Jimmy Mom Tlinka',       '2026-06-22','20:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance','WhatsApp. Mom — Tlinka.'),
  ('Lindsey Vigeson',        '2026-06-23','10:00','Energy Session — 2nd Round',         '70',  '0',   'unpaid',  'confirmed','distance','2nd Round.'),
  ('Arlin Kelly',            '2026-06-23','12:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Anders Hill',            '2026-06-23','14:00','Distance Energy Session',            '80',  '0',   'unpaid',  'confirmed','distance','Sweden.'),
  ('Suzette Pergande',       '2026-06-23','16:00','Energy Session — 2nd Round',         '40',  '40',  'paid',    'confirmed','distance','2nd Round.'),
  ('Victoria Whitcross',     '2026-06-23','18:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance','Phone: 610-509-9027'),
  ('Isidore Lyamoya',        '2026-06-24','10:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Phone: 509-488-7049'),
  ('Aneta N',                '2026-06-24','12:00','Energy Session — Round 2',           '30',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Morgan',                 '2026-06-24','14:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Illinois. Phone: 217-870-1262'),
  ('Susan Snyder Consant',   '2026-06-24','16:00','In-Person Session',                  '80',  '0',   'unpaid',  'confirmed','local',   'In-Person.'),
  ('Sarah',                  '2026-06-24','18:00','In-Person Session',                  '50',  '0',   'unpaid',  'confirmed','local',   'Viral / In-Person.'),
  ('Lisa Brickman',          '2026-06-25','10:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Phone: 501-304-??? (partial)'),
  ('Kathleen Blair',         '2026-06-25','12:00','Energy Session — 2nd Round',         '70',  '0',   'unpaid',  'confirmed','distance','2nd Round.'),
  ('Jennette',               '2026-06-25','14:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance','Steven.'),
  ('Gray Whitlock',          '2026-06-25','16:00','Distance Energy Session',            '30',  '0',   'unpaid',  'confirmed','distance','NC. Phone: 336-648-0642'),
  ('Johanne Davison',        '2026-06-25','18:00','Distance Energy Session',            '80',  '0',   'unpaid',  'confirmed','distance',''),
  ('Rose Pierce',            '2026-06-26','10:00','Energy Session — Round 2',           '70',  '70',  'paid',    'confirmed','distance','Round 2.'),
  ('Dakota',                 '2026-06-26','12:00','Energy Session — 3rd Session',       '70',  '0',   'unpaid',  'confirmed','distance','3rd time.'),
  ('Andy Cadell',            '2026-06-26','14:00','Energy Session — Reschedule',        '70',  '70',  'paid',    'confirmed','distance','Reschedule.'),
  ('Kathleen Blair',         '2026-06-26','16:00','Family Package — Grand Kids',        '150', '150', 'paid',    'confirmed','distance','Grand Kids — 15 min. Package. Paid.'),
  ('Son and Daughter-in-Law','2026-06-26','18:00','Family Package',                    'null','null','unpaid',  'confirmed','local',   'Son + Daughter-in-Law. Blair family.'),
  ('Elaine Jones Brennan',   '2026-06-29','10:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance',''),
  ('Michelle Gorman',        '2026-06-29','12:00','Energy Session — 2nd Round',         '70',  '70',  'paid',    'confirmed','distance','2nd Round.'),
  ('Jennette',               '2026-06-29','14:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance','Charise (Daughter).'),
  ('Hilly ODS',              '2026-06-29','16:00','Energy Session — 2nd Round',         '70',  '0',   'unpaid',  'confirmed','distance','2nd Round.'),
  ('Cindy Cook',             '2026-06-29','18:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Taskra Debrera',         '2026-06-30','10:00','Distance Energy Session',            '80',  '0',   'unpaid',  'confirmed','distance','Phone: 214-917-??? (partial)'),
  ('Cindy Belch',            '2026-06-30','12:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Maristella Altong',      '2026-06-30','14:00','Distance Energy Session',            '70',  '70',  'paid',    'confirmed','distance',''),
  ('Marc Lars',              '2026-06-30','16:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Hillary and Lee',        '2026-06-30','17:00','Energy Session',                    'null','null','paid',    'confirmed','distance','Daughter — Hillary & Lee. Paid 15 min.'),
  ('Olivia Hanson Sin',      '2026-07-01','10:00','Distance Energy Session — Round 2',  '90',  '90',  'paid',    'confirmed','distance','2nd Round.'),
  ('Marc Silva',             '2026-07-01','11:00','Distance Energy Session',            '70',  '70',  'paid',    'confirmed','distance',''),
  ('Marcella',               '2026-07-01','14:00','Energy Session — Round 4',          '160',  '0',  'unpaid',  'confirmed','distance','Round 4.'),
  ('Pat Tyber',              '2026-07-01','16:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Phone: 320-493-5214'),
  ('Kelly Sullivan',         '2026-07-01','18:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Danielle',               '2026-07-02','10:00','Energy Session — 4th Round',         '70',  '0',   'unpaid',  'confirmed','distance','4th Round.'),
  ('Sarah Sweet',            '2026-07-02','12:00','Energy Session — 2nd Round',         '70',  '0',   'unpaid',  'confirmed','distance','2nd Round.'),
  ('Angel Sarah',            '2026-07-02','14:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Ana Bury',               '2026-07-02','16:00','Distance Energy Session',            '50',  '50',  'paid',    'confirmed','distance','Phone: 847-378-7169'),
  ('Tammy Pruitt',           '2026-07-02','18:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','Phone: 706-443-8218'),
  ('Trinity Trimm',          '2026-07-03','12:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Shea Cahill',            '2026-07-03','12:30','Energy Session',                     '70',  '70',  'paid',    'confirmed','distance','Kati Cahills son.'),
  ('Sally Fernandez',        '2026-07-03','14:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Mark Anthony',           '2026-07-03','15:00','Energy Session',                     '60',  '60',  'paid',    'confirmed','distance',''),
  ('Tarot Reading Client',   '2026-07-03','16:00','Tarot Reading',                      '30',  '0',   'unpaid',  'confirmed','distance',''),
  ('Joanne Bac',             '2026-07-06','10:00','Energy Session — 3rd Round',         '70',  '0',   'unpaid',  'confirmed','distance','Jordén. 3rd Round.'),
  ('Erica',                  '2026-07-06','12:00','Distance Energy Session',            '80',  '80',  'paid',    'confirmed','distance','You Can See It.'),
  ('Joanne Utz',             '2026-07-06','14:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Sara Jane Kafer Stern',  '2026-07-06','16:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance','Round.'),
  ('Fellie Piotrink',        '2026-07-06','18:00','Energy Session - 3rd Round',         '70',  '0',   'unpaid',  'confirmed','distance','Lindsays Sister - 3rd Round.'),
  ('Kelly Sibley',           '2026-07-07','10:00','Energy Session',                     '80',  '0',   'unpaid',  'confirmed','distance',''),
  ('Dawn Yekrabs',           '2026-07-07','12:00','Energy Session — 3rd Round',         '70',  '0',   'unpaid',  'confirmed','distance','Sharkley — 3rd Round.'),
  ('Jayne Taylor',           '2026-07-07','14:00','Distance Energy Session — Round 2',  '70',  '0',   'unpaid',  'confirmed','distance','WhatsApp.'),
  ('Maria Padesis',          '2026-07-07','16:00','Distance Energy Session — Round 2',  '70',  '0',   'unpaid',  'confirmed','distance','PA.'),
  ('Sarah Viral',            '2026-07-07','18:00','In-Person Session',                  '50',  '0',   'unpaid',  'confirmed','local',   'Viral / In-Person.'),
  ('Dave Corath',            '2026-07-08','10:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance','UK. WhatsApp.'),
  ('Marcy Stahl',            '2026-07-08','14:00','Distance Energy Session',           '100',  '0',   'unpaid',  'confirmed','distance','Phone: 502-826-5114'),
  ('Debbie West',            '2026-07-08','16:00','Distance Energy Session',            '80',  '0',   'unpaid',  'confirmed','distance','Phone: 314-856-2299'),
  ('Courtney Bussarte',      '2026-07-08','18:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Jeff',                   '2026-07-08','19:00','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Karen Harder Clements',  '2026-07-09','12:00','Distance Energy Session — Round 2',  '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Nancy McLennas',         '2026-07-09','16:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Amy Walding',            '2026-07-09','17:30','Energy Session',                     '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Linda Hill',             '2026-07-10','10:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2.'),
  ('Tim Makers',             '2026-07-10','12:00','Energy Session — Round 2',           '70',  '0',   'unpaid',  'confirmed','distance','Round 2 — callback.'),
  ('Michelle Hudson',        '2026-07-10','14:00','Energy Session — 3rd Round',         '70',  '0',   'unpaid',  'confirmed','distance','3rd Round.'),
  ('Shawna B-Day Group',     '2026-07-10','19:00','Group Session — Birthday Party',     '80',  '80',  'paid',    'confirmed','local',   'Shawna birthday. Kati Mary + Kati + Fredenie. $80 each cash.'),
  ('Victoria Whitcross',     '2026-07-13','18:00','Distance Energy Session',            '70',  '0',   'unpaid',  'confirmed','distance',''),
  ('Hilda and Brandon',      '2026-07-15','18:00','Two-Person Session',                '120',  '0',   'unpaid',  'confirmed','local',   '6–7:30pm. Two-person package.')
) AS v(n,d,t,svc,due,paid,pst,st,loc,notes)
WHERE NOT EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.session_date = v.d::date
    AND s.session_time = v.t::time
    AND s.client_name  = v.n
);


-- ===================================================================
-- AVAILABILITY SLOTS — BOOKED  (locks public calendar)
-- ===================================================================

INSERT INTO availability_slots (slot_date, slot_time, status, label, display_time)
VALUES
('2026-06-22','10:00','booked','Mon Jun 22 at 10:00 AM','10:00 AM'),
('2026-06-22','12:00','booked','Mon Jun 22 at 12:00 PM','12:00 PM'),
('2026-06-22','14:00','booked','Mon Jun 22 at 2:00 PM', '2:00 PM'),
('2026-06-22','16:00','booked','Mon Jun 22 at 4:00 PM', '4:00 PM'),
('2026-06-22','18:00','booked','Mon Jun 22 at 6:00 PM', '6:00 PM'),
('2026-06-22','20:00','booked','Mon Jun 22 at 8:00 PM', '8:00 PM'),
('2026-06-23','10:00','booked','Tue Jun 23 at 10:00 AM','10:00 AM'),
('2026-06-23','12:00','booked','Tue Jun 23 at 12:00 PM','12:00 PM'),
('2026-06-23','14:00','booked','Tue Jun 23 at 2:00 PM', '2:00 PM'),
('2026-06-23','16:00','booked','Tue Jun 23 at 4:00 PM', '4:00 PM'),
('2026-06-23','18:00','booked','Tue Jun 23 at 6:00 PM', '6:00 PM'),
('2026-06-24','10:00','booked','Wed Jun 24 at 10:00 AM','10:00 AM'),
('2026-06-24','12:00','booked','Wed Jun 24 at 12:00 PM','12:00 PM'),
('2026-06-24','14:00','booked','Wed Jun 24 at 2:00 PM', '2:00 PM'),
('2026-06-24','16:00','booked','Wed Jun 24 at 4:00 PM', '4:00 PM'),
('2026-06-24','18:00','booked','Wed Jun 24 at 6:00 PM', '6:00 PM'),
('2026-06-25','10:00','booked','Thu Jun 25 at 10:00 AM','10:00 AM'),
('2026-06-25','12:00','booked','Thu Jun 25 at 12:00 PM','12:00 PM'),
('2026-06-25','14:00','booked','Thu Jun 25 at 2:00 PM', '2:00 PM'),
('2026-06-25','16:00','booked','Thu Jun 25 at 4:00 PM', '4:00 PM'),
('2026-06-25','18:00','booked','Thu Jun 25 at 6:00 PM', '6:00 PM'),
('2026-06-26','10:00','booked','Fri Jun 26 at 10:00 AM','10:00 AM'),
('2026-06-26','12:00','booked','Fri Jun 26 at 12:00 PM','12:00 PM'),
('2026-06-26','14:00','booked','Fri Jun 26 at 2:00 PM', '2:00 PM'),
('2026-06-26','16:00','booked','Fri Jun 26 at 4:00 PM', '4:00 PM'),
('2026-06-26','18:00','booked','Fri Jun 26 at 6:00 PM', '6:00 PM'),
('2026-06-29','10:00','booked','Mon Jun 29 at 10:00 AM','10:00 AM'),
('2026-06-29','12:00','booked','Mon Jun 29 at 12:00 PM','12:00 PM'),
('2026-06-29','14:00','booked','Mon Jun 29 at 2:00 PM', '2:00 PM'),
('2026-06-29','16:00','booked','Mon Jun 29 at 4:00 PM', '4:00 PM'),
('2026-06-29','18:00','booked','Mon Jun 29 at 6:00 PM', '6:00 PM'),
('2026-06-30','10:00','booked','Tue Jun 30 at 10:00 AM','10:00 AM'),
('2026-06-30','12:00','booked','Tue Jun 30 at 12:00 PM','12:00 PM'),
('2026-06-30','14:00','booked','Tue Jun 30 at 2:00 PM', '2:00 PM'),
('2026-06-30','16:00','booked','Tue Jun 30 at 4:00 PM', '4:00 PM'),
('2026-06-30','17:00','booked','Tue Jun 30 at 5:00 PM', '5:00 PM'),
('2026-07-01','10:00','booked','Wed Jul 1 at 10:00 AM', '10:00 AM'),
('2026-07-01','11:00','booked','Wed Jul 1 at 11:00 AM', '11:00 AM'),
('2026-07-01','14:00','booked','Wed Jul 1 at 2:00 PM',  '2:00 PM'),
('2026-07-01','16:00','booked','Wed Jul 1 at 4:00 PM',  '4:00 PM'),
('2026-07-01','18:00','booked','Wed Jul 1 at 6:00 PM',  '6:00 PM'),
('2026-07-02','10:00','booked','Thu Jul 2 at 10:00 AM', '10:00 AM'),
('2026-07-02','12:00','booked','Thu Jul 2 at 12:00 PM', '12:00 PM'),
('2026-07-02','14:00','booked','Thu Jul 2 at 2:00 PM',  '2:00 PM'),
('2026-07-02','16:00','booked','Thu Jul 2 at 4:00 PM',  '4:00 PM'),
('2026-07-02','18:00','booked','Thu Jul 2 at 6:00 PM',  '6:00 PM'),
('2026-07-03','12:00','booked','Fri Jul 3 at 12:00 PM', '12:00 PM'),
('2026-07-03','12:30','booked','Fri Jul 3 at 12:30 PM', '12:30 PM'),
('2026-07-03','14:00','booked','Fri Jul 3 at 2:00 PM',  '2:00 PM'),
('2026-07-03','15:00','booked','Fri Jul 3 at 3:00 PM',  '3:00 PM'),
('2026-07-03','16:00','booked','Fri Jul 3 at 4:00 PM',  '4:00 PM'),
('2026-07-06','10:00','booked','Mon Jul 6 at 10:00 AM', '10:00 AM'),
('2026-07-06','12:00','booked','Mon Jul 6 at 12:00 PM', '12:00 PM'),
('2026-07-06','14:00','booked','Mon Jul 6 at 2:00 PM',  '2:00 PM'),
('2026-07-06','16:00','booked','Mon Jul 6 at 4:00 PM',  '4:00 PM'),
('2026-07-06','18:00','booked','Mon Jul 6 at 6:00 PM',  '6:00 PM'),
('2026-07-07','10:00','booked','Tue Jul 7 at 10:00 AM', '10:00 AM'),
('2026-07-07','12:00','booked','Tue Jul 7 at 12:00 PM', '12:00 PM'),
('2026-07-07','14:00','booked','Tue Jul 7 at 2:00 PM',  '2:00 PM'),
('2026-07-07','16:00','booked','Tue Jul 7 at 4:00 PM',  '4:00 PM'),
('2026-07-07','18:00','booked','Tue Jul 7 at 6:00 PM',  '6:00 PM'),
('2026-07-08','10:00','booked','Wed Jul 8 at 10:00 AM', '10:00 AM'),
('2026-07-08','14:00','booked','Wed Jul 8 at 2:00 PM',  '2:00 PM'),
('2026-07-08','16:00','booked','Wed Jul 8 at 4:00 PM',  '4:00 PM'),
('2026-07-08','18:00','booked','Wed Jul 8 at 6:00 PM',  '6:00 PM'),
('2026-07-08','19:00','booked','Wed Jul 8 at 7:00 PM',  '7:00 PM'),
('2026-07-09','12:00','booked','Thu Jul 9 at 12:00 PM', '12:00 PM'),
('2026-07-09','16:00','booked','Thu Jul 9 at 4:00 PM',  '4:00 PM'),
('2026-07-09','17:30','booked','Thu Jul 9 at 5:30 PM',  '5:30 PM'),
('2026-07-10','10:00','booked','Fri Jul 10 at 10:00 AM','10:00 AM'),
('2026-07-10','12:00','booked','Fri Jul 10 at 12:00 PM','12:00 PM'),
('2026-07-10','14:00','booked','Fri Jul 10 at 2:00 PM', '2:00 PM'),
('2026-07-10','19:00','booked','Fri Jul 10 at 7:00 PM', '7:00 PM'),
('2026-07-13','18:00','booked','Mon Jul 13 at 6:00 PM', '6:00 PM'),
('2026-07-15','18:00','booked','Wed Jul 15 at 6:00 PM', '6:00 PM')
ON CONFLICT (slot_date, slot_time) DO UPDATE
  SET status=EXCLUDED.status, label=EXCLUDED.label, display_time=EXCLUDED.display_time;


-- ===================================================================
-- AVAILABILITY SLOTS — OPEN  (clients can book)
-- ===================================================================

INSERT INTO availability_slots (slot_date, slot_time, status, label, display_time)
VALUES
('2026-07-09','10:00','available','Thu Jul 9 at 10:00 AM', '10:00 AM'),
('2026-07-09','14:00','available','Thu Jul 9 at 2:00 PM',  '2:00 PM'),
('2026-07-13','10:00','available','Mon Jul 13 at 10:00 AM','10:00 AM'),
('2026-07-13','12:00','available','Mon Jul 13 at 12:00 PM','12:00 PM'),
('2026-07-13','14:00','available','Mon Jul 13 at 2:00 PM', '2:00 PM'),
('2026-07-13','16:00','available','Mon Jul 13 at 4:00 PM', '4:00 PM'),
('2026-07-14','10:00','available','Tue Jul 14 at 10:00 AM','10:00 AM'),
('2026-07-14','12:00','available','Tue Jul 14 at 12:00 PM','12:00 PM'),
('2026-07-14','14:00','available','Tue Jul 14 at 2:00 PM', '2:00 PM'),
('2026-07-14','16:00','available','Tue Jul 14 at 4:00 PM', '4:00 PM'),
('2026-07-14','18:00','available','Tue Jul 14 at 6:00 PM', '6:00 PM'),
('2026-07-15','10:00','available','Wed Jul 15 at 10:00 AM','10:00 AM'),
('2026-07-15','12:00','available','Wed Jul 15 at 12:00 PM','12:00 PM'),
('2026-07-15','14:00','available','Wed Jul 15 at 2:00 PM', '2:00 PM'),
('2026-07-15','16:00','available','Wed Jul 15 at 4:00 PM', '4:00 PM'),
('2026-07-16','10:00','available','Thu Jul 16 at 10:00 AM','10:00 AM'),
('2026-07-16','12:00','available','Thu Jul 16 at 12:00 PM','12:00 PM'),
('2026-07-16','14:00','available','Thu Jul 16 at 2:00 PM', '2:00 PM'),
('2026-07-16','16:00','available','Thu Jul 16 at 4:00 PM', '4:00 PM'),
('2026-07-16','18:00','available','Thu Jul 16 at 6:00 PM', '6:00 PM'),
('2026-07-17','10:00','available','Fri Jul 17 at 10:00 AM','10:00 AM'),
('2026-07-17','12:00','available','Fri Jul 17 at 12:00 PM','12:00 PM'),
('2026-07-17','14:00','available','Fri Jul 17 at 2:00 PM', '2:00 PM'),
('2026-07-17','16:00','available','Fri Jul 17 at 4:00 PM', '4:00 PM'),
('2026-07-17','18:00','available','Fri Jul 17 at 6:00 PM', '6:00 PM')
ON CONFLICT (slot_date, slot_time) DO UPDATE
  SET status = CASE WHEN availability_slots.status='booked' THEN 'booked' ELSE EXCLUDED.status END,
      label=EXCLUDED.label, display_time=EXCLUDED.display_time;


-- ===================================================================
-- BLOCKED DAYS  (rest / fun / off)
-- ===================================================================

INSERT INTO availability_slots (slot_date, slot_time, status, label, display_time)
VALUES
('2026-06-13','12:00','blocked','Sat Jun 13 - Fun Day (Maryville / Bigfoot)','Fun Day'),
('2026-06-14','12:00','blocked','Sun Jun 14 - Rest Day',                     'Rest Day'),
('2026-06-27','12:00','blocked','Sat Jun 27 - Fun Day',                      'Fun Day'),
('2026-06-28','12:00','blocked','Sun Jun 28 - Rest Day',                     'Rest Day'),
('2026-07-04','12:00','blocked','Sat Jul 4 - Kirks / Independence Day',       'Unavailable'),
('2026-07-05','12:00','blocked','Sun Jul 5 - Rest Day',                       'Rest Day'),
('2026-07-11','12:00','blocked','Sat Jul 11 - Off',                           'Off'),
('2026-07-12','12:00','blocked','Sun Jul 12 - Off',                           'Off'),
('2026-07-18','12:00','blocked','Sat Jul 18 - Off',                           'Off'),
('2026-07-19','12:00','blocked','Sun Jul 19 - Off',                           'Off')
ON CONFLICT (slot_date, slot_time) DO UPDATE
  SET status='blocked', label=EXCLUDED.label, display_time=EXCLUDED.display_time;

COMMIT;
