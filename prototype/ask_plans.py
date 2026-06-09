"""
Soterra plan-reader prototype — "ask one real project's plans".
Pipeline:  lexical retrieve (free) -> Claude Vision read of top pages -> answer + citation.
Because the PDFs are vector (full text extractable), we send Claude BOTH the page's
extracted text (legible even for tiny A1 schedule print) AND the rendered image.

Run:
  python prototype/ask_plans.py --test          # 3 benchmark questions
  python prototype/ask_plans.py "your question"
Retrieval runs with no key. Set ANTHROPIC_API_KEY to also get the read + citation.
"""
import os, re, io, json, base64, sys, math
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import pypdfium2 as pdfium

BASE = r"C:\Users\adam\Desktop\TIS\Home Tenders\1 Arthur Road"
DOCS = [
    ("Detail Design",   "ARCH", "95% Detail Design - 1 Arthur Rd Multi Unit Housing 3.pdf"),
    ("Detailed Design", "ARCH", "P25-152-FDS-08-95% Detailed Design.pdf"),
    ("Electrical",      "ELEC", "8084-ELEC-ESET-WIP-26.02.13.pdf"),
    ("Mechanical",      "MECH", "8084-MECH-MSET-WIP-26.02.13.pdf"),
    ("Project Spec",    "SPEC", "95% Project Spec - 1 Arthur Rd 3.pdf"),
    ("Structural Spec", "SPEC", "P25-152-SPC-01-Structural Specification.pdf"),
]
CACHE = os.path.join(os.path.dirname(__file__), "index_cache.json")
MODEL = "claude-sonnet-4-6"

SYNONYMS = {
  "colour":["color","paint","finish","resene","dulux","schedule"],
  "color": ["colour","paint","finish","resene","dulux","schedule"],
  "paint": ["colour","resene","dulux","finish"],
  "fire":  ["frr","fire-rated","rated","fhr"],
  "rating":["frr","fire","rated"],
  "beam":  ["lintel","lvl","span","portal","header","steel"],
  "lintel":["beam","lvl","span","header"],
  "garage":["carport","basement","ground"],
  "wall":  ["partition","gib","plasterboard","lining","intertenancy"],
  "insulation":["r-value","thermal","batts","pink"],
  "window":["glazing","glazed","joinery"],
  "corridor":["lobby","circulation","common"],
}

def sheet_meta(text):
    codes = re.findall(r"\b([A-Z]{1,2}[-\. ]?\d{2,3}(?:\.\d+)?)\b", text)
    code = codes[-1].replace(" ", "") if codes else ""
    title = ""
    for m in re.finditer(r"([A-Z][A-Z &/\-]{6,40})", text):
        t = m.group(1).strip()
        if any(b in t for b in ("PO BOX","AUCKLAND","STREET","ECLIPSE","WWW")): continue
        title = t.title()
    return code, title

def build_index(force=False):
    if os.path.exists(CACHE) and not force:
        return json.load(open(CACHE, encoding="utf-8"))
    idx = []
    for name, disc, fn in DOCS:
        path = os.path.join(BASE, fn)
        if not os.path.exists(path):
            print("  !! missing", fn); continue
        doc = pdfium.PdfDocument(path)
        for i in range(len(doc)):
            tp = doc[i].get_textpage(); txt = tp.get_text_range() or ""; tp.close()
            code, title = sheet_meta(txt) if disc in ("ARCH","ELEC","MECH") else ("","")
            idx.append({"doc":name,"disc":disc,"file":fn,"page":i+1,"npages":len(doc),
                        "code":code,"title":title,"text":re.sub(r"\s+"," ",txt).strip()})
        doc.close()
    json.dump(idx, open(CACHE,"w",encoding="utf-8"))
    return idx

def expand(q):
    terms = re.findall(r"[a-z0-9\-]+", q.lower())
    out = set(t for t in terms if len(t) > 1)
    for t in terms:
        for s in SYNONYMS.get(t, []): out.add(s)
    return out

_DF, _N = {}, 1
def fit_idf(idx):
    """Document frequency over all pages → kills title-block boilerplate that's on every sheet."""
    global _DF, _N
    _N = len(idx); df = {}
    for p in idx:
        for t in set(re.findall(r"[a-z0-9\-]{2,}", p["text"].lower())):
            df[t] = df.get(t, 0) + 1
    _DF = df
def idf(t):
    return math.log((_N + 1) / (_DF.get(t, 0) + 1)) + 1

def score(page, terms):
    low = page["text"].lower(); s = 0.0
    for t in terms:
        c = low.count(t)
        if c:
            s += (1 + math.log(c)) * idf(t)      # tf-idf: distinctive terms dominate
    return s

def retrieve(idx, q, k=4):
    terms = expand(q)
    scored = [(score(p, terms), p) for p in idx]
    scored = [sp for sp in scored if sp[0] > 0]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:k]]

def render(file, page, scale=2.4):
    doc = pdfium.PdfDocument(os.path.join(BASE, file))
    img = doc[page-1].render(scale=scale).to_pil().convert("RGB")
    if max(img.size) > 1560:
        r = 1560 / max(img.size); img = img.resize((int(img.size[0]*r), int(img.size[1]*r)))
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=82); doc.close()
    return base64.standard_b64encode(buf.getvalue()).decode()

SYS = """You are Soterra's plan-reader for the project '1 Arthur Road'. Answer the site team's
question USING ONLY the attached plan/spec pages (each is labelled, with its extracted text + image).
Rules:
- Specific and concise (1-4 sentences). Talk like a helpful site engineer.
- ALWAYS finish with: 'Source: <label of the page you used>'. Cite the exact sheet/page.
- A finish/material may need a CODE from a schedule (drawings) + its product from the spec — connect them.
- If the pages don't contain the answer, say what's missing. NEVER invent codes, ratings, products or numbers.
"""

def label(p):
    bits = [p["doc"]]
    if p["code"]: bits.append(p["code"])
    if p["title"]: bits.append(p["title"])
    return " · ".join(bits) + f" · page {p['page']} of {p['npages']}"

def answer(q, top):
    import anthropic
    client = anthropic.Anthropic()
    content = []
    for p in top:
        content.append({"type":"text","text":f"[PAGE: {label(p)}]\nExtracted text:\n{p['text'][:2800]}"})
        content.append({"type":"image","source":{"type":"base64","media_type":"image/jpeg",
                        "data":render(p["file"], p["page"])}})
    content.append({"type":"text","text":f"Question: {q}"})
    r = client.messages.create(model=MODEL, max_tokens=600, system=SYS,
                               messages=[{"role":"user","content":content}])
    return "".join(b.text for b in r.content if getattr(b,"type",None) == "text")

TESTS = ["What's the wall colour in unit 43?",
         "What's the fire rating on the corridor walls?",
         "What size is the beam or lintel over the garage?"]

if __name__ == "__main__":
    args = sys.argv[1:]
    print("building index…")
    idx = build_index(force=("--reindex" in args))
    args = [a for a in args if a != "--reindex"]
    fit_idf(idx)
    print(f"indexed {len(idx)} pages across {len(DOCS)} documents\n")
    qs = TESTS if (not args or args[0] == "--test") else [" ".join(args)]
    have_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    for q in qs:
        top = retrieve(idx, q, k=6)
        print("=" * 74)
        print("Q:", q)
        print("  → found the right pages:")
        for p in top:
            print(f"      • {label(p)}")
        if have_key:
            print("  → reading them…\n")
            print("  " + answer(q, top).replace("\n", "\n  "))
        else:
            print("  → (set ANTHROPIC_API_KEY to read these pages and get the cited answer)")
        print()
