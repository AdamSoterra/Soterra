"""
Soterra Program PDF Parser
===========================
Reads a construction program PDF (MS Project export), extracts all
inspection milestone items with dates and lot assignments.

Usage:
    uv run --with pdfplumber --with anthropic parse_program.py program.pdf
    uv run --with pdfplumber --with anthropic parse_program.py program.pdf --smart

Options:
    --smart    Use Claude API to parse messy PDFs that pdfplumber can't handle cleanly
    --json     Output as JSON (for integration with dashboard)
"""

import pdfplumber
import json
import sys
import os
import re
from datetime import datetime

# ── Load API key if available ──
ENV_PATH = os.path.join(os.path.expanduser("~"), ".soterra", ".env")
if os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key] = val

# ── Inspection keywords ──
INSPECTION_KEYWORDS = [
    "inspection", "preline", "postline", "prewrap", "pre-wrap",
    "cavity inspection", "cladding inspection", "structural inspection",
    "consentium", "council inspection",
    "prefinal", "pre-final", "final inspection",
    "defect inspection", "CCC", "code compliance",
    "geotech inspection", "drainage inspection",
    "fire inspection", "fire stopping",
    "waterproofing inspection",
    "engineer inspection", "engineer structural",
    "milestone.*inspection", "milestone.*pass",
]

# ── Lot/section detection patterns ──
LOT_PATTERNS = [
    r"^Lot\s+\d",
    r"^Lots?\s+\d",
    r"^Unit\s+\d",
    r"^Block\s+\d",
    r"^Stage\s+\d",
    r"^Level\s+\d",
    r"^Building\s+\d",
    r"^House\s+\d",
    r"^Townhouse\s+\d",
]

# ── Section header patterns (non-lot groupings) ──
SECTION_PATTERNS = [
    r"^Superstructure",
    r"^Foundations",
    r"^Earthworks",
    r"^Enabling",
    r"^CONSTRUCTION",
    r"^Preconstruction",
    r"^Exterior Envelope",
    r"^Interior Works",
    r"^Siteworks",
    r"^External",
    r"^Public Drainage",
    r"^JOAL",
]


def is_inspection(task_name):
    """Check if a task name is an inspection item."""
    task_lower = task_name.lower()
    for kw in INSPECTION_KEYWORDS:
        if ".*" in kw:
            if re.search(kw, task_lower):
                return True
        elif kw in task_lower:
            return True
    return False


def detect_lot(task_name):
    """Check if a task name is a lot/section header."""
    for pattern in LOT_PATTERNS:
        if re.match(pattern, task_name, re.IGNORECASE):
            return task_name.strip()
    return None


def detect_section(task_name):
    """Check if a task name is a section header."""
    for pattern in SECTION_PATTERNS:
        if re.match(pattern, task_name, re.IGNORECASE):
            return task_name.strip()
    return None


def parse_date(date_str):
    """Parse various date formats from programs."""
    if not date_str:
        return None
    date_str = date_str.strip()

    formats = [
        "%a %d/%m/%y",     # Mon 31/03/26
        "%d/%m/%y",        # 31/03/26
        "%d/%m/%Y",        # 31/03/2026
        "%a %d/%m/%Y",     # Mon 31/03/2026
        "%d %b %Y",        # 31 Mar 2026
        "%d %b %y",        # 31 Mar 26
        "%Y-%m-%d",        # 2026-03-31
    ]

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def extract_with_pdfplumber(pdf_path):
    """Extract inspection items using pdfplumber table extraction."""
    all_rows = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if row and row[0] and row[1]:
                        id_num = (row[0] or "").strip()
                        task = (row[1] or "").strip()
                        duration = (row[2] or "").strip() if len(row) > 2 else ""
                        start = (row[3] or "").strip() if len(row) > 3 else ""
                        finish = (row[4] or "").strip() if len(row) > 4 else ""

                        if id_num == "ID":  # skip header rows
                            continue

                        all_rows.append({
                            "id": id_num,
                            "task": task,
                            "duration": duration,
                            "start": start,
                            "finish": finish,
                        })

    return all_rows


def assign_lots(rows):
    """Walk through rows and assign lot/section context to each."""
    current_lot = None
    current_section = None

    for row in rows:
        task = row["task"]

        # Check if this row is a lot header
        lot = detect_lot(task)
        if lot:
            current_lot = lot
            row["is_header"] = True
            continue

        # Check if this row is a section header
        section = detect_section(task)
        if section:
            current_section = section
            row["is_header"] = True
            continue

        row["lot"] = current_lot
        row["section"] = current_section
        row["is_header"] = False

    return rows


def extract_inspections(rows):
    """Filter to only inspection items."""
    inspections = []
    for row in rows:
        if row.get("is_header"):
            continue
        if is_inspection(row["task"]):
            start_date = parse_date(row["start"])
            finish_date = parse_date(row["finish"])

            inspections.append({
                "id": row["id"],
                "task": row["task"],
                "lot": row.get("lot", "General"),
                "section": row.get("section", ""),
                "start": row["start"],
                "finish": row["finish"],
                "start_date": start_date.strftime("%Y-%m-%d") if start_date else None,
                "duration": row["duration"],
            })

    return inspections


def extract_with_claude(pdf_path):
    """Use Claude API with vision to parse messy PDFs by converting pages to images."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run with: uv run --with anthropic")
        return []

    import base64
    import io as _io

    # Convert PDF pages to images using pypdfium2
    try:
        import pypdfium2
        pdf = pypdfium2.PdfDocument(pdf_path)
        pages_images = []
        for i in range(len(pdf)):
            page = pdf[i]
            bitmap = page.render(scale=2.5)  # higher res for better reading
            img = bitmap.to_pil()
            pages_images.append(img)
        print(f"  Converted {len(pages_images)} pages to images for vision analysis")
    except Exception as e:
        print(f"ERROR: Could not convert PDF to images: {e}")
        return []

    client = anthropic.Anthropic()
    all_inspections = []

    # Process pages in batches of 3 (to stay within token limits)
    batch_size = 3
    for batch_start in range(0, len(pages_images), batch_size):
        batch = pages_images[batch_start:batch_start + batch_size]
        batch_end = batch_start + len(batch)
        print(f"  Analysing pages {batch_start + 1}-{batch_end}...")

        content = []
        for img in batch:
            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })

        content.append({
            "type": "text",
            "text": """These are pages from a construction program/schedule (Gantt chart from MS Project or similar).

Extract ALL inspection-related tasks you can see. Look for rows containing words like: inspection, preline, postline, prewrap, pre-wrap, cavity, cladding, structural, council, consentium, facade, architect, engineer, fire, drainage, waterproofing, defect, final, CCC, prefinal, geotech, code compliance.

For each inspection found, provide:
- id: the line number/ID if visible
- task: the task name
- lot: which lot/stage/elevation/block it belongs to (based on the hierarchy/grouping)
- start: the start date
- duration: the duration

Return ONLY valid JSON array. No explanation. If you find no inspections on these pages, return [].
Example: [{"id": "179", "task": "Cavity Inspection", "lot": "Lot 1", "start": "2026-03-31", "duration": "1 day"}]""",
        })

        try:
            msg = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": content}],
            )

            response_text = msg.content[0].text.strip()

            # Handle markdown code blocks
            if "```" in response_text:
                json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", response_text, re.DOTALL)
                if json_match:
                    response_text = json_match.group(1)

            batch_inspections = json.loads(response_text)
            if isinstance(batch_inspections, list):
                all_inspections.extend(batch_inspections)
                print(f"    Found {len(batch_inspections)} inspections on these pages")
        except (json.JSONDecodeError, Exception) as e:
            print(f"    Warning: Could not parse pages {batch_start + 1}-{batch_end}: {e}")

    return all_inspections


def group_by_lot(inspections):
    """Group inspections by lot for display."""
    lots = {}
    for insp in inspections:
        lot = insp.get("lot") or "General"
        if lot not in lots:
            lots[lot] = []
        lots[lot].append(insp)
    return lots


def print_results(inspections, project_name=""):
    """Pretty-print the extracted inspections."""
    if project_name:
        print(f"\n{'=' * 70}")
        print(f"  PROJECT: {project_name}")
        print(f"{'=' * 70}")

    if not inspections:
        print("\n  No inspection items found.")
        return

    print(f"\n  Found {len(inspections)} inspection items\n")

    grouped = group_by_lot(inspections)

    for lot, items in grouped.items():
        print(f"  --- {lot} ---")
        for item in items:
            date = item.get("start_date") or item.get("start", "")
            print(f"    [{item['id']:>4}] {item['task']:<45} {date}")
        print()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    pdf_path = sys.argv[1]
    use_smart = "--smart" in sys.argv
    output_json = "--json" in sys.argv

    if not os.path.exists(pdf_path):
        print(f"ERROR: File not found: {pdf_path}")
        sys.exit(1)

    # Extract project name from filename
    project_name = os.path.splitext(os.path.basename(pdf_path))[0]

    if use_smart:
        print(f"Using Claude API for smart extraction...")
        inspections = extract_with_claude(pdf_path)
    else:
        print(f"Parsing: {os.path.basename(pdf_path)}")
        rows = extract_with_pdfplumber(pdf_path)
        print(f"  Extracted {len(rows)} total rows from PDF")
        rows = assign_lots(rows)
        inspections = extract_inspections(rows)

    if output_json:
        print(json.dumps(inspections, indent=2))
    else:
        print_results(inspections, project_name)

        # Also save JSON output
        json_path = os.path.splitext(pdf_path)[0] + "_inspections.json"
        with open(json_path, "w") as f:
            json.dump({
                "project": project_name,
                "extracted": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "total_inspections": len(inspections),
                "inspections": inspections,
                "by_lot": group_by_lot(inspections),
            }, f, indent=2)
        print(f"  JSON saved: {json_path}")


if __name__ == "__main__":
    main()
