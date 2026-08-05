# Sprint 18M Planner Reconciliation

Status: review only. No planner record was inserted, updated, cancelled, or deleted.

## Method

- Source: the supplied handwritten planner photographs covering July and August 2026.
- Comparison source: the authenticated production `sessions` schedule reviewed during the Sprint 18L production gate. That schedule contained hydrated records through July 15; the handwritten appointments below were not present unless explicitly marked `Already exists`.
- Match rule: calendar date, time, and client name. A row is not considered a match on name alone.
- `Needs review` is used whenever the name, time, appointment meaning, or cancellation state cannot be read confidently. Those rows must not be imported.
- Payment notes are transcribed for review only; they are not treated as proof of a database payment transaction.

## Confirmed comparison results

| Date | Time | Planner client / entry | Session / round | Payment note | Classification | Confidence / review note |
|---|---:|---|---|---|---|---|
| 2026-07-15 | 18:00 | Hilda + Brandon | Two-person package | $120 | Already exists | High; production showed `Hilda and Brandon Two-Person` at 18:00. |
| 2026-07-16 | 08:00 | Sue Ramsey | — | Unclear | Missing | High name/time; payment unclear. |
| 2026-07-16 | 12:00 | Macy / Tremaini Baker | — | Unclear | Needs review | Name boundary is uncertain. |
| 2026-07-16 | 14:00 | Cyndi Powers | Round 2 | Unclear | Missing | Medium-high. |
| 2026-07-16 | 16:00 | Diamond Odyssey | — | Unclear | Missing | Medium; confirm surname spelling. |
| 2026-07-16 | 18:00 | Mirella | Round 3 | Unclear | Missing | High time; single name only. |
| 2026-07-16 | 19:30 | Cherree Eppel | Round 2 | Unclear | Needs review | Confirm spelling. |
| 2026-07-17 | 10:00 | Kristi Katorvan | — | Unclear | Needs review | Surname uncertain. |
| 2026-07-17 | 12:00 | Sheri Epling | — | Unclear | Missing | Medium-high. |
| 2026-07-17 | 14:00 | Enrika | Website / free | Free | Needs review | Single name and spelling uncertain. |
| 2026-07-17 | 16:00 | Dave (surname illegible) | — | Unclear | Needs review | Do not import without full client identity. |
| 2026-07-17 | 18:00 | Suzette Pergande | — | Unclear | Missing | Medium-high. |
| 2026-07-20 | 10:00 | Rose Pierce | Round 3 | $70 | Missing | High. |
| 2026-07-20 | 12:00 | Carissa Giglio | — | $80 | Needs review | Confirm surname spelling. |
| 2026-07-20 | 14:00 | Lisa M Breng | — | $100 | Needs review | Surname uncertain. |
| 2026-07-21 | 10:00 | Lori Volpert | Round 2 | Unclear | Needs review | Time/name require confirmation. |
| 2026-07-21 | 12:00 | Jacki JR | — | Unclear | Needs review | Client identity incomplete. |
| 2026-07-21 | 16:00 | Catherine Monstta | — | Unclear | Needs review | Surname uncertain. |
| 2026-07-21 | 18:00 | Juliette Jun | — | Unclear | Needs review | Confirm surname. |
| 2026-07-22 | 10:00 | Aneta Nep | Round 3 | Unclear | Needs review | Confirm spelling. |
| 2026-07-22 | 14:00 | Joanne Rose | Round 2 | Unclear | Missing | Medium-high. |
| 2026-07-22 | 16:00 | Susan Snyder | Round 2 / in person | Unclear | Missing | High. |
| 2026-07-22 | 18:00 | Nyambura Ndiba | Cleaning | $60 | Needs review | Confirm spelling and service. |
| 2026-07-23 | 10:00 | Jackie JR / Evan note | — | Unclear | Needs review | Identity and note meaning unclear. |
| 2026-07-23 | 12:00 | Teclevaran (uncertain) | Round 2 | Unclear | Needs review | Handwriting uncertain. |
| 2026-07-23 | 14:00 | Lily | Round 2 | Unclear | Needs review | Single name only. |
| 2026-07-23 | 16:00 | Georgie Gabriell | — | Unclear | Needs review | Confirm spelling. |
| 2026-07-23 | 18:00 | Kathy Blair | Round 3 | Unclear | Missing | High. |
| 2026-07-27 | 10:00 | Colette Posarliak (Belgium) | — | $70 | Needs review | Surname uncertain. |
| 2026-07-27 | 12:00 | Michael W Collins | — | $80 | Missing | High. |
| 2026-07-27 | 14:00 | Vicki / Kathleen Blair | — | $90 | Needs review | It is unclear whether this is one or two clients. |
| 2026-07-27 | 16:00 | Annette Dunwoody | — | $70 | Missing | High. |
| 2026-07-27 | 18:00 | Laurie Lepeske | — | $80 | Needs review | Confirm surname spelling. |
| 2026-07-28 | 08:00 | Patrick Mahon | — | Unclear | Missing | High. |
| 2026-07-28 | 10:00 | Joanne J Zar | Round uncertain | Unclear | Needs review | Round and surname require confirmation. |
| 2026-07-28 | 12:00 | Cyndi Powers | Rescheduled note | Unclear | Needs review | Confirm whether this remained an appointment or was moved. |
| 2026-07-28 | 14:00 | Niyla Chetta | Round 1 | Paid, amount unclear | Needs review | Name/payment uncertain. |
| 2026-07-29 | 10:00 | Rachelle Walker (UK) | — | Unclear | Missing | High. |
| 2026-07-29 | 16:00 | Anita Millaly | — | Unclear | Needs review | Surname uncertain. |
| 2026-07-29 | 18:00 | Kelly Sullivan | — | Unclear | Missing | High. |
| 2026-07-30 | 14:00 | Patricia (Kuwait note) | Round 2 + tarot | Unclear | Needs review | Full identity unclear. |
| 2026-07-30 | 19:30 | Katie Potter + friend | In house | Unclear | Needs review | Confirm second client and package. |
| 2026-07-31 | 10:00 | Amanda Nep | — | Unclear | Needs review | Confirm surname. |
| 2026-07-31 | 12:00 | Hilda / Uncle Phillip | — | Unclear | Needs review | Confirm whether this is a two-person session. |
| 2026-07-31 | 14:00 | Linda Edwards | Round 3 | Unclear | Missing | High. |
| 2026-07-31 | 16:00 | Brittany Keller | — | Unclear | Missing | High. |
| 2026-07-31 | 18:00 | Angel Tharp | — | Unclear | Missing | High. |
| 2026-08-03 | 10:00 | Danielle | Monthly session | $70 | Needs review | Single name only; paid state not written. |
| 2026-08-03 | 12:00 | Catherine / Joseph Irmina | — | $70 | Needs review | Client-name boundary and spelling uncertain. |
| 2026-08-03 | 14:00 | Trent / Katie | Distance | $70 paid | Needs review | Unclear whether one or two clients. |
| 2026-08-03 | 16:00 | Siti Ray | — | $80 paid | Needs review | Confirm spelling. |
| 2026-08-03 | 18:00 | Dawn Yebrah | Round 3 | $70 | Needs review | Confirm surname and paid state. |
| 2026-08-04 | 10:00 | Ann-Olivia Amson + Finn | Round 3 | $90 paid | Needs review | Confirm spelling and two-person structure. |
| 2026-08-04 | 12:00 | Sunshine Curry | — | $90 | Missing | High name/time; paid state unclear. |
| 2026-08-04 | 14:00 | Friend / in person | — | $80 | Needs review | No client identity. |
| 2026-08-04 | 16:00 | Penny (preceding word unclear) | Round 2 / research note | $70 paid | Needs review | Identity and note uncertain. |
| 2026-08-04 | 18:00 | Suzette | Round 6 (uncertain) | $70 paid | Needs review | Single name and round unclear. |
| 2026-08-04 | 19:30 | Kelly | Twin exchange | — | Needs review | Exchange may not be a billable session. |
| 2026-08-05 | 10:00 | Aneta Nep | — | $70 | Needs review | Confirm surname and paid state. |
| 2026-08-05 | 12:00 | B+B / Conrad Willcome | — | $80 paid | Needs review | Identity format and spelling uncertain. |
| 2026-08-05 | 14:00 | Patrick Mahon / Ruth Ann | — | $70 paid | Needs review | Unclear whether one or two clients. |
| 2026-08-05 | 16:00 | Suzanne Snyder | — | $70 paid | Missing | High. |
| 2026-08-05 | 18:00 | Candace Dees / Mark Epling | — | $70 paid | Needs review | Relationship between names unclear. |
| 2026-08-06 | 10:00 | Aneta Nep | — | $70 | Needs review | Confirm surname and paid state. |
| 2026-08-06 | 12:00 | Donna Lambert + son | Mark Epling's brother note | $90 paid | Needs review | Two-person identity incomplete. |
| 2026-08-06 | 14:00 | Brandon / Annette Dawoods | — | $70 paid | Needs review | Confirm whether one or two clients and spelling. |
| 2026-08-06 | 18:00 | Elizabeth Ryals | — | $80 paid | Needs review | Confirm surname spelling. |
| 2026-08-07 | 10:00 | Maria Podesta | Round 3 | $70 | Missing | High name/time; paid state unclear. |
| 2026-08-07 | 12:00 | Tina Makris | Monthly maintenance | $70 paid | Missing | High. |
| 2026-08-07 | 14:00 | Marion Culino | Joanna's sister | $70 | Needs review | Confirm spelling and paid state. |
| 2026-08-07 | 16:00 | Joanne CJ | WhatsApp / Round 3 | $70 | Needs review | Client identity is abbreviated. |
| 2026-08-07 | 18:00 | Suzette | Round 6 (uncertain) | $70 paid | Needs review | Single name and round unclear. |
| 2026-08-10 | 10:00 | Aneta Nep | — | $70 | Needs review | Confirm surname. |
| 2026-08-10 | 12:00 | Carissa / Sylvie-Ryan | Round 2 | $70 | Needs review | Client identity boundary unclear. |
| 2026-08-10 | 14:00 | Kathleen Blair | — | $70 | Missing | High. |
| 2026-08-10 | 16:00 | Nisha Cheeka | — | $80 paid | Needs review | Confirm spelling. |
| 2026-08-10 | 18:00 | Mel / Rachel Wilker | — | $80 paid | Needs review | Identity and surname uncertain. |
| 2026-08-11 | 10:00 | Odette Posarliak (Belgium) | — | $70 paid | Needs review | Confirm surname. |
| 2026-08-11 | 12:00 | Dawn Corath | First time | $70 paid | Needs review | Confirm surname. |
| 2026-08-11 | 14:00 | Seth Roy | Dad / intention | $70 | Needs review | Note meaning and paid state unclear. |
| 2026-08-11 | 16:00 | Chuck Frent | Reiki round | $70 paid | Needs review | Confirm surname and service. |
| 2026-08-11 | 18:00 | Sarah | Nail | $50 | Needs review | Single name; service/payment state unclear. |
| 2026-08-12 | 10:00 | Brandon / Hilda | 15 minute | $30 | Needs review | Clarify session type and which client. |
| 2026-08-12 | 12:00 | Pat Huber | Round 2 | $70 | Needs review | Confirm spelling and paid state. |
| 2026-08-12 | 14:00 | Cindy Harris | — | $80 | Missing | High name/time; paid state unclear. |
| 2026-08-12 | 16:00 | Lynn Stahl | Macy's mom | $70 | Needs review | Confirm surname and paid state. |
| 2026-08-13 | 09:00 | Rittie's appointment | — | — | Needs review | Client identity and appointment type unclear. |
| 2026-08-13 | 12:00 | Kerline | Cleansing | $80 | Needs review | Single name and paid state unclear. |
| 2026-08-13 | 18:00 | Brittany Keller | — | Exchange | Needs review | Exchange is not a clear payment status. |
| 2026-08-14 | 10:00 | Megan Jorgensen (UK) | Reiki / timer note | $80 paid | Needs review | Confirm surname and exact service. |
| 2026-08-14 | 12:00 | Hilda / Brandon | 5 minute note | $40 | Needs review | Clarify whether appointment or short service. |
| 2026-08-14 | 18:00 | Patricia Savoy | — | $70 | Missing | High name/time; paid state unclear. |
| 2026-08-17 | 09:30 | Rose Pierce | Round 4 | $70 | Missing | High name/time; paid state unclear. |
| 2026-08-18 | 18:00 | Kelly Sullivan | Round 4 | $70 | Missing | High name/time; paid state unclear. |
| 2026-08-21 | 18:00 | Kasia Fedyk / Amanda P | — | $80 paid | Needs review | Unclear whether one or two clients. |
| 2026-08-26 | 10:00 | Rachel Walker (UK) | Round 2 | $70 | Missing | High name/time; paid state unclear. |
| 2026-08-26 | 16:00 | Joanne CJ | Round 4 | $70 | Needs review | Client identity abbreviated. |
| 2026-08-28 | 10:00 | Enzo / Nisha | Round 2 | $30 | Needs review | Two names and payment state unclear. |
| 2026-08-28 | 12:00 | Cyndi Powers | Round 3 | $70 paid | Missing | High. |

## Duplicate review

No exact duplicate (same date, time, and client) was identified in the reviewed production schedule. Repeated clients on different dates or rounds were retained as separate planner rows and are not duplicates.

## Excluded planner marks

Crossed-out rows, blank time lines, vacation/personal notes, parties, festivals, and entries without enough information to establish an appointment were not proposed for import. They remain image-level review items rather than database candidates.

## Import gate

Before any import, a practitioner must approve every `Missing` row, resolve every `Needs review` row, and confirm how payment notes map to `payment_status`, `amount_due`, and `amount_paid`. A fresh authenticated production query must then be run to prevent duplicates created after this report snapshot.
