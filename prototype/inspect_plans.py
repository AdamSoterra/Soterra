"""
Soterra plan-reader — feasibility probe.
Question: are the 1 Arthur Road PDFs text-extractable, and can we locate the
answer pages by keyword? This decides the retrieval strategy.
"""
import os, re
import pypdfium2 as pdfium

BASE = r"C:\Users\adam\Desktop\TIS\Home Tenders\1 Arthur Road"
FILES = {
    "Detail Design (A3 drawings)": "95% Detail Design - 1 Arthur Rd Multi Unit Housing 3.pdf",
    "Project Spec (A4 text)":      "95% Project Spec - 1 Arthur Rd 3.pdf",
    "Structural Spec (A4 text)":   "P25-152-SPC-01-Structural Specification.pdf",
}
KEYWORDS = ["finish", "schedule", "fire", "frr", "colour", "color", "resene",
            "dulux", "beam", "lintel", "unit 43", "insulation", "r-value",
            "glazing", "acoustic", "drawing list", "sheet list"]

def page_text(doc, i):
    try:
        tp = doc[i].get_textpage()
        txt = tp.get_text_range()
        tp.close()
        return txt or ""
    except Exception as e:
        return ""

for label, fn in FILES.items():
    path = os.path.join(BASE, fn)
    if not os.path.exists(path):
        print(f"\n!! missing: {fn}")
        continue
    doc = pdfium.PdfDocument(path)
    n = len(doc)
    print(f"\n===== {label} — {n} pages =====")
    lens, hits = [], {k: [] for k in KEYWORDS}
    for i in range(n):
        txt = page_text(doc, i)
        lens.append(len(txt))
        low = txt.lower()
        for k in KEYWORDS:
            if k in low:
                hits[k].append(i + 1)
    rich = sum(1 for t in lens if t > 50)
    print(f"text-extractable pages (>50 chars): {rich}/{n}  | avg {int(sum(lens)/n)} chars/page  | max {max(lens)}")
    print("keyword -> pages:")
    for k in KEYWORDS:
        if hits[k]:
            pgs = hits[k]
            print(f"   {k:12s}: {len(pgs):3d} pgs  {pgs[:14]}{' ...' if len(pgs)>14 else ''}")
    # show a snippet from the first page that mentions 'finish schedule'-ish content
    for i in range(n):
        t = page_text(doc, i)
        tl = t.lower()
        if "finish" in tl and "schedule" in tl:
            snippet = re.sub(r"\s+", " ", t).strip()[:400]
            print(f"   ~ sample finishes-page (p{i+1}): {snippet}")
            break
    doc.close()

print("\n--- env ---")
print("ANTHROPIC_API_KEY present:", bool(os.environ.get("ANTHROPIC_API_KEY")))
