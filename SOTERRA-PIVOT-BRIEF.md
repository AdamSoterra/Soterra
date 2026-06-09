# SOTERRA — Pivot Brief (2026-06-09)

> Handoff for the new Soterra build chat. Read this first.

## The pivot — why
The old Soterra (inspection-intelligence platform: construction-program/Gantt parsing, "The Brain" historical failure analysis, dual executive/site-team dashboards, admin-gated onboarding) had **too many moving parts** for a solo non-coder to build, maintain, and explain — and it wasn't usable enough. **Scrapping that.** Rebuilding as a **simple, focused AI construction assistant** — three features, done well. The whole point is *simplify + make it actually usable.*

## What Soterra IS now (3 features)

1. **Plan reader — "Ask your plans"** ← THE wedge
   - A construction company uploads a project's **plans + architectural specs** at signup.
   - On-site users ask natural-language questions and get **instant answers WITH a citation to the source sheet/page.**
   - Examples: *"What's the wall colour in apartment 43?"*, *"What's the fire rating on the corridor walls?"*, *"What size is the beam over the garage?"*
   - Solves a **real, observed pain**: site crews waste ages flipping through plans, getting frustrated. (Adam is back on site watching this happen live = strong validation.)

2. **Calendar** — a construction version of the Montázs calendar
   - Book on the go: *"inspection tomorrow"*, *"delivery next week"*, reminders.
   - Same engine + chat-first UX as Montázs — copy it.

3. **AI assistant (chat-first)**
   - Answers from the project's uploaded plans (**Claude Vision + retrieval**) + the LLM's built-in **generic construction knowledge**.
   - No curated base-knowledge library needed.

## What we're CUTTING (from old Soterra)
- **Historical report analysis / failure prediction / "The Brain"** → **AUT is building the intelligence/history piece for us.** Out of scope.
- **Construction program (Gantt) PDF parsing** → dropped.
- **Curated base-knowledge library** (Building Code, GIB, James Hardie specs) → **NOT building it.** Two reasons: (a) copyright/IP + liability risk; (b) **unnecessary** — a project's own architectural specs already reference the relevant product specs (GIB, James Hardie, etc.) for *that* project, so the AI sees them when it reads the project docs. Generic construction knowledge comes free from the LLM.
- Admin-gated onboarding, executive dashboards, etc. → gone.

## Market
- **No longer NZ-locked.** Because the jurisdiction-specific base knowledge is gone, it works **anywhere English is spoken** (NZ, AU, UK, US, …) — it just reads each project's own universal docs.
- Only localisation needed = **time zones** (for the calendar/reminders).

## Build approach
- Move under Adam's **paid subscriptions** (Clerk, Vercel) — same stack as Montázs.
- **Reuse Montázs as the template:** Clerk auth, Vercel hosting, chat-first UX, the **calendar** (copy it), the upload → AI → answer flow, Capacitor for app + desktop/web.
- Likely a **fresh build** (Montázs-style) rather than evolving the old Supabase-based Soterra — but **port the good bits** from the existing Soterra (the Vision-based plan-reading chatbot `api/chat.py`, the plan storage).
- ⚙️ **EARLY DECISION for the new chat:** fresh build vs evolve existing. Review BOTH the Montázs codebase (calendar / Clerk / chat) AND the existing Soterra code (in this worktree) before deciding.

## The hard part — validate FIRST (before building the whole app)
- The core risk is **retrieval + accuracy over big, visual construction plans** (A1 sheets, hundreds of pages). You can't feed all of them to the AI per question — you must **find the right sheet, then read it.** (This was the unsolved "smart plan retrieval" piece in old Soterra — it's now THE core feature.)
- **Prototype "ask one real project's plans"** on actual plans → test whether Claude Vision + retrieval reliably answers *"wall colour in apt 43"*-type questions. If it's good → there's a product. If it's flaky → you learn the limits cheaply before over-building.
- **Always cite the source sheet/page** → liability shield + trust + lets the user jump straight to the drawing.

## Adam context
- PM/founder, **not a coder**, builds demos. Always push to Vercel after changes.
- Prefers **user-driven upload + Claude Vision** over integrations / APIs / webhooks.
- Back on site himself — sees the plan-reading pain firsthand.

## Existing assets to leverage
- **Montázs codebase** — calendar, Clerk auth, Vercel, chat-first UX, upload→Vision→answer flow, Capacitor app. Best source for the calendar + shell.
- **Existing Soterra code** (this worktree) — has a Vision-based plan-reading chatbot + plan storage (Supabase). Review + port the good parts. ⚠️ Memory of it is ~2 months old — verify against the actual code.

## Suggested first steps for the new chat
1. Review the existing Soterra code in this worktree + skim the Montázs codebase.
2. Decide: fresh Montázs-style build vs evolve existing.
3. **Prototype the plan-reader Q&A on ONE real project's plans** (accuracy + retrieval + citations) BEFORE building the full app.
4. Then scaffold: app (Clerk + Vercel) → calendar (from Montázs) → plan reader → AI assistant.
