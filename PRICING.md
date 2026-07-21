# Soterra pricing - cost model and recommended structure

_2026-07-21. Unit economics are MEASURED (see `soterra-web/dev/measure-cost.mts`). Market mechanics are cited. Price bands are reasoned from margin math and still need one real customer conversation before they're locked._

## 1. What it actually costs us (measured, not estimated)

Method: extracted the real system prompt and all 15 tool definitions from `app/api/ask/route.ts`, ran representative questions through `claude-sonnet-4-6` with the real prompt-caching setup, and read `usage` off the responses. Each question run twice so the second pass reports warm-cache steady state.

**Per question: $0.029 USD / NZ$0.048** (single round measured at $0.0223; x1.3 for the measured average tool rounds).

| Component | USD | Share |
|---|---|---|
| Uncached input - the 6 retrieved pages at 2,800 chars | $0.0159 | **74%** |
| Output - the answer itself, ~292 tokens | $0.0044 | 20% |
| Cached prefix read - 4,762 tokens of prompt + tools | $0.0013 | 6% |

Two conclusions:
- **Prompt caching is working.** The 4,762-token prefix costs 0.13 cents per question instead of 1.8 cents. Leave it alone.
- **The cost lever is retrieval breadth, not prompt length.** If cost ever needs cutting it's "5 pages instead of 6", never "shorten the prompt". Don't cut it without re-running `dev/audit-code.mts` - accuracy is the product.

Pricing basis (verified 2026-07): Sonnet 4.6 = $3/M input, $15/M output; cache read 0.1x = $0.30/M; 5-min cache write 1.25x = $3.75/M.

### Monthly AI cost per site (22 working days)

| Scenario | Questions/mo | Cost |
|---|---|---|
| 3 crew, light (2/person/day) | 132 | NZ$6 |
| 3 crew, active (5/person/day) | 330 | NZ$16 |
| 8 crew, light | 352 | NZ$17 |
| 8 crew, active | 880 | NZ$42 |
| 15 crew, active | 1,650 | NZ$80 |

**Everything else is fixed and already shared** across the other projects (Vercel Pro, Clerk, Neon, Blob). Indexing plans is $0 - `unpdf` extracts text locally and retrieval is local TF-IDF. Storage for a 108MB plan set rounds to nothing. **Per-site marginal cost is the AI and nothing else.**

## 2. Why NOT per seat - now with numbers

The original instinct was to tier by crew size, 3 guys cheaper than 8. The measurement kills that:

**3 crew costs NZ$6/month. 8 crew costs NZ$17/month. An eleven dollar difference.**

There is no cost justification for charging per head. And there's a strong reason not to: this product only earns trust if the whole site uses it. If the PM buys 3 seats for a 12-person crew, the chippie rings the PM anyway, it becomes "the thing Dave checks sometimes", and it doesn't renew. Per-seat pricing rations exactly the adoption that makes it stick.

Value tracks the **project**, not the crew. A 3-person crew on a $30M tower gets far more from this than 8 people on a house extension.

## 3. What the market evidence says

Verified mechanics worth copying or avoiding:

- **Intercom Fin** - $0.99 per resolution, but **capped at one charge per conversation** no matter how much work it takes. Copy this principle: the customer's number stays legible while we absorb the variance.
- **Salesforce Agentforce** - moved off $2/conversation to Flex Credits ($0.10/action, 100k credits for $500) because "conversation" didn't map to value delivered and punished multi-turn use.
- **GitHub Copilot** - 300 premium requests/user/mo, $0.04 overage, model multipliers up to 27x. Widely criticised because nobody can predict a bill from a multiplier table. But its **block-on-exhaustion toggle** is the right primitive.
- **Cursor, June 2025** - the cautionary tale. Switched existing users to metered API-rate pricing, users burned their allocation in a handful of prompts, CEO publicly apologised and refunded three weeks of charges. The churn wasn't the price level. It was **changing the meter on existing users, and using a unit customers couldn't count in their heads.**
- **Windsurf, March 2026** - **retired credit billing entirely**, stating credits "charged the same rate for both simple and complex requests", which caused **"users to be scared of asking quick questions."** This is the single most relevant data point we have. A builder who hesitates before asking "what's the fire rating on this wall" because it might cost a credit is a builder who rings the PM instead, and the product has failed.
- **Adobe / Salesforce credits** - sustained buyer backlash. Salesforce ran **three pricing models in eighteen months**; the documented complaint isn't the rate, it's that "nobody on the call can usually say what a single support ticket will actually cost." Metronome's practitioner quote: *"Our finance team likes it. Our customers don't know what a credit does."*
- **Margins (ICONIQ, Jan 2026)** - AI product gross margin averages **52%**, up from 41% (2024) and 45% (2025). Traditional SaaS sits at 80%. Analyst floor for AI-native is 60-65%. Public SaaS companies now disclose inference cost at 4-9% of revenue.
- **Hybrid pricing (Maxio 2025)** - 61% of B2B software now uses some hybrid form, up from 49%; hybrid users report the **highest median growth at 21%**, beating both pure subscription and pure usage.
- **Bessemer's formula** - platform fee at **2x calculated delivery cost**, plus outcome credits. Worked example: $12K/yr platform fee including 100 resolutions, additional at $5K/100.

The margin trend matters: **costs fall over time.** Price on value, hold the price, let cheapening tokens accrue as margin. That's what the 41 -> 45 -> 52 curve is the industry doing.

**No credit system.** Between Windsurf retiring theirs, Adobe's backlash, Salesforce's three models in eighteen months and Cursor's refunds, the evidence is one-directional. Credits are, in Metronome's words, "useful, but not loved" - born of vendor necessity, not customer preference. Our whole value proposition is that asking is free and instant.

## 1b. Corrections to the cost figure (double-checked)

Two things I got wrong first time, both making the real number **higher**:

1. **`search_plans` sends 8 pages, `search_code` sends 6** (route lines 511 / 521). I measured the code path. Plan questions are the core product and carry ~33% more retrieval payload.
2. **I omitted `dynamicContext`** - the date, upcoming events, open tasks and crew list the route prepends to every call. That's uncached input on every question.

Corrected blended estimate: **~US$0.033 / NZ$0.055 per question**, against the NZ$0.048 first reported. About 15% higher. It doesn't change any conclusion - margins stay 83-96% - but the honest number is NZ$0.055.

## 1c. Cost-reduction levers - tested, not guessed

Since 74% of cost is the retrieval payload, that's the only lever worth pulling. Tested against the accuracy audit:

| Lever | Accuracy | Verdict |
|---|---|---|
| Baseline: 6 pages, 2,800 chars | **15/15** | current |
| **4 pages**, 2,800 chars | **14/15** | ❌ **costs an answer. Don't.** |
| **Haiku 4.5** ($1/$5 vs $3/$15, ~67% cheaper) | untested | 🅿️ **PARKED - accuracy first** |

**Cutting retrieval breadth is off the table** - dropping to 4 pages lost an answer, and accuracy is the product.

**Model routing to Haiku is parked by decision, not by evidence.** Being mistake-free at launch is worth far more than trimming a rounding error; a wrong answer on a compliance question early would cost more reputation than the AI bill costs money. Revisit only once the code layer has a track record in real use, and only for demonstrably simple lookups - never for RFI drafting or anything code-critical. The harness is ready when we want it: `MODEL_ID=claude-haiku-4-5 npx tsx dev/audit-code.mts --excerpt`.

**The honest framing: cost reduction is not the priority.** At NZ$26-42/month to serve even a busy 7-person school site against NZ$99-299 revenue, shaving the AI bill is rounding-error optimisation. The two things that actually matter are the **uncapped ceiling** (section 6) and the **large-plan-set slowness** (section 1g).

## 1d. 🔴 Operational: the API key ran out of credit mid-audit

While measuring, the Anthropic API returned `400 - credit balance is too low`. That's worth flagging because **the live app fails the same way**. If the key empties, every assistant question errors. Before charging anyone:
- Set up auto-reload or billing alerts on the Anthropic account
- Make sure the route surfaces a clear message on that specific error rather than a generic failure

## 1e. Infrastructure - what it actually costs (checked, not assumed)

Measured current usage: **103.4 MB of blobs, a 14 MB database.**

| Service | Usage | Cost |
|---|---|---|
| **Vercel Pro** | $20 USD/mo, **already paid** and shared with the other projects | marginal cost of Soterra ≈ $0 |
| **Vercel Blob** | 103 MB against 1 GB included in Pro | **free** (~10 sites before overage, then $0.023/GB-mo = trivial) |
| **Neon** | 14 MB against a 0.5 GB free tier | **free** on storage; the 100 CU-hours/mo compute limit bites first |
| **Clerk** | free to 10,000 MAU | **free** for a long time |

| Stage | Fixed monthly |
|---|---|
| Today (1-5 customers) | **NZ$33** |
| ~20 customers (Neon Launch $19) | **NZ$65** |
| ~100 customers | **NZ$73** |

**There is nothing meaningful to cut.** Soterra is already running on roughly NZ$33/month of infrastructure, most of which is a Vercel bill that exists anyway. Indexing is $0. The only cost that scales with customers is AI, and it scales gently.

## 1f. NZ tax (Ltd) - structure, not advice

I'm not your accountant and you should confirm this with them, but the structural facts:

- **Company tax: 28%** on profit.
- **GST: 15%. Registration required once turnover passes NZ$60,000** in any 12-month period. That's **51 customers at NZ$99**, 34 at NZ$149, 17 at NZ$299.
- **Quote prices EX GST.** Every NZ comparable does (Buildxact, Tradify, NextMinute, Xero all publish "NZD, ex GST"). Your customers are GST-registered builders who claim it straight back, so GST is **neutral to them** and adding it doesn't make you more expensive.
- **Registering before you have to is usually the right call** for a B2B seller - it's neutral to your customers and lets you claim input credits on your own spend. Worth a five-minute conversation with the accountant.
- **Overseas B2B purchases** (Anthropic, Vercel, Clerk) go through the reverse-charge mechanism rather than the supplier charging you NZ GST. Generally neutral if you're making fully taxable supplies.
- All of it (software, API spend, domain) is deductible.

### After-tax P&L at the two candidate entry prices

| Customers | NZ$99/mo net after tax | NZ$149/mo net after tax |
|---|---|---|
| 10 | NZ$7,167/yr | NZ$11,487/yr |
| 25 | NZ$18,076/yr | NZ$28,876/yr |
| 50 | NZ$36,711/yr | NZ$58,311/yr |
| 100 | NZ$73,909/yr | NZ$117,109/yr |

## 1g. Worked example: a school project, 7 crew (`dev/model-school.mts`)

Cost per interaction type, built from measured token components:

| Interaction | Cost (USD) |
|---|---|
| **Plan question** (8 pages + context, 1.3 rounds) | $0.0331 |
| **Code question** (6 pages + context, 1.3 rounds) | $0.0269 |
| **Calendar / task / reminder** (no retrieval, 2 API calls) | **$0.0081** |

Calendar and reminder operations are the **cheapest** thing the assistant does - about a quarter of a plan question - because they carry no retrieval payload. They cost two API calls (one to emit the tool call, one to confirm) but send no pages. Adding scheduling to the product barely moves the bill.

**7 crew on a school, 22 working days:**

| Questions/person/day | Realistic mix (50/25/25) | Heavy plan use | Worst case (100% plan) |
|---|---|---|---|
| 4/day = 616/mo | **NZ$25.87** | NZ$30.35 | NZ$33.87 |
| 5/day = 770/mo | **NZ$32.34** | NZ$37.94 | **NZ$42.34** |

**Even at the deliberately high 5 questions per person per day, with every single one a plan lookup, a 7-person school site costs NZ$42/month to serve.** On the NZ$299 Builder tier that's 86% margin; on NZ$149 it's 72%.

### Does a much bigger plan set cost more? No.

A school will have thousands of sheets, not 120. **AI cost is flat regardless**, because retrieval always sends the top 8 pages no matter how big the corpus is. 120 sheets or 5,000 sheets, the model sees 8. Indexing is $0 and storage is trivial.

### 🔴 But a big plan set makes the app SLOW - this is the real problem

`getProjectIndex` (route line 40) loads **every page of the project from Neon on every single question**, then rebuilds the TF-IDF term map from scratch. Benchmarked locally:

| Plan set | Data loaded per question | CPU per question |
|---|---|---|
| 120 sheets (Kauri Tower today) | 0.4 MB | 55 ms |
| 571 pages (Arthur Road) | 1.4 MB | 299 ms |
| 1,500 pages | 3.9 MB | 620 ms |
| 2,500 pages (realistic school) | 6.4 MB | **1,201 ms** |
| 5,000 pages | 12.7 MB | **1,965 ms** |

That's pure compute, **before** the network time to pull 6-12 MB out of Neon and before the model has generated a single token. At school scale we'd be adding roughly **2-3 seconds of dead time to every answer**, and pulling ~4 GB/month out of the database.

The dollar impact is small (it fits inside the Vercel and Neon allowances). **The product impact is not** - a builder standing in the rain waiting 6 seconds for an answer stops asking. The `code_pages` corpus is already cached per warm server (`CODE_CACHE`); the project index is not, because of the "a fresh upload must show up immediately" requirement. It needs the same treatment with invalidation on upload.

**This is a scaling bug, not a pricing problem, and it should be fixed before selling to anyone with a big plan set.**

## 1h. "How do we know how many people work there?"

The concern: project size doesn't predict headcount. A $100M job might have 25 people from the main contractor, or 10.

**Tested against the real numbers, and the concern doesn't break the model:**

| Same $100M job | Crew | Questions/mo | AI cost | Margin on NZ$599 |
|---|---|---|---|---|
| Lean contractor | 10 | 880 | NZ$36.96 | **94%** |
| Adam's actual job | 25 | 2,200 | NZ$92.40 | **85%** |
| Very heavy | 40 | 3,520 | NZ$147.85 | **75%** |

**The 10-vs-25 difference is NZ$55/month on a NZ$599 tier.** That's noise. You do not need to know the headcount, because at the top tier the price absorbs any plausible crew size.

### Where headcount *would* hurt: a big crew on the cheap tier

| Crew | Tier | AI cost | Margin |
|---|---|---|---|
| 7 | NZ$149 | NZ$25.87 | 83% |
| 7 | NZ$99 | NZ$25.87 | 74% |
| 15 | NZ$99 | NZ$55.44 | **44%** |
| 25 | NZ$99 | NZ$92.40 | **7%** ⚠️ |
| 25 | NZ$149 | NZ$92.40 | 38% ⚠️ |

**The risk isn't "we can't count people". It's a 25-person operation sitting on the entry tier.** Two defences, neither requiring headcount tracking:

1. **Turnover banding, self-declared at signup.** This is exactly what Buildertrend does - their pricing form asks you to pick your annual construction volume bracket. A 25-person contractor is not a sub-$5M-turnover business, so the band moves them up on its own.
2. **The fair-use cap** catches anyone who slips through, without anyone having to audit a headcount.

So: **band on turnover, never on people.** Turnover is declarable, verifiable enough, and it's what the whole NZ market already prices on (Procore's ACV, Buildertrend's volume brackets, Master Builders' own fee bands).

## 3b. NZ market benchmarks (verified from vendor pricing pages)

| Product | Price | Unit |
|---|---|---|
| **Buildxact** Foundation / Pro / Master | **NZ$199 / $399 / $599 per month, flat** | **unlimited users** |
| Buildxact **AI add-ons** | **+NZ$99 / $99 / $149 per month** | add-on |
| **NextMinute** Tradie Growth / Pro | NZ$199 (3-9 users) / $349 (10-14) | flat, user band |
| **Tradify** Lite / Pro / Plus | NZ$48 / $52 / $62 | **per user**/month |
| **Fergus** Basic / Professional | NZ$53 / $75 | per user/month |
| **Xero** Standard (anchor) | NZ$65 | flat |

A 5-person NZ residential builder's core stack lands at roughly **NZ$265-325/month ex GST**.

**Procore** is ACV-based, quote-only, unlimited users, unlimited storage - confirmed from their own AU page. Their SEC filings give the only hard number: FY2025 US$1.3B revenue across 17,850 customers = **~US$72,800 average per customer per year**. Unverified user reports put small contractors at US$500-800/month and mid-size at US$1,000-3,000/month. **Buildertrend has now copied the ACV model too** and removed its published tiers.

**AI document tools price far above trade tools**: Quotr.ai (the closest comparable, plan Q&A in plain English) charges **US$299.90/month for one seat**; Togal.AI US$199-299/user/month; Handoff US$119-719/month. That's 4-6x what NZ job-management tools charge per seat. **AI plan tools are priced as a professional-services replacement, not a software seat.**

## 4. Recommended structure

**Corrected from the earlier draft.** I initially recommended per-project. The NZ market evidence says otherwise: **not one comparable prices per project.** Buildxact is flat per company with unlimited users. NextMinute is flat by user band. Procore and Buildertrend are both per company banded by annual construction volume, with unlimited users *and* unlimited projects. A builder running five concurrent jobs does not want five subscriptions.

- **Unit: per company, per month, banded by annual construction volume.** Fixed price. This is what the market already does and what builders already understand.
- **Unlimited users and unlimited projects** inside the band. Always.
- **Offer a per-project option only for one-off large commercial jobs**, where software genuinely gets costed into the prelims.
- **One charge per question thread**, however many retrieval rounds it takes (Intercom's principle).
- **Published fair-use ceiling** as a plain number, not credits. Credit systems obscure value and read as deceptive.
- **Alert at 80%, hard block at 100%, one-click top-up.** Never auto-bill past the cap. For a fixed-budget buyer a block is reassuring; a surprise invoice is a lost renewal.
- **Archived projects stay queryable free.** Costs almost nothing (storage only, no AI) and makes the platform sticky across job cycles.

## 5. Who is actually out there (Stats NZ, official, Feb 2025)

Before setting bands, the real shape of the market. Construction enterprises by turnover:

| Turnover | Enterprises | Share | Cumulative |
|---|---|---|---|
| under $100K | 30,177 | 37.2% | 37.2% |
| $100K-500K | 30,489 | 37.5% | **74.7%** |
| $500K-1M | 8,091 | 10.0% | 84.7% |
| **$1M-5M** | **9,837** | 12.1% | 96.8% |
| $5M-10M | 1,386 | 1.7% | 98.5% |
| $10M-20M | 714 | 0.9% | 99.4% |
| $20M-50M | 357 | 0.4% | 99.8% |
| $50M+ | 168 | 0.2% | 100% |
| **Total** | **81,219** | | |

**Three quarters of NZ construction firms turn over under $500K.** And by headcount, 67.4% have **zero employees** and 90.6% have five or fewer. Residential Building Construction (27,993 firms) averages **1.3 employees per firm**. Non-residential (1,656 firms) averages 6.8.

Two consequences:

1. **The addressable market for a NZ$149+ product is ~12,500 firms, not 81,000.** Everything below $1M turnover is a sole trader whose Master Builders fee is $260/year. NZ$1,788/year is not a realistic ask for them, and pretending otherwise would produce a tier nobody buys.
2. **Only 1,239 firms turn over $10M+.** That is the entire Procore-prospect pool in New Zealand. It's another reason not to build the strategy around Procore integration.

Consent values for context (Stats NZ, year to May 2026): average new dwelling **$449,800**; standalone house **$574,500**; renovation **$88,800**; new non-residential **$1.65M**; new commercial building **$3.92M**.

## 5b. The ladder

Band on turnover, using bands the industry already uses. **Registered Master Builders sets its own membership fees on exactly this basis**, which is proof NZ builders already accept revenue-scaled pricing.

| Tier | Band | Firms | Price | What RMB charges that segment/yr |
|---|---|---|---|---|
| **Site** | $1M-5M turnover | 9,837 | **NZ$149/mo** (NZ$1,788/yr) | Residential $500k-2M: **$1,900** |
| **Builder** | $5M-20M | 2,100 | **NZ$299/mo** (NZ$3,588/yr) | Residential $2M+: **$3,475** · Volume: **$4,160** |
| **Commercial** | $20M+ | 525 | **NZ$599/mo** (NZ$7,188/yr) | Commercial: **$4,160** · Major: **$8,810** |

Every rung lands within a few hundred dollars a year of a fee that segment already pays a trade association for brand access. That's the sales anchor: *"you already pay RMB $1,900 a year for the guarantee. This is the same money for something that answers your code questions with the clause number."*

Cross-checks: NZ$149 sits **below Buildxact Foundation (NZ$199)** and **above their AI add-on (NZ$99-149)**, so it reads as a real product not a bolt-on. NZ$299 is well under the **US$299.90 (~NZ$500) Quotr.ai charges for one seat** at plan Q&A, and we're unlimited users.

**Deliberately no sub-$1M tier at launch.** 68,757 firms sit there and it is tempting, but their willingness to pay is anchored at a $260/year association fee. Revisit only if a much lighter product emerges.

### Gross margin at realistic NZ firm sizes

Earlier drafts modelled 8-15 crew. Stats NZ says the average residential firm is **1.3 employees**, so those were wrong. Corrected:

| Firm | Questions/mo | AI cost | Margin on NZ$149 |
|---|---|---|---|
| 1 working owner | 110 | NZ$5.30 | **96%** |
| Owner + 2 | 264 | NZ$12.73 | **91%** |
| Owner + 5 | 528 | NZ$25.45 | **83%** |

Margins are better than first modelled, because NZ construction firms are much smaller than assumed. The band enforcement still matters at the top: a 25-person operation on heavy usage would run the NZ$149 tier negative, which is why turnover is verified at signup.

### What the business looks like

Penetration of the $1M+ bands (12,462 firms):

| Penetration | Customers | Revenue |
|---|---|---|
| 0.5% | 63 | NZ$149k/yr |
| 1% | 124 | NZ$287k/yr |
| 2% | 250 | NZ$582k/yr |
| 5% | 623 | NZ$1.44M/yr |

**1-2% of the addressable NZ market is a NZ$300-580k/year business.** That is a genuine solo-founder outcome and it validates the price points. It is also small enough to say plainly: NZ alone caps out, so the product either goes deeper per customer or eventually goes offshore.

## 5b. The ROI line that closes the sale

**MBIE, year ended June 2025 (official): 64.6% of NZ building consent applications required an RFI. Median applicant response time: 11 working days.**

Two in three consents generate an RFI, and each one costs a median of eleven working days. That is a government-published pain statistic, and it is the single most quotable number in this whole package.

Against published NZ professional rates (DTCE rate card): **CPEng NZ$280/hr, Director NZ$320/hr.** One avoided 2-hour engineer callback is worth ~NZ$560 + GST, which pays for:

- **3.8 months** of the NZ$149 tier
- **1.9 months** of the NZ$299 tier
- **0.9 months** of the NZ$599 tier

One avoided callback per quarter covers the entry tier outright. That is the hard-ROI answer to Bessemer's 2026 renewal warning.

**And the market gap is real:** 66.7% of residential builders now use AI (up from 37.8% in a year), but the applications are marketing 65%, client communication 60%, sales 42.5%. **All front-office. Nobody is using AI on the technical side.** That's the opening.

## 6. 🔴 The margin hole to fix now

The current daily cap is **300 assistant calls per site per day**.

**9,000 questions/month x NZ$0.048 = NZ$434/month of AI cost for one site.**

That exceeds every candidate price point. Nobody will ask 300 questions a day, but the cap is the exposure ceiling and right now it sits above what we'd charge.

Cap needed to hold AI cost at or below 35% of revenue:

| Price | Max AI spend | Cap |
|---|---|---|
| NZ$99 | NZ$35/mo | ~700 questions/mo (33/working day) |
| NZ$199 | NZ$70/mo | ~1,450/mo (66/day) |
| NZ$299 | NZ$105/mo | ~2,150/mo (99/day) |

**Recommended: replace the flat 300/day with a per-tier monthly cap.**

The documented method is the **95th percentile rule** - set the cap where it accommodates 95% of the base with zero friction. Published example distributions are power-law: typical users at 5-20k API calls/mo, P95 at ~75k, P99 at ~800k. The cap lands at roughly **4-15x the median user**, and P99 runs ~10x the cap.

**We don't have that distribution yet, and we should not guess it.** The best documented tactic here is Figma's: when they introduced AI credits in late 2025 they **deliberately did not enforce limits for three months**, collected real consumption data, found the power law, and only then set tiers. That's exactly right for us - we have one real site and no usage history.

So: instrument first, publish the cap second. In the meantime keep an internal ceiling for safety, but don't put a number in front of a customer we can't defend.

Whatever number we land on, the cap's job is **to make the ceiling visible so the buyer stops worrying about it**, not to earn revenue. Alert at 80%, hard block at 100%, one-click top-up. Never auto-bill past it.

## 7. Procore positioning

Procore has **not** published AI pricing. Copilot appears bundled into some tiers; the Agents are still early-access with broad availability expected H2 2026. So the competitive threat is real but not yet shipped broadly - there's a window.

Two positions, pick per segment:

1. **Non-Procore NZ firms** - full price standalone. No gatekeeper, no bundled competitor, no terms risk. This is the cheapest sale.
2. **Procore firms** - price as a complement, a small fraction of what they already pay Procore, positioned on the gap Procore won't fill: **NZ Building Code citation**. NZ is too small for a US platform to build compliance for.

**The thing that kills us is pricing in the middle**: too expensive to be an easy add-on for Procore shops, too generic to stand alone.

### What challengers who faced a bundled incumbent actually did

Slack vs Teams, Zoom vs Teams, Calendly vs Microsoft Bookings, Grammarly vs Microsoft Editor, Docusign vs free e-sign. **Not one of them won by undercutting on price.** Every one held or raised price and defended on one of three things:

1. **A capability structurally absent from the bundle** - Calendly stayed at $12-20/user against a free-in-M365 Bookings, defended by paid bookings, Stripe, multi-currency. Premium justified by a revenue-generating capability, not a quality delta.
2. **Presence outside the host's walls** - Grammarly survived by being in every browser and every app, not just Word.
3. **Becoming a complement, not a rival** - Grammarly ships a Grammarly-for-Word add-in. It made itself part of the host.

Sobering counterpoint: Slack held price, ran a 30% free-to-paid conversion (vs a 2-5% benchmark), and still ended up with lower ARPU than Teams and was ultimately acquired. What actually ended the bundle was **antitrust**, not competition. "Hold price and win on product love" has a mixed record.

### The evidence on "we already get AI free from our incumbent" is genuinely contested

Against us:
- **Futurum, Feb 2026 (n=830)**: best-of-breed procurement fell to **20.7%**, down 3.6 points; "mostly platform" surged to **65.9%**; **41% of orgs are actively planning to cut applications**. Stated reason: AI needs consolidated data, and point solutions impose an "integration tax."
- **a16z**: **65% of enterprises prefer incumbent solutions** when available - trust, integration, procurement simplicity.
- **G2 2025**: buyers increasingly expect AI as **bundled table stakes**, not a priced add-on.

For us:
- **Tropic spend data**: AI-native spend grew **94% YoY** at mid-market/enterprise while traditional SaaS grew **8%**. Buyers *say* they prefer incumbents; their wallets say otherwise.
- **a16z again**: the reason buyers do pick AI-native vendors is **rate of innovation**, and **81% of enterprises run 3+ model families in production**. Multi-vendor is the operating reality.
- **SaaStr's argument** (opinion, not survey): incumbents ship AI "maybe 60% as good" and the gap has widened, not narrowed.

**The warning that matters most** (Bessemer): 2025 was "AI adoption at all costs" with minimal price sensitivity. As those pilots hit **first renewal in 2026, pricing has to reflect actual value, not potential.** Soft-ROI AI products get culled at renewal. We need a hard, demonstrable number.

### The objection handler

When "Procore already gives us AI" lands, don't argue capability. Ask two questions:

1. Does it cite the **NZ Building Code clause by number**?
2. Has it been **audited for fabrications**?

**Ours has: 15/15 correct, 15/15 cited, 0 fabricated clauses** (`dev/audit-code.mts`, corpus-verified). In a liability-sensitive industry, a verified citation-accuracy audit is a defensible reason to pay alongside a free bundled tool. That audit is the pricing power - it's also the "hard ROI" answer to the 2026 renewal problem.

## 8. What to validate with Maree

Structure can be decided now. The number can't. Ask:

1. What does she pay per month for construction software today, in total?
2. Would this sit in the job's prelims, or come out of an overhead budget? (Decides per-project vs per-company.)
3. What's the approval threshold before it needs to go up the chain?
4. Roughly how many questions a day would her crew realistically ask?
5. What's one avoided RFI or one avoided callback to the architect worth in dollars?

Question 4 is the one that sets the fair-use cap honestly.

## 9. Open

- **Fair-use percentiles need real instrumented usage.** This is the only blocker on publishing a cap. Follow Figma: measure first, set second.
- NZ builder crew sizes, typical contract values and concurrent-project counts - not confirmed, so the usage assumptions in section 1 are reasoned, not measured.
- Cost of a delay day or a rework event in NZ dollars - not found. One promising lead: a NZ trade-press piece claiming "one in six hours lost on rework", worth chasing.
- Simpro, Assignar, Buildertrend, Document Crunch, Trunk Tools and Bild AI are all quote-only; the third-party figures circulating for them are low quality and were not used here.
- Whether Procore AI ends up bundled or separately paid - still not committed publicly as of 2026-07.

## 9b. Staying cheap and competitive at launch

The ask was to stay cheap early and be competitive. The infra section shows we already *are* cheap - NZ$33/month to run the whole thing - so "cheap at the start" is about **what we charge**, not what we spend. Recommendation:

**Launch with a founding price, not a permanent low price.**

- **Founding rate: NZ$99/mo** (all tiers, first cohort), locked for the life of their account. Still 84%+ margin.
- **List price stays NZ$149/299/599.** The founding customers see they're getting a deal that later customers won't.

Why founding-rate rather than just pricing low:
- A permanent low price is **very hard to raise** - you'd be re-pricing existing customers, which is exactly the Cursor mistake. A founding rate lets you honour early backers *and* charge list to everyone after, with no bad-faith increase.
- It creates urgency now ("this rate won't last") without cheapening the product long-term.
- NZ$99 undercuts Buildxact's NZ$199 entry and sits right at their AI add-on price, so it reads as competitive without looking like a toy.

**Don't go free.** A free tier for this product is a trap: every free user still costs real AI money (unlike storage-only free tiers), and "free" signals "not serious" to a builder deciding whether to trust it on a compliance question. A **14-day free trial with no card** (which you already run on Montázs) is the right shape - it costs you a few dollars of AI per trial and filters for real intent.

**One lever to keep in reserve, not use yet:** annual prepay at ~2 months free (NZ$990/yr instead of NZ$1,188). Improves cash flow and cuts churn, but adds a procurement step, so introduce it once you have a few monthly customers, not at launch.

## 10. Decision summary

Settled and evidence-backed:
- **Per company, per month, banded by annual construction volume.** Unlimited users, unlimited projects.
- **Flat price. No credits, no per-question metering** (Windsurf retired credits because they made users scared to ask quick questions - fatal for this product).
- **Ladder: NZ$149 / NZ$299 / NZ$599**, anchored on the Master Builders fee bands builders already pay.
- Fair-use cap exists but is **measured before it is published**; alert at 80%, hard block at 100%, manual top-up, never auto-bill.
- Hold price as token costs fall.

Needs one real conversation before locking: the numbers themselves.
