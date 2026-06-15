-- ===================================================================
-- Royal Energy Alchemy — June 15–21 (supplemental)
-- Run AFTER 2026-06-14-schedule-import.sql
-- ===================================================================

BEGIN;

-- ── CONFIRMED SESSIONS  June 15–19 ──────────────────────────────────

INSERT INTO sessions
  (client_name,session_date,session_time,service,amount_due,amount_paid,payment_status,status,location_type,seller_notes,source)
SELECT v.n,v.d::date,v.t::time,v.svc,NULLIF(v.due,'null')::numeric,NULLIF(v.paid,'null')::numeric,v.pst,v.st,v.loc,v.notes,'manual'
FROM (VALUES
  ('Joanne Elpel',           '2026-06-15','11:00','Distance Energy Session',           '80',  '0',  'unpaid',  'confirmed','distance','Phone: 406-490-1951. Text.'),
  ('Carol Albertson',        '2026-06-15','13:00','Energy Session — Round 4',          '70',  '70', 'paid',    'confirmed','distance','Round 4.'),
  ('Erika Duckley',          '2026-06-15','15:00','Distance Energy Session',           '70',  '0',  'unpaid',  'confirmed','distance','Creon (M).'),
  ('Gary',                   '2026-06-15','17:00','Distance Energy Session',           '70',  '0',  'unpaid',  'confirmed','distance','Mom noted.'),
  ('Diane Wave',             '2026-06-15','19:00','Distance Energy Session — Round 2', '70',  '0',  'unpaid',  'confirmed','distance','WhatsApp. 2nd Round.'),
  ('Mama Friesen',           '2026-06-16','11:00','Distance Energy Session',           '70',  '70', 'paid',    'confirmed','distance','E (email).'),
  ('Fabianas Daughter',      '2026-06-16','13:00','Energy Session',                    '70',  '70', 'paid',    'confirmed','distance','Fabianas daughter.'),
  ('Kimberly Bonus',         '2026-06-16','15:00','Energy Session — 2nd Round',        '40',  '0',  'unpaid',  'confirmed','distance','2nd Round.'),
  ('Angela Marshall',        '2026-06-16','17:00','Energy Session — Round 2',          '70',  '70', 'paid',    'confirmed','distance','Round 2.'),
  ('Jonethias Brother',      '2026-06-16','19:00','Energy Session',                    '65',  '65', 'paid',    'confirmed','distance','Jonethias brother.'),
  ('Loris Granddaughter',    '2026-06-16','20:30','Energy Session - Short',             '10',  '0',  'unpaid',  'confirmed','distance','Short session. Loris granddaughter.'),
  ('Jackie E',               '2026-06-17','11:00','Distance Energy Session',           '80',  '80', 'paid',    'confirmed','distance','WhatsApp. Phone: 249-435-5063'),
  ('Penny',                  '2026-06-17','13:00','Distance Energy Session',           '80',  '80', 'paid',    'confirmed','distance','Saul / Ian Penny (M). WhatsApp.'),
  ('Lyndi Powers',           '2026-06-17','15:00','Distance Energy Session',           '70',  '70', 'paid',    'confirmed','distance',''),
  ('Lynda French',           '2026-06-17','17:00','Energy Session — Round 2',          '70',  '70', 'paid',    'confirmed','distance','Round 2.'),
  ('Shawna Hensley',         '2026-06-17','19:00','Distance Energy Session',           '90',  '90', 'paid',    'confirmed','distance',''),
  ('Slogy Dad',              '2026-06-18','13:00','Distance Energy Session',           '80',  '0',  'unpaid',  'confirmed','distance','WhatsApp.'),
  ('Wanda Huff',             '2026-06-18','15:00','Distance Energy Session',           '42',  '42', 'paid',    'confirmed','distance',''),
  ('Anne Collins',           '2026-06-18','17:00','Energy Session — 3rd Round',        '70',  '0',  'unpaid',  'confirmed','distance','3rd Round.'),
  ('Angel Broken',           '2026-06-18','19:00','Energy Session — Round 3',          '70',  '70', 'paid',    'confirmed','distance','Round 3.'),
  ('Tina Makers',            '2026-06-19','11:00','Energy Session — 2nd Round',        '70',  '0',  'unpaid',  'confirmed','distance','2nd Round.'),
  ('Linda Edwards',          '2026-06-19','13:00','Energy Session — Round 2',          '70',  '0',  'unpaid',  'confirmed','distance','Round 2. Text.'),
  ('Mitshide Tombo',         '2026-06-19','15:00','Distance Energy Session',           '70',  '0',  'unpaid',  'confirmed','distance',''),
  ('Michelle Hickman',       '2026-06-19','17:00','Distance Energy Session — 2nd Round','80', '0',  'unpaid',  'confirmed','distance','UK. 2nd Round.'),
  ('Patricia Simp',          '2026-06-19','19:00','Distance Energy Session',           '70',  '0',  'unpaid',  'confirmed','distance','WhatsApp.')
) AS v(n,d,t,svc,due,paid,pst,st,loc,notes)
WHERE NOT EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.session_date = v.d::date
    AND s.session_time = v.t::time
    AND s.client_name  = v.n
);


-- ── BOOKED SLOTS  June 15–19 ────────────────────────────────────────

INSERT INTO availability_slots (slot_date, slot_time, status, label, display_time)
VALUES
('2026-06-15','11:00','booked','Mon Jun 15 at 11:00 AM','11:00 AM'),
('2026-06-15','13:00','booked','Mon Jun 15 at 1:00 PM', '1:00 PM'),
('2026-06-15','15:00','booked','Mon Jun 15 at 3:00 PM', '3:00 PM'),
('2026-06-15','17:00','booked','Mon Jun 15 at 5:00 PM', '5:00 PM'),
('2026-06-15','19:00','booked','Mon Jun 15 at 7:00 PM', '7:00 PM'),
('2026-06-16','11:00','booked','Tue Jun 16 at 11:00 AM','11:00 AM'),
('2026-06-16','13:00','booked','Tue Jun 16 at 1:00 PM', '1:00 PM'),
('2026-06-16','15:00','booked','Tue Jun 16 at 3:00 PM', '3:00 PM'),
('2026-06-16','17:00','booked','Tue Jun 16 at 5:00 PM', '5:00 PM'),
('2026-06-16','19:00','booked','Tue Jun 16 at 7:00 PM', '7:00 PM'),
('2026-06-16','20:30','booked','Tue Jun 16 at 8:30 PM', '8:30 PM'),
('2026-06-17','11:00','booked','Wed Jun 17 at 11:00 AM','11:00 AM'),
('2026-06-17','13:00','booked','Wed Jun 17 at 1:00 PM', '1:00 PM'),
('2026-06-17','15:00','booked','Wed Jun 17 at 3:00 PM', '3:00 PM'),
('2026-06-17','17:00','booked','Wed Jun 17 at 5:00 PM', '5:00 PM'),
('2026-06-17','19:00','booked','Wed Jun 17 at 7:00 PM', '7:00 PM'),
('2026-06-18','13:00','booked','Thu Jun 18 at 1:00 PM', '1:00 PM'),
('2026-06-18','15:00','booked','Thu Jun 18 at 3:00 PM', '3:00 PM'),
('2026-06-18','17:00','booked','Thu Jun 18 at 5:00 PM', '5:00 PM'),
('2026-06-18','19:00','booked','Thu Jun 18 at 7:00 PM', '7:00 PM'),
('2026-06-19','11:00','booked','Fri Jun 19 at 11:00 AM','11:00 AM'),
('2026-06-19','13:00','booked','Fri Jun 19 at 1:00 PM', '1:00 PM'),
('2026-06-19','15:00','booked','Fri Jun 19 at 3:00 PM', '3:00 PM'),
('2026-06-19','17:00','booked','Fri Jun 19 at 5:00 PM', '5:00 PM'),
('2026-06-19','19:00','booked','Fri Jun 19 at 7:00 PM', '7:00 PM')
ON CONFLICT (slot_date, slot_time) DO UPDATE
  SET status=EXCLUDED.status, label=EXCLUDED.label, display_time=EXCLUDED.display_time;


-- ── BLOCKED DAYS  Jun 20 + 21 ───────────────────────────────────────

INSERT INTO availability_slots (slot_date, slot_time, status, label, display_time)
VALUES
('2026-06-20','12:00','blocked','Sat Jun 20 - Fun Day',              'Fun Day'),
('2026-06-21','12:00','blocked','Sun Jun 21 - Rest / Fathers Day',   'Rest Day')
ON CONFLICT (slot_date, slot_time) DO UPDATE
  SET status='blocked', label=EXCLUDED.label, display_time=EXCLUDED.display_time;

COMMIT;
