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

## 4. Recommended structure

- **Unit: per active project, per month. Fixed price.** Construction budgets per job; it goes in the prelims and dies when the job ends. A variable bill has no line to sit on at bid time, and a PM who can't tell the QS the number won't champion the purchase.
- **Unlimited users on a project.** Always.
- **Tier by project size**, not headcount. Contract value band, or documents indexed as a proxy.
- **One charge per question thread**, however many retrieval rounds it takes (Intercom's principle).
- **Published fair-use ceiling** as a plain number, not credits. Credit systems obscure value and read as deceptive.
- **Alert at 80%, hard block at 100%, one-click top-up.** Never auto-bill past the cap. For a fixed-budget buyer a block is reassuring; a surprise invoice is a lost renewal.
- **Archived projects stay queryable free.** Costs almost nothing (storage only, no AI) and makes the platform sticky across job cycles.

## 5. Candidate bands and what they'd earn

Gross margin at realistic usage:

| Price/project/mo | 3 crew light | 3 crew active | 8 crew active | 15 crew active |
|---|---|---|---|---|
| NZ$99 | 94% | 84% | 57% | **20%** |
| NZ$199 | 97% | 92% | 79% | 60% |
| NZ$299 | 98% | 95% | 86% | 73% |
| NZ$499 | 99% | 97% | 91% | 84% |

The NZ$99 / 15-crew cell at 20% is the whole argument for tiering: a big busy site must not be able to sit on the entry tier. Band boundaries need to move a site up before it gets there.

**These numbers are not validated against the NZ market yet.** They're what the margin math supports, not what a builder will pay. That comes from Maree.

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

- No verified NZ construction-software price points yet (research pending).
- No verified pricing for any construction AI vendor (Document Crunch, Trunk Tools, Togal.AI).
- Whether Procore AI ends up bundled or paid - not committed publicly as of 2026-07.
- Fair-use percentiles need real instrumented usage, not a guess.
