# 1. WHAT ELSE TO SHOW

Ranked by what lands with a PM, and by demo risk. All of these exist and work today.

1. **The pre-inspection check on a phone, with a photo, then the PDF.** Generate a pre-line check in chat, open it on your phone, tick one item "needs fixing", take a photo of whatever wall is near you, add a note, then hit the PDF button on the laptop and show the branded document with the source badge and citation on every line. This is the only thing on your list that shows a *second person* using Soterra, which is exactly what per-seat pricing rests on.

2. **"Can I book pre-line yet? The plumbing pipework hasn't been signed off."** The AC1229 inspection-order knowledge answers it and warns about the hard dependency. A wasted booking fee plus a lost day is a number the PM can put on your product in his head, immediately.

3. **`review_plans`, the whole-set audit.** Ask something like "read the architectural and structural sets against each other and tell me anything that doesn't line up at the level 2 penetrations". Rehearse the exact sentence tonight, use the sentence that worked, do not improvise on the day. It reads 420k characters so it is slow and it only fires if the model judges the question broad enough. It is the most impressive thing you have built and its discovery rate is currently zero.

4. **Drawing revision supersession, shown through a citation.** Ask a question that hits a re-issued sheet, tap the citation chip, point at "Rev.3" in the sheet header and say: "Rev.1 is still sitting in the folder you sent me, and it cannot be cited, ever." Every PM has been burned by a superseded detail. Nobody will notice this feature unless you say it out loud.

5. **Photograph the wall and ask.** Camera button in the composer, take a picture of a junction, "is this right for a 60/60/60 wall?" This is your field-verification story and it takes fifteen seconds to show.

6. **Drag the entire consent folder in, subfolders and all.** The Upload tab walks the whole directory tree. This kills the "how much work is setup" objection before it is asked, and it justifies the $500 onboarding rather than undermining it.

7. **A safety plan from chat.** "Write me a SWMS for the roof edge work on level 4." HSWA-grounded, its own PDF with the warning footer. There is no button for it, so you have to type it, but the reaction is "you do that as well?" and it is adjacent budget.

8. **The CCC evidence pack.** New check, CCC evidence. Say the line: start the pack at the beginning, the PS4 is the long pole. That is the end-of-job pain and nothing on your screen currently tells them you handle it.

If there is time: tap an MBIE determination citation so the real building.govt.nz PDF page opens (strong for a council audience), and mention pooled history across sites (that is the account-expansion story, and it is three levels down in a hamburger).

**Do not open these tomorrow:**
- **The Plans tab on the demo site.** It shows hardcoded fake documents that all open the same fabricated Resene answer. If he taps two different sheets and gets the identical response, you have shown him a fake product. Demo on a real site, or do not open Plans.
- **The Upload empty state on the demo site**, which says "43 Kauri Road" while the Plans tab says "1 Arthur Road".
- **Do not send him to soterra.co.nz afterwards without warning.** The landing page promises a shared calendar and "booked from one chat", and your assistant's system prompt refuses to do either. If he tries the homepage demo line, he gets declined. Also `/preview/*` is publicly reachable in production right now, including an index page asking the reader to pick which design becomes the real site. Take that offline before the meeting, it is a five-minute middleware change.

---

# 2. THE HISTORY LEARNER: NO

**Do not load reports into the live database tonight.** Three independent reasons, any one of which is enough.

**It would probably make the demo worse, not better.** Auckland Council reports carry a rolling "ITEMS TO BE RESOLVED" register that repeats every open item on every subsequent report. Measured across your 27 council PDFs: "fire doors to install and seal" appears in 23 of them, including four reports whose outcome is a PASS. The extractor is told to pick up anything "outstanding" or "to be resolved", and the dedupe only works within one document. So one unfixed fire door files as roughly 23 rows, and your Insights list, whose footer literally says "the number is how many times it came up", will tell a prospect you failed on fire doors 23 times. That number is wrong by an order of magnitude and it is on the screen you would most want to show.

**There is no delete.** The inspections route is GET and POST only. A bad read is permanent unless you go to raw SQL. Polluting Insights at midnight with no undo, before a 9am meeting, is not a trade worth making.

**The blocker may not even be yours to fix tonight.** The deterministic parser only returns items on 4 of 27 council reports, so the model is the sole source on the rest, and the route refuses a degraded read with a 503. If the Soterra Anthropic org is still empty, nothing files at all and you will spend an hour finding that out.

### 🚩 PII: this is the hard flag

**The raw reports contain real personal data and the scrubber leaks.** Measured over the corpus: 453 email addresses and 92 phone numbers, plus named council inspectors, named site contacts, real Auckland street addresses, and a real, publicly searchable consent number.

- `anonymise.ts` removes 100% of the emails, but the phone regex requires `0d` after `+64`, and the international form drops the leading zero. Result: the inspector's mobile survives in every one of the 26 council reports, and 51 numbers survive in one services report.
- The `Inspector's name` rule needs a lookahead of `Date|Signature|Page` and the real document's next token is `Inspector's email`, on text already collapsed to one line. Verified: the output still reads `Inspector's name <real full name>`.
- The vision path bypasses text scrubbing entirely. Five files in your corpus, including all three Seismic reports, have no text layer and go to the model as raw page images.
- The address and consent number ride along in the blob path and the document name regardless of any scrubbing.
- The anonymised demo copies are damaged. Four of them, including the Kauri Apartments council, fire and services reports, now extract zero characters because `anonymize.py` corrupted the content streams, and one has a mangled substitution reading `@consultant1rees.co.nz`.

Two consequences that matter beyond tonight. First, you need the head contractor's explicit permission before another builder's inspection reports sit in a hosted product. Second, and this is the demo-critical one: **if a prospect sees another named builder's failures on your screen, the first thing he thinks is "this guy will show mine to my competitor".** Before you open Insights or the Past inspections panel tomorrow, check what the rows actually display. If any of them carry `BCO10341827` or a real project name, do not open that panel.

### What to do instead, tonight (about 75 minutes, then stop)

**A. Rehearse. 60 minutes. Highest value, zero risk.** Run the eight demos above end to end, in order, on the real site, and write the exact sentences down. Especially `review_plans` and the SWMS request, both of which only work if you use the right words.

**B. One dry run. 15 minutes. Writes nothing.**

```
cd "C:/Users/adam/Desktop/Soterra Github/Soterra/soterra-web"
mkdir ../dryrun
```
Copy exactly three PDFs into `../dryrun`: `BCO10341827-3_3703830455_ICA_Fail_20240221.pdf`, `BCO10341827-3_..._IPL_Pass_20231220.pdf`, and one Partial Pass. Then:
```
node dev/db-status.mjs
npx tsx dev/ingest-reports.mts "../dryrun" <projectId> --dry
```
`--dry` prints every extracted item and its category and writes nothing to the database. You are looking for one thing: **does the PASS report file fire-door items?** If it does, the rolling-register double count is confirmed, and tomorrow you say "the history engine reads your past reports, I am still tuning how it counts repeats" and you do not put a repeat count on screen. If it does not, your numbers are better than I think and you can lean on them.

**C. Do not deploy anything tonight.** Including the pass-rate tile. Your `cleanPasses` and `returnVisits` figures are computed, returned by the API, and rendered nowhere, and they are the founding statistic of the company. But you already know the number, and it is derived from the outcome parsed deterministically off the council filename and header, which is correct on 27 of 27 reports. **Say it out loud instead: "on my own project, 27 inspections on one consent, 22% clean pass, 67% needed a return visit."** The tile is a Sunday-afternoon job, not a midnight one.

**Do the real ingest test in daylight, this week**, on a scratch company with the two PII holes patched first (both are one-line regex fixes) and with the corpus loaded as **one site, not folder-per-project**, because 19 of your 97 files are duplicated across the Electrical, Hydraulik and Mechanical folders and folder-per-project would triple count them.

---

# 3. WHAT TO BUILD NEXT

### 1. Turn the rolling register from your worst bug into your best feature, then put the pass rate on screen

You have been treating the carried-forward "ITEMS TO BE RESOLVED" list as noise that inflates counts. It is not noise. It is the one thing in your data nobody else has: **it tells you how long an item stayed open.** A defect that appears on reports dated 19 March, 8 April and 23 April and then stops was open for five weeks and closed. That is not "failed 3 times", it is an ageing signal, and open-item age is what delays CCC, which is what costs the money.

So: dedupe across reports on a normalised title within a company, keep first-seen and last-seen, and render "open 4 months, across 6 inspections, closed 8 April" instead of a repeat count. While you are in there, fix the grouping key (the `[1:6]` word window is eaten by punctuation, so "Cavity battens as per plan" and "Cavity battens as per plan and installed correctly" split into two groups, which is the exact pair the code comment claims it merges), kill the hardcoded `count: 1` that feeds a fabricated frequency into every free-text checklist prompt, and fix `earth(?:ing|ed|bond)`, which does not match the two-word term "earth bonding" and therefore misfiles it 35 times across 12 documents. Then render `cleanPasses` and `returnVisits`.

**Why first:** Procore ships cited answers. Anybody can wire a model to a PDF. Nobody has this company's own failure history, and a truthful ageing view of it is a genuinely defensible product. It is also the difference between a demo that impresses and a renewal that happens. Give the categoriser a real ground-truth test while you are there, because `dev/_cat-regress.mjs` has no ground truth and cannot fail.

### 2. Seat management: remove a member, change a role, rotate the code

`/api/members` is GET only. You cannot remove a person, change a role, edit a title, or revoke the join code. Anyone who has ever had the code is in permanently.

**Why:** you are selling per seat at $79/$69/$59. A per-seat product where a seat cannot be removed is commercially broken before the security question is even asked, and on a construction site subbies rotate off constantly. Councils will ask about access revocation in procurement, and right now the honest answer is "you can't". You already have `dev/verify-company-isolation.mts` proving cross-company reads fail, which is a great answer to half the security question; this is the other half, and it is a day's work.

### 3. Get the work out of the app

Today the only export in the entire product is print-to-PDF of one open checklist. A drafted RFI has to be copy-pasted out of a chat bubble. Photos taken on site never appear in the PDF. There is no Insights export, no inspection-history export, no way to email anything.

Build: email or export the RFI, put the photos into the checklist PDF (with the caption field the schema already has and the UI never sets), and a one-page Insights summary. Put your Output Notice on every one of them.

**Why:** a PM lives in email, and an RFI that cannot be sent is not an RFI. Exports are also what make Soterra visible to the ten people who did not buy a seat yet, which is how per-seat products grow inside a company. And per your own terms work, the Output Notice on exports is your actual legal protection, not the terms of service, and it can only live on an export that exists.

### Three fast jobs, under an hour each, do them this week

- **Take `/preview/*` offline.** Eight landing-page mockups are publicly reachable in production because `middleware.ts` has no `protect()`, including an index page asking which one should become the real site.
- **Cut the calendar from the landing page.** It sells a shared calendar and booking from chat, both of which your assistant is explicitly instructed to refuse, and it never mentions the checklist, the safety plan, the CCC pack, the failure history, the citation viewer or the phone app. The two most-built things in your codebase are absent from the pitch and the one cut thing is the hero.
- **Stop paying for dead context.** Every single request injects "Upcoming events (next 12 months)" and "Open tasks" into the prompt for a model that is forbidden to act on them and a user who cannot see them. You are at $0.07 a question with 53 to 63% margin. That is free money on every call.

**Do not resurrect the calendar.** Roughly 400 lines of finished UI plus 350 lines of server code are sitting there unreachable, and the temptation to make it reachable because it is nearly done will cost you the month. You cut it for the right reason. Leave it dead.

One last thing on Standards NZ: keep the handoff card as the shape until the licence is signed. Do not build anything that assumes you will get the text.