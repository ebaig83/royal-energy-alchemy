# Sprint 18M Planner Reconciliation

Status: review only. No planner record was inserted, updated, cancelled, or deleted.

## Method

- Source: the supplied handwritten planner photographs covering June through August 2026. The two photographs of June 8–14 are alternate views of the same page and are reconciled as one source week.
- Comparison source: the authenticated production `sessions` schedule reviewed during the Sprint 18L production gate. That schedule contained hydrated records through July 15; the handwritten appointments below were not present unless explicitly marked `Already exists`.
- Match rule: calendar date, time, and client name. A row is not considered a match on name alone.
- `Needs review` is used whenever the name, time, appointment meaning, or cancellation state cannot be read confidently. Those rows must not be imported.
- Payment notes are transcribed for review only; they are not treated as proof of a database payment transaction.

## Full-record additions: June 8 through July 14

These earlier pages were supplied after the initial report. `Already exists` is used only where the prior authenticated production review established the same date, time, and client. All other rows remain `Needs review` until a fresh production query can determine whether they already exist; this avoids incorrectly labeling an existing historical appointment as missing.

| Date | Time | Planner client / entry | Session / round | Payment note | Classification | Confidence / review note |
|---|---:|---|---|---|---|---|
| 2026-06-08 | 13:00 | Mom | Rescheduling | Paid / amount unclear | Needs review | Personal relationship label; full client identity required. |
| 2026-06-08 | 15:00 | Hilda | Round 2 | Amount overwritten | Needs review | Time appears near 15:00; confirm amount. |
| 2026-06-08 | 17:00 | Brandon | Round 2 | Unclear | Needs review | Time inferred from planner line and must be confirmed. |
| 2026-06-08 | 19:00 | Daniel Voysey | — | $70 paid | Needs review | International number also written; excluded from report. |
| 2026-06-08 | 21:00 | Nancy Brankins | — | $70 paid | Needs review | Confirm surname spelling. |
| 2026-06-08 | 21:00 | Myrella / Sierra Nevada | Round 2 | $70 | Needs review | Same line/time area as prior entry; identity and time conflict. |
| 2026-06-09 | 10:00 | Daryl Sobolik | — | $70 paid | Needs review | Confirm surname spelling. |
| 2026-06-09 | 13:00 | Tori Vanderland | Notre Dame note | $70 paid | Needs review | Time appears 13:00; confirm spelling. |
| 2026-06-09 | 15:00 | Leah Welch | — | $70 paid | Needs review | Confirm surname. |
| 2026-06-09 | 17:00 | Tammy Mattre | — | $70 | Needs review | Surname and paid state unclear. |
| 2026-06-09 | 19:00 | Cindy Brown | Brown / Cindy note | $70 | Needs review | Confirm identity structure. |
| 2026-06-09 | 20:30 | Carol McClelland | 1/2 hour; crossed line | $50 paid | Needs review | Crossed-out/reschedule state must be confirmed before import. |
| 2026-06-10 | 09:00 | Sahil | Round 2 | $70 paid | Needs review | Single name only. |
| 2026-06-10 | 11:00 | Jared / Kasey Walker | — | $70 | Needs review | Unclear whether Jared is a note or second client. |
| 2026-06-10 | 13:00 | Heather Anderson | — | $70 | Needs review | Paid state unclear. |
| 2026-06-10 | 15:00 | Amber Silliman | Round 2 / text | $70 paid | Needs review | Confirm surname spelling. |
| 2026-06-10 | 17:00 | Maureen Goodman | — | $70 paid | Needs review | High transcription confidence; production match still required. |
| 2026-06-10 | 19:00 | Melissa Wisdom | — | $70 paid | Needs review | Confirm surname spelling. |
| 2026-06-11 | 11:00 | Janet F. Unterkoefler | — | $70 paid | Needs review | Surname uncertain. |
| 2026-06-11 | 13:00 | Patricia Kanes | — | $100 paid | Needs review | Confirm surname. |
| 2026-06-11 | 15:00 | Cheryl Varner | — | $70 paid | Needs review | Confirm surname. |
| 2026-06-11 | 17:00 | Valorie Strickland | Round 2 | $70 paid | Needs review | Confirm first-name spelling. |
| 2026-06-11 | 19:00 | Kelly | Exchange | — | Needs review | Not clearly a billable appointment; single name only. |
| 2026-06-12 | 11:00 | Taylore McManne | — | $70 paid | Needs review | Name spelling uncertain. |
| 2026-06-12 | 13:00 | Myrtha Rodriguez | Round 2 | $140 paid | Needs review | Amount may represent multiple sessions. |
| 2026-06-12 | 15:00 | Marjo Gunnison | Friend note | Unclear | Needs review | Payment note illegible. |
| 2026-06-12 | 17:00 | Sunethra's sister | — | $65 paid | Needs review | Full client identity missing. |
| 2026-06-12 | 19:00 | Tracy Silva | — | $100 paid | Needs review | Confirm surname. |
| 2026-06-15 | 11:00 | Stephanie Elmal | — | $80 | Needs review | Surname uncertain. |
| 2026-06-15 | 13:00 | Omar Albeytani | Round 4 | $70 paid | Needs review | Name spelling uncertain. |
| 2026-06-15 | 15:00 | Tina Hartley / Cremo | — | $70 | Needs review | Client-name boundary unclear. |
| 2026-06-15 | 17:00 | Remy | Personal / unknown note | $70 | Needs review | Single name and appointment meaning unclear. |
| 2026-06-15 | 19:00 | Donna Ware / Wanda Hopp | Round 2 | $70 | Needs review | Unclear whether one or two clients. |
| 2026-06-16 | 11:00 | Maria | Fire Soul note | $70 paid | Needs review | Single name only. |
| 2026-06-16 | 13:00 | Fabian's daughter | — | $70 paid | Needs review | Full client identity missing. |
| 2026-06-16 | 15:00 | Kimberly Benus | Round 2 | $70 | Needs review | Confirm surname spelling. |
| 2026-06-16 | 17:00 | Angela Marshall | Round 2 | $70 paid | Needs review | High transcription confidence; production match required. |
| 2026-06-16 | 19:00 | Sunethra's brother | — | $60 paid | Needs review | Full client identity missing. |
| 2026-06-16 | 20:30 | Lori's granddaughter | — | $10 | Needs review | Full client identity and appointment type missing. |
| 2026-06-17 | 11:00 | Jackie (JE Reiki) | WhatsApp | $80 paid | Needs review | Full identity uncertain. |
| 2026-06-17 | 13:00 | Feng / Seallan Penny | — | $80 paid | Needs review | Client-name boundary uncertain. |
| 2026-06-17 | 15:00 | Cyndi Powers | — | $70 paid | Needs review | High transcription confidence; production match required. |
| 2026-06-17 | 17:00 | Linda Francis | Round 2 | $70 paid | Needs review | High transcription confidence; production match required. |
| 2026-06-17 | 19:00 | Shawna Hensky | — | $80 paid | Needs review | Surname uncertain. |
| 2026-06-18 | 13:00 | Sharon | WhatsApp | $80 | Needs review | Single name only; preceding note unclear. |
| 2026-06-18 | 15:00 | Wanda Huff | — | $70 paid | Needs review | High transcription confidence; production match required. |
| 2026-06-18 | 17:00 | Anne Collins | Round 3 | $70 | Needs review | Paid state unclear. |
| 2026-06-18 | 19:00 | Angel Johnston | Round 3 | $70 paid | Needs review | High transcription confidence; production match required. |
| 2026-06-19 | 11:00 | Tina Makris | Round 2 | $70 | Needs review | High transcription confidence; production match required. |
| 2026-06-19 | 13:00 | Linda Edwards | Round 2 / tarot | $70 | Needs review | High transcription confidence; production match required. |
| 2026-06-19 | 15:00 | Mathilde Temba | — | $70 | Needs review | Surname uncertain. |
| 2026-06-19 | 17:00 | Michelle Hudson | Round 2 | Amount overwritten | Needs review | Confirm amount/payment state. |
| 2026-06-19 | 19:00 | Patricia Savoy | WhatsApp / intentions | $70 | Needs review | High transcription confidence; production match required. |
| 2026-06-22 | 10:00 | Michelle Soboy | Round 2 | $70 | Needs review | Surname uncertain. |
| 2026-06-22 | 12:00 | David Therp | — | $80 paid | Needs review | Surname uncertain. |
| 2026-06-22 | 14:00 | Michelle S. | Friend note | $70 | Needs review | Full identity unclear. |
| 2026-06-22 | 16:00 | Susan Klimsky | Round 2 | $70 | Needs review | Surname uncertain. |
| 2026-06-22 | 18:00 | Rose Rice | Call note | $100 paid | Needs review | Confirm name spelling. |
| 2026-06-22 | 20:00 | Tammy's mom | In-person | $90 | Needs review | Full client identity missing. |
| 2026-06-23 | 10:00 | Lindsay Vigliano | Round 2 | $70 | Needs review | Surname uncertain. |
| 2026-06-23 | 12:00 | Arina Kelly | — | $70 | Needs review | Confirm first name. |
| 2026-06-23 | 14:00 | Andrew Hall / Swarden | — | $80 | Needs review | Identity and surname unclear. |
| 2026-06-23 | 16:00 | Suzette Pergande | Round 2 | $140 paid | Needs review | Amount may represent multiple rounds. |
| 2026-06-23 | 18:00 | Victoria Whitcross | — | $70 | Needs review | Production match required. |
| 2026-06-24 | 10:00 | Isidory Lyamaya | — | $80 paid | Needs review | Name spelling uncertain. |
| 2026-06-24 | 12:00 | Aneta Nep | Round 2 | $70 | Needs review | Confirm surname. |
| 2026-06-24 | 14:00 | Marjan C. | Universal call | $90 paid | Needs review | Full identity unclear. |
| 2026-06-24 | 16:00 | Susan Snyder / Connant | In-person | $80 | Needs review | Surname/note boundary unclear. |
| 2026-06-24 | 18:00 | Sarah | Viral / in-person | $50 | Needs review | Single name and service unclear. |
| 2026-06-25 | 10:00 | Lisa R. | Lisa Brinkman note | $80 paid | Needs review | Full identity uncertain. |
| 2026-06-25 | 12:00 | Kathleen Blair | Round 2 | $70 | Needs review | Production match required. |
| 2026-06-25 | 14:00 | Jeanette / Steven | — | $70 | Needs review | Unclear whether one or two clients. |
| 2026-06-25 | 16:00 | Gray Whitlock | No call | $80 | Needs review | Confirm whether this was a no-show and should be excluded/cancelled. |
| 2026-06-25 | 18:00 | Joanne Dawson | — | $80 | Needs review | Production match required. |
| 2026-06-26 | 10:00 | Rose Pierce | Round 2 | $70 paid | Needs review | Production match required. |
| 2026-06-26 | 12:00 | Dorwita | Third time | $70 | Needs review | Single/uncertain name. |
| 2026-06-26 | 14:00 | Andy Cogell | Reschedule | $70 paid | Needs review | Confirm whether appointment occurred on this date. |
| 2026-06-26 | 16:00 | Kathleen Blair / Grandma Kelly | 15 minutes | $150 | Needs review | Identity, duration, and amount mapping require confirmation. |
| 2026-06-26 | 18:00 | Sun + daughter | In house | Paid / amount unclear | Needs review | Full identities missing. |
| 2026-06-29 | 10:00 | Elaine / James Gorman | — | $80 paid | Needs review | Unclear whether one or two clients. |
| 2026-06-29 | 12:00 | Michelle Gorman | Round 2 | $90 paid | Needs review | Production match required. |
| 2026-06-29 | 14:00 | Annette Changie | Daughter | $70 | Needs review | Surname uncertain. |
| 2026-06-29 | 16:00 | Holly O. | Round 2 | $70 | Needs review | Full surname missing. |
| 2026-06-29 | 18:00 | Cindy Cook | Round 2 | $70 | Needs review | Production match required. |
| 2026-06-30 | 10:00 | Tedar / Deborah | Website note | $80 | Needs review | Identity and note unclear. |
| 2026-06-30 | 12:00 | Cindy Belich | — | $70 | Needs review | Surname uncertain. |
| 2026-06-30 | 14:00 | Marcella Albany | — | $70 | Needs review | Production match required. |
| 2026-06-30 | 16:00 | Maria Luz | Round 2 | $70 paid | Needs review | Production match required. |
| 2026-06-30 | 17:00 | Maria Luz's daughter / Hillary | 15 minute test | $40 paid | Needs review | Full identity and appointment type unclear. |
| 2026-07-01 | 10:00 | Olivia Livingston / Erin | Round 2 | $70 paid | Needs review | Identity structure unclear. |
| 2026-07-01 | 12:00 | Marcy Silva | — | $80 paid | Needs review | Confirm surname. |
| 2026-07-01 | 14:00 | Marcella | Round 4 | $60 | Needs review | Full identity and paid state unclear. |
| 2026-07-01 | 16:00 | Pat Hughes | — | $80 paid | Needs review | Production match required. |
| 2026-07-01 | 18:00 | Kelly Sullivan | Round 2 | $70 | Needs review | Production match required. |
| 2026-07-02 | 10:00 | Danielle | Round 4 | $70 | Needs review | Single name only. |
| 2026-07-02 | 12:00 | Sarah Smelt | Round 2 | $70 | Needs review | Surname uncertain. |
| 2026-07-02 | 14:00 | April Smith | Round 2 | $70 | Needs review | Production match required. |
| 2026-07-02 | 16:00 | Anna Berry | — | $80 paid | Needs review | Production match required. |
| 2026-07-02 | 18:00 | Tammy Pruitt | — | $60 paid | Needs review | Production match required. |
| 2026-07-03 | 10:00 | Trinity | — | $70 | Needs review | Single name only. |
| 2026-07-03 | 12:00 | Shea / Keti Cabell | — | $70 paid | Needs review | Identity structure unclear. |
| 2026-07-03 | 14:00 | Sally Grandes | — | $70 | Needs review | Surname uncertain. |
| 2026-07-03 | 16:00 | Mark Anthony | — | $60 paid | Needs review | Production match required. |
| 2026-07-03 | Unclear | Tarot reading | — | $30 | Needs review | No client or reliable time. |
| 2026-07-06 | 10:00 | Sandra / Joanne R. | — | $70 | Needs review | Identity structure and surname unclear. |
| 2026-07-06 | 12:00 | Erika | You Can Save It note | $80 paid | Needs review | Single name and note meaning unclear. |
| 2026-07-06 | 14:00 | Joanne Zar | Round 2 | $70 | Needs review | Surname uncertain. |
| 2026-07-06 | 16:00 | Susan Marie / Brooke Shaw | Round 2 | $70 | Needs review | Identity structure unclear. |
| 2026-07-06 | 18:00 | Kellie Killpack / Lindsey Fisher | Round 2 | $70 | Needs review | Unclear whether one or two clients. |
| 2026-07-07 | 10:00 | Kelly Sobley | — | $80 | Needs review | Surname uncertain. |
| 2026-07-07 | 12:00 | Dawn Yekrabs | Round 3 | $70 | Already exists | Production showed Dawn Yekrabs at 12:00. |
| 2026-07-07 | 14:00 | Jayne Taylor | Round 2 / WhatsApp | $70 | Already exists | Production showed Jayne Taylor at 14:00. |
| 2026-07-07 | 16:00 | Maria Padesis | Round 2 | $70 | Already exists | Production showed Maria Padesis at 16:00. |
| 2026-07-07 | 18:00 | Sarah | Viral | $50 | Already exists | Production showed Sarah Viral at 18:00. |
| 2026-07-08 | 10:00 | Dave Corath | — | $70 | Already exists | Production showed Dave Corath at 10:00. |
| 2026-07-08 | 14:00 | Marcy Stahl | — | $100 | Already exists | Production showed Marcy Stahl at 14:00. |
| 2026-07-08 | 16:00 | Debra West | — | $80 | Already exists | Production showed Debbie West at 16:00; spelling variant requires identity confirmation. |
| 2026-07-08 | 18:00 | Courtney Bussarte | Round 2 | $80 | Already exists | Production showed Courtney Bussarte at 18:00. |
| 2026-07-08 | 19:00 | Jeff | — | $70 | Already exists | Production showed Jeff at 19:00. |
| 2026-07-09 | 12:00 | Karen Harder Clements | Round 2 | $70 | Already exists | Production showed Karen Harder Clements at 12:00. |
| 2026-07-09 | 16:00 | Nancy McLennas | Round 2 | $70 | Already exists | Production showed Nancy McLennas at 16:00; planner time placement is somewhat unclear. |
| 2026-07-09 | 17:30 | Amy Walding | — | $70 | Already exists | Production showed Amy Walding at 17:30. |
| 2026-07-10 | 10:00 | Linda Hill | Round 2 | $70 | Already exists | Production showed Linda Hill at 10:00. |
| 2026-07-10 | 12:00 | Tim Makers | Round 2 / call-back | $70 | Already exists | Production showed Tim Makers at 12:00. |
| 2026-07-10 | 14:00 | Michelle Hudson | Round 3 | $70 | Already exists | Production showed Michelle Hudson at 14:00. |
| 2026-07-10 | 19:00 | Shawna's birthday group | Group / deposit | $20 deposit; balance paid cash note | Already exists | Production showed Shawna B-Day Group at 19:00; payment mapping requires review. |
| 2026-07-13 | 18:00 | Victoria Whitcross | — | $70 | Already exists | Production showed Victoria Whitcross at 18:00. |
| 2026-07-15 | 18:00–19:30 | Hilda + Brandon | Two-person package | $120 | Already exists | Production showed Hilda and Brandon Two-Person at 18:00. |

## Confirmed comparison results

| Date | Time | Planner client / entry | Session / round | Payment note | Classification | Confidence / review note |
|---|---:|---|---|---|---|---|
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
