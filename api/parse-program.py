"""
Vercel Serverless Function: Parse construction program PDFs
Endpoint: POST /api/parse-program
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
import tempfile
from datetime import datetime

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

LOT_PATTERNS = [
    r"^Lot\s+\d", r"^Lots?\s+\d", r"^Unit\s+\d", r"^Block\s+\d",
    r"^Stage\s+\d", r"^Level\s+\d", r"^Building\s+\d",
    r"^House\s+\d", r"^Townhouse\s+\d",
]

SECTION_PATTERNS = [
    r"^Superstructure", r"^Foundations", r"^Earthworks", r"^Enabling",
    r"^CONSTRUCTION", r"^Preconstruction", r"^Exterior Envelope",
    r"^Interior Works", r"^Siteworks", r"^External", r"^Public Drainage", r"^JOAL",
]


def is_inspection(task_name):
    task_lower = task_name.lower()
    for kw in INSPECTION_KEYWORDS:
        if ".*" in kw:
            if re.search(kw, task_lower):
                return True
        elif kw in task_lower:
            return True
    return False


def detect_lot(task_name):
    for pattern in LOT_PATTERNS:
        if re.match(pattern, task_name, re.IGNORECASE):
            return task_name.strip()
    return None


def detect_section(task_name):
    for pattern in SECTION_PATTERNS:
        if re.match(pattern, task_name, re.IGNORECASE):
            return task_name.strip()
    return None


def parse_date(date_str):
    if not date_str:
        return None
    date_str = date_str.strip()
    formats = ["%a %d/%m/%y", "%d/%m/%y", "%d/%m/%Y", "%a %d/%m/%Y", "%d %b %Y", "%d %b %y", "%Y-%m-%d"]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def extract_with_pdfplumber(pdf_path):
    import pdfplumber
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
                        if id_num == "ID":
                            continue
                        all_rows.append({"id": id_num, "task": task, "duration": duration, "start": start, "finish": finish})
    return all_rows


def assign_lots(rows):
    current_lot = None
    current_section = None
    for row in rows:
        task = row["task"]
        lot = detect_lot(task)
        if lot:
            current_lot = lot
            row["is_header"] = True
            continue
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
    inspections = []
    for row in rows:
        if row.get("is_header"):
            continue
        if is_inspection(row["task"]):
            start_date = parse_date(row["start"])
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


def extract_with_claude_vision(pdf_path):
    import anthropic
    import pypdfium2
    import base64
    import io

    pdf = pypdfium2.PdfDocument(pdf_path)
    pages_images = []
    for i in range(len(pdf)):
        page = pdf[i]
        bitmap = page.render(scale=2.5)
        img = bitmap.to_pil()
        pages_images.append(img)

    client = anthropic.Anthropic()
    all_inspections = []

    batch_size = 3
    for batch_start in range(0, len(pages_images), batch_size):
        batch = pages_images[batch_start:batch_start + batch_size]

        content = []
        for img in batch:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})

        content.append({
            "type": "text",
            "text": """These are pages from a construction program/schedule (Gantt chart).
Extract ALL inspection-related tasks. Look for: inspection, preline, postline, prewrap, cavity, cladding, structural, council, consentium, facade, architect, engineer, fire, drainage, waterproofing, defect, final, CCC, prefinal, geotech.
For each: id, task name, lot/section, start date, duration.
Return ONLY valid JSON array. No explanation. If none found, return []."""
        })

        try:
            msg = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": content}],
            )
            response_text = msg.content[0].text.strip()
            if "```" in response_text:
                json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", response_text, re.DOTALL)
                if json_match:
                    response_text = json_match.group(1)
            batch_inspections = json.loads(response_text)
            if isinstance(batch_inspections, list):
                all_inspections.extend(batch_inspections)
        except Exception:
            pass

    return all_inspections


def group_by_lot(inspections):
    lots = {}
    for insp in inspections:
        lot = insp.get("lot") or "General"
        if lot not in lots:
            lots[lot] = []
        lots[lot].append(insp)
    return lots


def parse_multipart(body, content_type):
    """Simple multipart form parser to extract uploaded file."""
    boundary = content_type.split("boundary=")[1].strip()
    if boundary.startswith('"') and boundary.endswith('"'):
        boundary = boundary[1:-1]

    parts = body.split(("--" + boundary).encode())
    for part in parts:
        if b"filename=" in part:
            # Find the file data (after double CRLF)
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            file_data = part[header_end + 4:]
            # Remove trailing \r\n--
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]
            if file_data.endswith(b"--"):
                file_data = file_data[:-2]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            # Extract filename
            header = part[:header_end].decode("utf-8", errors="replace")
            fn_match = re.search(r'filename="([^"]+)"', header)
            filename = fn_match.group(1) if fn_match else "upload.pdf"

            return filename, file_data

    return None, None


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        content_type = self.headers.get("Content-Type", "")

        if "multipart/form-data" not in content_type:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Expected multipart form data"}).encode())
            return

        body = self.rfile.read(content_length)
        filename, file_data = parse_multipart(body, content_type)

        if not file_data or not filename.lower().endswith(".pdf"):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "No PDF file found"}).encode())
            return

        # Save to temp file
        tmp_path = os.path.join(tempfile.gettempdir(), "soterra_parse_" + str(os.getpid()) + ".pdf")
        with open(tmp_path, "wb") as f:
            f.write(file_data)

        try:
            # Try standard extraction first
            rows = extract_with_pdfplumber(tmp_path)
            rows = assign_lots(rows)
            inspections = extract_inspections(rows)

            # If standard found very few, try Claude Vision
            if len(inspections) < 3 and os.environ.get("ANTHROPIC_API_KEY"):
                try:
                    vision_inspections = extract_with_claude_vision(tmp_path)
                    if len(vision_inspections) > len(inspections):
                        inspections = vision_inspections
                except Exception:
                    pass

            by_lot = group_by_lot(inspections)

            result = json.dumps({
                "success": True,
                "filename": filename,
                "total": len(inspections),
                "inspections": inspections,
                "by_lot": by_lot,
                "lots": list(by_lot.keys()),
            })

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(result.encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
