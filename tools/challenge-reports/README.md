# Challenge set generator

- `challenge-manifest.json` - the full data for every report (content + ground truth), the single source of truth.
- `ground-truth.json` - per-filename ground truth only: `shouldExtract` (open/failed/query items a perfect reader returns, `borderline: true` marks judgement calls) and `mustNotExtract` (traps: resolved / closed / acceptance / caption / admin / duplicate).
- `generate_reports.py` - renders the manifest into text-based A4 PDFs (reportlab). Council template mirrors a NZ territorial-authority inspection checklist statement; consultant templates cover sor / can / register styles. Run: `python generate_reports.py`
- `merge_batches.py` - merged + validated the authored batch files into the manifest (verbatim ground-truth matches, fail-list rules, date/filename agreement, no em dashes). Only needed if re-authoring content.

To score Soterra's own reader against this set, from `soterra-web/`:

    npx tsx dev/probe-challenge-extract.mts --sample

or point it at a subfolder or file. It runs the real extraction pipeline
(model calls included, no database) and reports found/missed items, traps
wrongly extracted, and extras per report.
