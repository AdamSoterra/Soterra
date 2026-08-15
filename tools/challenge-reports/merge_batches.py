# Merges + validates the workflow-authored batch files (A1-A8.json) into
# challenge-manifest.json and ground-truth.json. Fails loudly on anything the
# generator or the extraction probe would trip over.
#   python merge_batches.py <batch-dir>
import json
import os
import re
import sys

CATEGORIES = {"Structural", "Weathertightness / Cladding", "Fire", "Electrical",
              "Plumbing & Drainage", "Mechanical", "Interior / Linings",
              "Access & Barriers", "Site / External", "Acoustic", "Seismic",
              "Architect", "Other"}

COUNCIL_REQ = ["filename", "kind", "subfolder", "project", "code", "typeName", "date", "startTime",
               "scope", "floorUnits", "outcome", "checklist", "failComments", "historyOverview",
               "inspectionScope", "itemsToBeResolved", "nextInspection", "inspectorName",
               "inspectorEmail", "inspectorPhone", "groundTruth"]
CONSULT_REQ = ["filename", "kind", "subfolder", "project", "style", "firm", "discipline", "refNo",
               "date", "subject", "observedBy", "toContact", "body", "groundTruth"]

WINDOWS = {"P1": ("2025-01-01", "2025-07-31"), "P2": ("2025-02-01", "2025-08-31"),
           "P3": ("2025-03-01", "2025-08-31")}


def content_of(r):
    bits = []
    if r["kind"] == "council":
        for c in r["checklist"]:
            bits += [c.get("item", ""), c.get("result", ""), c.get("comment", "")]
        bits += r.get("failComments", [])
        bits += [r.get("historyOverview", ""), r.get("documentationReceived", ""),
                 r.get("inspectionScope", ""), r.get("nextInspection", "")]
        for blk in r.get("itemsToBeResolved", []):
            bits.append(blk.get("heading", ""))
            bits += blk.get("items", [])
    else:
        bits.append(r.get("subject", ""))
        for b in r.get("body", []):
            bits.append(b.get("text", ""))
            bits += b.get("items", [])
            bits += b.get("captions", [])
            for row in b.get("rows", []):
                bits += [str(c) for c in row]
            bits += b.get("headers", [])
    return "\n".join(bits)


def main():
    bdir = sys.argv[1]
    out_dir = os.path.dirname(os.path.abspath(__file__))
    merged, problems = [], []
    seen_names = set()
    for bid in ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]:
        path = os.path.join(bdir, f"{bid}.json")
        if not os.path.exists(path):
            problems.append(f"{bid}: file missing")
            continue
        try:
            with open(path, encoding="utf-8") as f:
                batch = json.load(f)
        except Exception as e:
            problems.append(f"{bid}: JSON parse error: {e}")
            continue
        if not isinstance(batch, list):
            problems.append(f"{bid}: not a list")
            continue
        for r in batch:
            fn = r.get("filename", "?")
            tag = f"{bid}/{fn}"
            req = COUNCIL_REQ if r.get("kind") == "council" else CONSULT_REQ
            for k in req:
                if k not in r:
                    problems.append(f"{tag}: missing field {k}")
            if fn in seen_names:
                problems.append(f"{tag}: duplicate filename")
            seen_names.add(fn)

            text = content_of(r)
            everything = text + json.dumps(r, ensure_ascii=False)
            if "–" in everything or "—" in everything:
                problems.append(f"{tag}: em/en dash present")

            gt = r.get("groundTruth", {})
            for it in gt.get("shouldExtract", []):
                if it.get("category") not in CATEGORIES:
                    problems.append(f"{tag}: bad category {it.get('category')!r}")
                if it.get("match") and it["match"] not in text:
                    problems.append(f"{tag}: shouldExtract match not verbatim: {it['match'][:60]!r}")
            for it in gt.get("mustNotExtract", []):
                if it.get("match") and it["match"] not in text:
                    problems.append(f"{tag}: mustNotExtract match not verbatim: {it['match'][:60]!r}")

            date = r.get("date", "")
            lo, hi = WINDOWS.get(r.get("project", ""), ("0", "9"))
            if not (lo <= date <= hi):
                problems.append(f"{tag}: date {date} outside project window")

            if r.get("kind") == "council":
                ymd = date.replace("-", "")
                if ymd not in fn:
                    problems.append(f"{tag}: filename date token != {ymd}")
                m = re.search(r"_(Pass|Fail|Partial Pass|Completed)_", fn)
                if not m or m.group(1) != r.get("outcome"):
                    problems.append(f"{tag}: filename outcome != {r.get('outcome')}")
                fails = [c for c in r.get("checklist", []) if c.get("result") == "Fail"]
                if r.get("outcome") == "Fail":
                    if not r.get("failComments"):
                        problems.append(f"{tag}: Fail outcome but empty failComments")
                    for fc in r.get("failComments", []):
                        if not any(c.get("item") == fc for c in fails):
                            problems.append(f"{tag}: failComment not a Fail checklist row: {fc[:50]!r}")
                else:
                    if r.get("failComments"):
                        problems.append(f"{tag}: non-Fail outcome but failComments set")
                    if fails:
                        problems.append(f"{tag}: non-Fail outcome but checklist has Fail rows")
            else:
                y, mo, d = date.split("-")
                if f"{y[2:]}{mo}{d}" not in fn:
                    problems.append(f"{tag}: filename date token != {y[2:]}{mo}{d}")
            merged.append(r)

    print(f"Merged {len(merged)} reports; {len(problems)} problems")
    for p in problems:
        print("  !", p)
    if merged:
        with open(os.path.join(out_dir, "challenge-manifest.json"), "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=1, ensure_ascii=False)
        gt = {r["filename"]: r["groundTruth"] for r in merged if "groundTruth" in r}
        with open(os.path.join(out_dir, "ground-truth.json"), "w", encoding="utf-8") as f:
            json.dump(gt, f, indent=1, ensure_ascii=False)
        print("Wrote challenge-manifest.json + ground-truth.json")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
