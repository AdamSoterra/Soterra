# SOTERRA — HANDOVER (next thread, for Fable 5)

You are picking up the Soterra build. This thread's job: **give the iPhone
"app" a proper look and get it launch-ready — Adam is opening it up this week.**
The iPhone app is NOT an App Store app. It is the website, soterra.co.nz, opened
in **Safari → Share → Add to Home Screen (A2HS)**. That home-screen PWA is the
entire iOS channel (Adam's deliberate call — no Apple account, no review). So
"the iPhone app we download from Safari" = the installed A2HS web app.

Read this fully, then help Adam actually look at it on a real iPhone and polish
what launch needs. Adam is a PM/founder, not a coder: explain plainly, lead on
product, follow his working style (section 7).

Your persistent memory (MEMORY.md + files) already carries Soterra's full
history — this is the focused brief on top of it.

---

## 1. WHAT SOTERRA IS
An AI project assistant for construction. **Live at soterra.co.nz** (B2B,
login-only via Clerk). A company uploads its documents (drawings, specs,
consultant reports, PS1s, scopes) and inspection reports; Soterra answers
questions cited to the source page (its own documents + NZ Building Code + NZ
Standards + MBIE determinations + manufacturer literature + its own inspection
history), following a construction **order of precedence** (CI > answered RFI >
latest revision > spec = drawings > consultant/PS > Code-as-floor > standards >
manufacturer > history; a genuine clash gets flagged as an RFI). It also builds
pre-inspection QA checklists, tracks RFIs with a consultant scorecard, and turns
filed inspection reports into a "what do we keep failing on" ranking. Data
isolation (per-company, per-project) is the #1 sales point and an invariant.

## 2. STACK & DEPLOY (read carefully — these bite)
Everything is in **`soterra-web/`** (Next.js app-router, Vercel).
- Auth: Clerk. DB: Neon Postgres via Drizzle (`lib/db.ts`, `lib/schema.ts`).
- Storage: Vercel Blob. LLM: `@anthropic-ai/sdk` — `claude-opus-4-8` for
  extraction, `claude-sonnet-4-6` for the chat assistant. Retrieval: BM25/TF-IDF,
  no embeddings (`lib/retrieve.ts`).
- **`app/page.tsx`** is the whole SPA (~5,200 lines): the tabs (Assistant /
  Inspections / Plans-now-"Documents" / RFIs / Insights / Upload), chat, plan
  viewer, checklists, RFI screens, the free-trial screen, every modal.
- **DEPLOY:** a plain `git push` does NOT update the live site. It publishes only
  via the Vercel CLI: `npx vercel deploy --prod --yes --token=<TOKEN>`. Ask Adam
  to paste a token (vercel.com → Account Settings → Tokens → Full access; he
  deletes it after). Team `montazsapp`, project `soterra-web`. Always: commit +
  push to `main`, then deploy, then verify with
  `curl -s -o /dev/null -w "%{http_code}" https://soterra.co.nz` (expect 200).
  Never trust "build finished" alone.
- **Typecheck after every change:** `cd soterra-web; npx tsc --noEmit`.
- **House rule: NO em/en dashes** in any user-facing copy (plain hyphens) — it's
  an AI tell Adam hates. Applies to your chat replies too.
- **Adam never touches the terminal.** You run every command end to end.

### ⚠️ Two gotchas that cost real time this session
- **git commit messages in PowerShell:** a here-string with embedded double
  quotes breaks (`pathspec ... did not match`). Write commit messages with NO
  double-quote characters. The deploy still ran but the commit didn't — re-commit
  clean.
- **Env values from PowerShell carry a trailing `\r`.** Setting `EMAIL_TRANSMIT`
  from PowerShell stored `"1\r"`, and a `=== "1"` check read it as off — email
  was silently record-only for a day. Fixed by trimming env reads. LESSON: after
  setting any env "switch", verify a REAL effect (e.g. a row's status), not the
  presence of the var. Prefer the Bash tool with `printf '1'` for clean values.

## 3. WHAT IS LIVE (do NOT rebuild)
All shipped, reviewed, deployed, verified this session and before:
- **Documents + order of precedence** (newest, big): every upload is auto-typed
  (drawings/specs/reports/scopes/other, `lib/docType.ts`); Plans tab is now
  **Documents** with a type picker; the assistant reads by the precedence ladder
  and has a `search_directives` tool over CIs + answered RFIs. See
  memory `project_soterra_source_precedence` for the citation-safety rule (never
  put a CI/RFI on a `Source:` line — it breaks the citation parser).
- **Email sending — LIVE and PROVEN** (was the last fix). `lib/email.ts`
  `sendEmail`; RFI send via `lib/rfi.ts` `sendRfi`; Send-to-subs via
  `/api/checklists/send-fixes` + `/api/inspections/send-items`. ⚠️ Demo subs /
  consultants have FICTIONAL emails (they bounce) — to demo, send to a REAL
  address (the "Adam - EMAIL TEST" sub and the draft RFI "Signage bracket fixing
  to blockwork" are already pointed at Adam's Gmail).
- **Free 5-question trial** for signed-in no-site users (`/api/trial-ask`,
  `/api/leads`; base knowledge only; wall + lead form → emails Adam).
- **Inspections/Insights restructure**: Inspections tab = pre-inspection checks
  (cards) + filed inspection reports (a Procore-style sortable table). Insights =
  analytics only. Consultant reports: items-to-fix = **Failed**, clean = Passed
  (Adam's rule — councils keep their real Pass/Partial/Fail).
- Challenge inspection report corpus (52 reports on Adam's Desktop), floor-plan
  pin default + sheet switcher, extractor scope-block fix.

## 4. THE DEMO ACCOUNT (domokadam43@gmail.com / "Kauri Tower")
Fictional showroom data. Project `7b66634b-30ac-4722-9fbe-e375f273ecb2`, company
`e9210ba0-b03b-402b-8cfa-e6fa66d39055`, admin `user_3GcPx9L3pXhpSe20wl9H5rTuS8E`.
120 real plan pages kept (all typed "drawings"). Adam's account has demo-tier
access to gated manufacturer/standards content (Rondo, GIB, NZS demo). DB dev
scripts: `npx tsx dev/<file>.mts` — they load `.env.local` and hit PROD Neon.

## 5. YOUR TASK — the iPhone A2HS web app, launch-ready this week
**The install path IS the product on iOS:** open soterra.co.nz in Safari → Share
→ Add to Home Screen → launch from the icon. It runs standalone (no browser
chrome). Start by helping Adam install it and walk it on a real iPhone — most of
what's open can ONLY be settled on a device.

**Where the iPhone behaviour lives (verify against current code — memory is 7+
days old):**
- `app/manifest.ts` — PWA manifest (`display: standalone`, `background_color`
  `#F6FAFF`, `theme_color`).
- `app/layout.tsx` (or the root layout) — Apple meta tags, `apple-touch-icon`
  (regenerate via `node dev/render-ios-assets.mjs`), `viewport-fit=cover`,
  `theme-color #0E8FE6`, `statusBarStyle: "default"`.
- `app/components/native-shell.tsx` — sets an **`is-standalone`** class.
- `app/globals.css` — safe-area rules. ⚠️ The `is-standalone` block is a PARALLEL
  block to `is-capacitor` (the live Android app). NEVER merge or rename the
  selectors or the Android app regresses. Re-check any shared screen on Android.
- Voice on iPhone: `MediaRecorder` + `/api/transcribe` (Groq whisper, `audio/mp4`).
  The bias prompt was tuned to 10/10 against measured clips — do NOT casually
  reword it; re-run the WAV harness if you touch it.
- `app/install/page.tsx` — the `/install` explainer (good, but not findable from a
  phone today).

**🔴 Must be device-tested before launch — nothing else settles these:**
1. **Clerk session persistence in standalone** — HIGHEST risk. iOS home-screen
   apps get a storage partition separate from Safari, and ITP can evict
   script-writable storage after ~7 days. If a builder has to re-sign-in weekly,
   the channel is dead. Test: install → sign in → force-quit → relaunch after a
   few days. If it drops the session, this is the one thing that must be solved
   before real launch (investigate Clerk's iOS/standalone token persistence).
2. Clerk's sign-in modal is a fixed overlay and is the FIRST screen a home-screen
   user sees — check it respects the safe area (not under the notch/clock).
3. The reserved status-bar strip is tinted `theme-color #0E8FE6` → a brand-blue
   band above a near-white header. If it reads as a mismatched stripe, set
   `themeColor: "#F6FAFF"` (also tints Android Chrome toolbar, cosmetic).
4. Cold-launch flash (no `apple-touch-startup-image`); voice failure shape;
   keyboard overlap on the composer.

**Proposed, NOT built — Adam's call (propose before building):**
1. **Re-enable pinch-zoom** — `user-scalable=no` blocks zoom everywhere but the
   plan viewer's own +/−. Bad for reading plans in the sun + a WCAG 1.4.4 fail.
   Removing it visibly changes the LIVE Android app, so it's his decision.
2. **An A2HS "Add to Home Screen" hint** for iPhone Safari visitors — A2HS is the
   channel but there's no discovery prompt from a phone. This is likely the
   single most valuable launch-week add: without it, iPhone users don't know to
   install. `/install` exists to link to.

## 6. FIRST STEP FOR THE NEW THREAD
Confirm the task with Adam, then get him to install soterra.co.nz on his iPhone
via Safari A2HS and walk it together. Triage the device-test list above — lead
with Clerk session persistence (the launch-blocker) and the A2HS install hint
(the discovery gap). Propose the pinch-zoom / hint changes before building;
commit + push + deploy + verify as you go.

## 7. ADAM'S WORKING STYLE
- **Propose before building** anything non-trivial; show wording/design and get a
  yes. HTML-first for new UI surfaces where it helps.
- **No em/en dashes** anywhere. Plain hyphens.
- **Always commit + push to `main`, then deploy, then verify live** — he never
  touches the terminal; you run everything and report honestly (if something's
  broken or record-only, say so — the email bug hid for a day because a status
  wasn't checked).
- Lead on product/marketing (his weaker side); be research-grounded; verify
  against real data and real devices.
- He works from screenshots and from his phone — read them carefully.
- Adversarially review anything substantial before it touches the live site
  (a small multi-agent review pass caught 8 real issues on the Documents build).
