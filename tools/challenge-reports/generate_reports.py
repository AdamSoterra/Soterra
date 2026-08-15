# Generates the Soterra CHALLENGE inspection report PDFs from challenge-manifest.json.
# Two families: council "Inspection checklist outcome statement" (Auckland-style,
# findings buried in Additional Comments prose) and consultant reports in three
# styles (sor = Site Observation Report, can = Consultant Advice Notice memo,
# register = item register tables). Everything fictional; text-based on purpose -
# the corpus exists to stress-test PDF text extraction.
#   python generate_reports.py
import json
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MANIFEST = os.path.join(HERE, "challenge-manifest.json")

PROJECTS = {
    "P1": {"name": "Harbourview Apartments", "site": "21 Pohutukawa Rise, Hobsonville, Auckland 0618",
           "council": "Westhaven District Council", "consent": "BCO20347761-2"},
    "P2": {"name": "Rimu Terraces", "site": "8 Rimu Lane, Papamoa, Tauranga 3118",
           "council": "Tauriko District Council", "consent": "BCO20351140-1"},
    "P3": {"name": "Fernleaf Office Building", "site": "117 Fernleaf Road, Penrose, Auckland 1061",
           "council": "Westhaven District Council", "consent": "BCO20355892-1"},
}

FIRM_META = {
    "Beacon Fire Consultants": {"addr": "Level 2, 14 Boulcott Lane, Auckland 1010", "phone": "+64 9 555 0412",
                                "web": "www.beaconfire.co.nz", "color": colors.HexColor("#C0392B")},
    "Matai Structural Engineers": {"addr": "12 Kereru Street, Ellerslie, Auckland 1051", "phone": "+64 9 555 0268",
                                   "web": "www.mataistructural.co.nz", "color": colors.HexColor("#1F618D")},
    "Clearflow Hydraulic Consultants": {"addr": "Unit 4, 90 Tui Crescent, Albany, Auckland 0632", "phone": "+64 9 555 0377",
                                        "web": "www.clearflow.co.nz", "color": colors.HexColor("#117864")},
    "Northvent Mechanical": {"addr": "35 Weka Road, Mt Wellington, Auckland 1060", "phone": "+64 9 555 0523",
                             "web": "www.northvent.co.nz", "color": colors.HexColor("#6C3483")},
    "Kea Electrical Design": {"addr": "Suite 7, 220 Kaka Street, Newmarket, Auckland 1023", "phone": "+64 9 555 0691",
                              "web": "www.keaelectrical.co.nz", "color": colors.HexColor("#B7950B")},
    "Harakeke Acoustics": {"addr": "18 Miro Lane, Grey Lynn, Auckland 1021", "phone": "+64 9 555 0740",
                           "web": "www.harakeke-acoustics.co.nz", "color": colors.HexColor("#5D6D7E")},
    "Puriri Architecture": {"addr": "Level 1, 7 Kowhai Court, Ponsonby, Auckland 1011", "phone": "+64 9 555 0855",
                            "web": "www.puriri.co.nz", "color": colors.HexColor("#283747")},
}

NAVY = colors.HexColor("#1F4B7A")
LIGHT = colors.HexColor("#EDF1F7")
GREY = colors.HexColor("#B9BFC9")
PHOTO_GREY = colors.HexColor("#D5D8DE")

# WinAnsi-safe text: swap typographic characters, drop anything else non-encodable.
SWAPS = {"–": "-", "—": "-", "‘": "'", "’": "'", "“": '"',
         "”": '"', "…": "...", "·": "-", "•": "-", " ": " ",
         "≤": "<=", "≥": ">=", "Ø": "O", "ø": "o"}


def clean(s):
    if s is None:
        return ""
    for k, v in SWAPS.items():
        s = s.replace(k, v)
    return s.encode("cp1252", "replace").decode("cp1252")


def esc(s):
    return clean(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def para(text, style):
    return Paragraph(esc(text).replace("\n", "<br/>"), style)


def st(name, size=9.5, bold=False, color=colors.black, leading=None, before=0, after=0):
    return ParagraphStyle(name, fontName="Helvetica-Bold" if bold else "Helvetica",
                          fontSize=size, leading=leading or size * 1.3, textColor=color,
                          spaceBefore=before, spaceAfter=after)


S_BODY = st("body")
S_BODY_B = st("bodyb", bold=True)
S_SMALL = st("small", 8.5)
S_WHITE = st("white", 10.5, bold=True, color=colors.white)
S_WHITE_SM = st("whitesm", 9.5, color=colors.white)
S_H1 = st("h1", 13, bold=True, after=4)
S_H2 = st("h2", 10.5, bold=True, before=6, after=3)
S_CAPTION = st("caption", 8.5, color=colors.HexColor("#444444"))

LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def dmy(iso):
    y, m, d = iso.split("-")
    return f"{d}-{m}-{y}"


def dmy_slash(iso):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{int(d)} {LONG_MONTHS[int(m) - 1]} {y}"


class NumberedCanvas(pdfcanvas.Canvas):
    """Two-pass canvas so every page can print 'Page N of M'."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 8.5)
            self.setFillColor(colors.HexColor("#555555"))
            self.drawRightString(A4[0] - 18 * mm, 12 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


def doc_for(path):
    doc = BaseDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=16 * mm, bottomMargin=20 * mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])
    return doc


def kv_table(rows, widths, header=None):
    data = []
    style = [
        ("GRID", (0, 0), (-1, -1), 0.6, GREY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header is not None:
        data.append([para(h, S_WHITE) for h in header] + [""] * (len(widths) - len(header)))
        style += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("SPAN", (0, 0), (-1, 0))] if len(header) == 1 else [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY)]
    for r in rows:
        data.append([para(c, S_BODY) if isinstance(c, str) else c for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if header is not None else 0)
    t.setStyle(TableStyle(style))
    return t


def photo_block(captions, caption_left=True):
    """Grey placeholder rectangles standing in for site photos."""
    rows = []
    for cap in captions:
        box = Table([[""]], colWidths=[70 * mm], rowHeights=[38 * mm])
        box.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), PHOTO_GREY),
                                 ("BOX", (0, 0), (0, 0), 0.6, GREY)]))
        if caption_left:
            rows.append([para(cap, S_BODY), box])
        else:
            rows.append([box, para(cap, S_CAPTION)])
    t = Table(rows, colWidths=[88 * mm, 86 * mm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.6, GREY),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 5),
                           ("TOPPADDING", (0, 0), (-1, -1), 6),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


# ─── Council template ─────────────────────────────────────────────────────

IMPORTANT_NOTE = ("Important Note: The following inspection checklist must be read in conjunction with the "
                  "%s Inspection Code of Practice where individual line items have been defined to support "
                  "reasons for decisions.\nN/A means Not Applicable (not part of this inspection)\n"
                  "* Indicates a photo has been taken in relation to a particular line item")


def council_pdf(r, path):
    p = PROJECTS[r["project"]]
    doc = doc_for(path)
    story = []

    head_rows = [
        [para(f'{p["consent"]} {r["typeName"]} Inspection', st("ht", 12.5, bold=True, color=colors.white))],
        [para(f'Inspection checklist outcome statement {dmy(r["date"])}', S_WHITE)],
        [para(p["site"], S_WHITE_SM)],
        [para(f'Inspection Address : {p["site"]}', S_WHITE_SM)],
    ]
    wordmark = Table([[para(p["council"], st("cw", 12, bold=True, color=NAVY))]], colWidths=[48 * mm])
    wordmark.setStyle(TableStyle([("BOX", (0, 0), (0, 0), 1.2, NAVY), ("TOPPADDING", (0, 0), (0, 0), 8),
                                  ("BOTTOMPADDING", (0, 0), (0, 0), 8), ("LEFTPADDING", (0, 0), (0, 0), 6)]))
    inner = Table([[c] for c in [x[0] for x in head_rows]], colWidths=[118 * mm])
    inner.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY),
                               ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 3),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    hdr = Table([[inner, wordmark]], colWidths=[122 * mm, 52 * mm])
    hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(hdr)
    story.append(Spacer(1, 4 * mm))

    note = Table([[para(IMPORTANT_NOTE % p["council"], st("note", 9.5, color=colors.white))]], colWidths=[174 * mm])
    note.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), NAVY), ("LEFTPADDING", (0, 0), (0, 0), 6),
                              ("TOPPADDING", (0, 0), (0, 0), 5), ("BOTTOMPADDING", (0, 0), (0, 0), 5)]))
    story.append(note)
    story.append(Spacer(1, 4 * mm))

    details = [["Inspection Type Code", f'{r["typeName"]}({r["code"]})'],
               ["Date of Inspection", dmy(r["date"])],
               ["Building name", "N/A"]]
    details += [["Floor/Units (Multi Unit only)", u] for u in r.get("floorUnits", [])]
    details += [["Lot", "N/A"], ["Start time", r.get("startTime", "09:00:00")],
                ["Scope", r.get("scope", "Full")],
                ["Partial description mandatory", r.get("partialDescription") or "N/A"],
                ["Does the checklist need to be completed?", "N/A"],
                ["Site safety", "Safe"], ["Unsafe site", "N/A"],
                ["Comment - Site Safety (Near Miss)", "N/A"],
                ["Consent documents on site", "Yes"],
                ["Previous inspection history checked", "Yes"],
                ["Involves restricted building work", "No"],
                ["LBP information", "N/A"],
                ["Replaced with 3rd party inspection", "No"]]
    story.append(kv_table(details, [92 * mm, 82 * mm], header=["Inspection Details"]))
    story.append(Spacer(1, 5 * mm))

    cl_rows = [[c["item"], c["result"], c.get("comment", "")] for c in r["checklist"]]
    cl_data = [[para("Checklist Item", S_WHITE), para("Result", S_WHITE), para("Comment", S_WHITE)]]
    cl_data += [[para(a, S_BODY), para(b, S_BODY), para(c, S_BODY)] for a, b, c in cl_rows]
    cl = Table(cl_data, colWidths=[100 * mm, 40 * mm, 34 * mm], repeatRows=1)
    cl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.6, GREY),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5),
                            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(cl)
    story.append(Spacer(1, 5 * mm))

    lbp = Table([[para("LBP Name ( if applicable )", S_WHITE), para("LBP Number", S_WHITE), para("LBP Class", S_WHITE)],
                 [para("Not applicable to this inspection.", S_BODY), "", ""]],
                colWidths=[70 * mm, 52 * mm, 52 * mm])
    lbp.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.6, GREY),
                             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(lbp)
    story.append(Spacer(1, 5 * mm))

    story.append(kv_table([["Not applicable to this inspection.", ""]], [92 * mm, 82 * mm],
                          header=["Documents required", "Comment"]))
    story.append(Spacer(1, 5 * mm))
    story.append(kv_table([["Not applicable to this inspection.", "", ""]], [70 * mm, 40 * mm, 64 * mm],
                          header=["Minor Variation Description ( if applicable )", "Outcome", "Outcome reason / Comment"]))
    story.append(Spacer(1, 5 * mm))

    if r["failComments"]:
        fail_txt = "\n".join(f"{i + 1}. {t} ( Fail )" for i, t in enumerate(r["failComments"]))
    else:
        fail_txt = "Not applicable to this inspection."

    parts = ["INSPECTION HISTORY INCLUDING OVERVIEW", "", r["historyOverview"], "",
             "DOCUMENTATION RECEIVED", "", r.get("documentationReceived") or "NA", "",
             "INSPECTION SCOPE", "", r["inspectionScope"]]
    if r["itemsToBeResolved"]:
        parts += ["", "ITEMS TO BE RESOLVED"]
        for blk in r["itemsToBeResolved"]:
            parts += ["", blk["heading"]]
            parts += [f"{i + 1}. {it}" for i, it in enumerate(blk["items"])]
    if r.get("nextInspection"):
        parts += ["", r["nextInspection"]]
    add_txt = "\n".join(parts)

    summary = Table([[para("Inspection Summary", S_WHITE), ""],
                     [para("Fail Comments", S_BODY), para(fail_txt, S_BODY)],
                     [para("Additional Comments", S_BODY), para(add_txt, S_BODY)]],
                    colWidths=[52 * mm, 122 * mm])
    summary.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("SPAN", (0, 0), (1, 0)),
                                 ("GRID", (0, 0), (-1, -1), 0.6, GREY), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(summary)
    story.append(Spacer(1, 2 * mm))

    tail = [["Inspection Outcome", r["outcome"]],
            ["Work completed in accordance with plans", "Yes"],
            ["Comment - other", "N/A"],
            ["Person on site (name)", r.get("personOnSite", "")]]
    tail += [["Outcome statement recipient email", e] for e in r.get("recipientEmails", [])]
    tail += [["Inspector's name", r["inspectorName"]],
             ["Inspector's email", r["inspectorEmail"].upper()],
             ["Inspector's phone number", r["inspectorPhone"]],
             ["Inspection duration (minutes)\nNote- Time may be added for travel and additional processing (eg minor variations)",
              str(r.get("durationMin", 60))],
             ["Next inspection required", r.get("nextInspection", "") and r["nextInspection"].replace("NEXT INSPECTION TO BE ", "").title() or "TBC"]]
    story.append(kv_table(tail, [92 * mm, 82 * mm]))

    n_photos = int(r.get("photoCount", 0))
    if n_photos:
        story.append(Spacer(1, 5 * mm))
        story.append(kv_table([], [174 * mm], header=["Photos"]))
        cap = f'{p["consent"]} {r["code"]} Inspection {dmy_slash(r["date"])}'
        story.append(photo_block([cap] * n_photos, caption_left=True))

    doc.build(story, canvasmaker=NumberedCanvas)


# ─── Consultant templates ─────────────────────────────────────────────────

def render_blocks(blocks, accent):
    out = []
    for b in blocks:
        t = b["t"]
        if t == "h":
            out.append(para(b["text"], st("bh", 10.5, bold=True, before=7, after=3)))
        elif t == "p":
            out.append(para(b["text"], S_BODY))
            out.append(Spacer(1, 2 * mm))
        elif t == "list":
            for i, item in enumerate(b["items"]):
                if b.get("style") == "alpha":
                    prefix = f"{chr(97 + (i % 26))}."
                elif b.get("style") == "bullet":
                    prefix = "-"
                else:
                    prefix = f"{i + 1}."
                out.append(Paragraph(f"{prefix} {esc(item)}".replace("\n", "<br/>"),
                                     ParagraphStyle(f"li{i}", parent=S_BODY, leftIndent=8 * mm,
                                                    firstLineIndent=-5 * mm, spaceAfter=2)))
            out.append(Spacer(1, 2 * mm))
        elif t == "table":
            widths = None
            ncol = len(b["headers"])
            total = 174 * mm
            if ncol == 4:
                widths = [12 * mm, 100 * mm, 24 * mm, 38 * mm]
            elif ncol == 3:
                widths = [16 * mm, 110 * mm, 48 * mm]
            elif ncol == 2:
                widths = [60 * mm, 114 * mm]
            else:
                widths = [total / ncol] * ncol
            data = [[para(h, S_WHITE) for h in b["headers"]]]
            data += [[para(str(c), S_BODY) for c in row] for row in b["rows"]]
            tb = Table(data, colWidths=widths, repeatRows=1)
            tb.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), accent), ("GRID", (0, 0), (-1, -1), 0.6, GREY),
                                    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5),
                                    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            out.append(tb)
            out.append(Spacer(1, 3 * mm))
        elif t == "photos":
            out.append(para("Selected Photos & Comments", st("ph", 10.5, bold=True, before=6, after=3)))
            out.append(photo_block(b["captions"], caption_left=False))
            out.append(Spacer(1, 2 * mm))
    return out


def consultant_pdf(r, path):
    p = PROJECTS[r["project"]]
    meta = FIRM_META[r["firm"]]
    accent = meta["color"]
    doc = doc_for(path)
    story = []

    # letterhead
    lh = Table([[para(r["firm"].upper(), st("fw", 15, bold=True, color=accent)),
                 para(f'{meta["addr"]}\n{meta["phone"]}  {meta["web"]}', st("fa", 8.5, color=colors.HexColor("#555555")))]],
               colWidths=[100 * mm, 74 * mm])
    lh.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LINEBELOW", (0, 0), (-1, 0), 1.2, accent),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(lh)
    story.append(Spacer(1, 5 * mm))

    if r["style"] == "can":
        head = [["To:", r["toContact"]["company"], f'Email: {r["toContact"]["email"]}', f'Date: {dmy_slash(r["date"])}'],
                ["Attn:", r["toContact"]["attn"], f'From: {r["observedBy"]["name"]}', f'Ref: {r["refNo"]}']]
        for i, cc in enumerate(r.get("ccList", [])):
            head.append(["Cc:", cc, "", f'Rev {r["rev"]}' if (i == 0 and r.get("rev")) else ""])
        if not r.get("ccList") and r.get("rev"):
            head.append(["", "", "", f'Rev {r["rev"]}'])
        ht = Table([[para(c, S_BODY) for c in row] for row in head], colWidths=[14 * mm, 62 * mm, 58 * mm, 40 * mm])
        ht.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.6, GREY), ("LEFTPADDING", (0, 0), (-1, -1), 5),
                                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        story.append(ht)
        story.append(Spacer(1, 3 * mm))
        story.append(para(f'Subject: {r["subject"]}', S_BODY_B))
        story.append(Spacer(1, 2 * mm))
        story.append(para(f'Consultant Advice Notice {r["refNo"].split("/")[-1]}', st("canh", 10.5, bold=True, before=2, after=4)))
    else:
        title = "Site Observation Report" if r["style"] == "sor" else "Site Observation Register"
        story.append(para(title, S_H1))
        info = [["Project", f'{p["name"]}, {p["site"]}'],
                ["Discipline", r["discipline"]],
                ["Report No.", r["refNo"] + (f' Rev {r["rev"]}' if r.get("rev") else "")],
                ["Date of visit", long_date(r["date"])],
                ["Observed by", f'{r["observedBy"]["name"]}, {r["observedBy"]["title"]}'],
                ["Client", r["toContact"]["company"]]]
        story.append(kv_table(info, [40 * mm, 134 * mm]))
        story.append(Spacer(1, 4 * mm))

    story += render_blocks(r["body"], accent)

    story.append(Spacer(1, 6 * mm))
    sig = [[para("Prepared by", S_BODY_B), para("", S_BODY)],
           [para(f'{r["observedBy"]["name"]}\n{r["observedBy"]["title"]}', S_BODY), ""]]
    if r.get("checkedBy"):
        sig += [[para("Checked by", S_BODY_B), ""],
                [para(f'{r["checkedBy"]["name"]}\n{r["checkedBy"]["title"]}', S_BODY), ""]]
    sigt = Table(sig, colWidths=[100 * mm, 74 * mm])
    sigt.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 3)]))
    story.append(sigt)
    story.append(Spacer(1, 4 * mm))
    story.append(para("This report is limited to the matters observed at the time of the site visit and should be read "
                      "with the consent drawings and specifications. It does not constitute a producer statement or a "
                      f"certification of the works. {r["firm"]}.", S_CAPTION))

    doc.build(story, canvasmaker=NumberedCanvas)


# ─── Main ─────────────────────────────────────────────────────────────────

def main():
    with open(MANIFEST, encoding="utf-8") as f:
        reports = json.load(f)
    done, failed = 0, []
    counts = {}
    for r in reports:
        sub = r["subfolder"]
        folder = os.path.join(ROOT, sub)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, r["filename"])
        try:
            if r["kind"] == "council":
                council_pdf(r, path)
            else:
                consultant_pdf(r, path)
            done += 1
            counts[sub] = counts.get(sub, 0) + 1
        except Exception as e:
            failed.append((r["filename"], repr(e)))
    print(f"Generated {done}/{len(reports)} PDFs into {ROOT}")
    for k in sorted(counts):
        print(f"  {k}: {counts[k]}")
    if failed:
        print("FAILED:")
        for f_, e in failed:
            print(f"  {f_}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
