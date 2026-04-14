"""
Vercel Serverless Function: The Brain — Analyze inspection reports and store structured data
Endpoint: POST /api/analyze-reports
Processes ONE PDF per request, extracts structured inspection items, saves to Supabase
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
import tempfile
import base64
import urllib.request


SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://pffwyxygovfswchxlxun.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def parse_multipart(body, content_type):
    """Simple multipart form parser."""
    boundary = content_type.split("boundary=")[1].strip()
    if boundary.startswith('"') and boundary.endswith('"'):
        boundary = boundary[1:-1]

    parts = body.split(("--" + boundary).encode())
    file_data = None
    filename = None
    fields = {}

    for part in parts:
        if b"filename=" in part:
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            file_data = part[header_end + 4:]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]
            if file_data.endswith(b"--"):
                file_data = file_data[:-2]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            header = part[:header_end].decode("utf-8", errors="replace")
            fn_match = re.search(r'filename="([^"]+)"', header)
            filename = fn_match.group(1) if fn_match else "report.pdf"
        elif b"name=" in part:
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            header = part[:header_end].decode("utf-8", errors="replace")
            name_match = re.search(r'name="([^"]+)"', header)
            if name_match:
                value = part[header_end + 4:]
                if value.endswith(b"\r\n"):
                    value = value[:-2]
                fields[name_match.group(1)] = value.decode("utf-8", errors="replace")

    return filename, file_data, fields


def detect_inspection_type(filename):
    """Auto-detect inspection type from filename."""
    fn = filename.lower()
    if any(k in fn for k in ['fire', 'canf', 'passive']):
        return 'fire'
    if any(k in fn for k in ['electri', 'building services']):
        return 'electrical'
    if any(k in fn for k in ['hydraul', 'plumb', 'drain', 'site visit report']):
        return 'hydraulic'
    if any(k in fn for k in ['mechani', 'hvac']):
        return 'mechanical'
    if any(k in fn for k in ['structur']):
        return 'structural'
    if any(k in fn for k in ['architect', 'sor ', 'site observation', 'facade', 'façade']):
        return 'architectural'
    if any(k in fn for k in ['acousti', 'cpr']):
        return 'acoustic'
    if any(k in fn for k in ['seism']):
        return 'seismic'
    if any(k in fn for k in ['bco', 'council', 'consentium', 'ipl', 'ipp', 'ipb', 'ime']):
        return 'council'
    return ''


def save_to_supabase(items, company_id, project_id, inspection_type, inspection_date, outcome, report_type, filename):
    """Save extracted items to inspection_items table via Supabase REST API."""
    if not SUPABASE_KEY:
        print("No SUPABASE_SERVICE_KEY set — skipping database save")
        return

    rows = []
    for item in items:
        rows.append({
            "company_id": company_id,
            "project_id": project_id if project_id else None,
            "inspection_type": inspection_type,
            "inspection_date": inspection_date,
            "outcome": outcome,
            "report_type": report_type,
            "item_title": item.get("title", ""),
            "item_description": item.get("description", ""),
            "location": item.get("location", None),
            "source_filename": filename
        })

    # If no items but we have an outcome (e.g. pass), still save one row as a record
    if not rows:
        rows.append({
            "company_id": company_id,
            "project_id": project_id if project_id else None,
            "inspection_type": inspection_type,
            "inspection_date": inspection_date,
            "outcome": outcome,
            "report_type": report_type,
            "item_title": "No issues — " + outcome,
            "item_description": "Report passed with no items requiring action",
            "location": None,
            "source_filename": filename
        })

    data = json.dumps(rows).encode()
    url = f"{SUPABASE_URL}/rest/v1/inspection_items"
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 201)
    except Exception as e:
        print(f"Supabase save error: {e}")
        return False


def analyze_pdf(file_data, filename, inspection_type):
    """Use Claude API to extract structured inspection data from a PDF."""
    import anthropic
    import pdfplumber
    import io as _io

    tmp_path = os.path.join(tempfile.gettempdir(), "soterra_brain_" + str(os.getpid()) + ".pdf")
    with open(tmp_path, "wb") as f:
        f.write(file_data)

    try:
        # Try Vision first
        try:
            import pypdfium2
            pdf_doc = pypdfium2.PdfDocument(tmp_path)
            encoded_pages = []
            for i in range(min(len(pdf_doc), 5)):
                page = pdf_doc[i]
                bitmap = page.render(scale=3)
                img = bitmap.to_pil()
                buf = _io.BytesIO()
                img.save(buf, format="JPEG", quality=85)
                b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
                encoded_pages.append(b64)
            use_vision = len(encoded_pages) > 0
        except Exception:
            use_vision = False
            encoded_pages = []

        # Text extraction
        text = ""
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"

        if not text.strip() and not use_vision:
            return {"outcome": "unknown", "report_type": "unknown", "issues": [], "inspection_date": None}

        client = anthropic.Anthropic()
        content = []
        if use_vision:
            for b64 in encoded_pages:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})

        content.append({"type": "text", "text": f"""You are analyzing a construction inspection report from a New Zealand construction project for Soterra's inspection intelligence engine. Extract ALL structured data from this report.

REPORT TYPES:
1. COUNCIL/CONSENTIUM REPORTS — Formal checklists with Pass/Fail/Partial Pass outcomes. If PASS with no issues, return empty issues array. If FAIL or PARTIAL, extract failed items.
2. CONSULTANT ADVICE NOTICES — Letters from engineers describing defects and items needing attention. Extract ALL items needing action.

IGNORE COMPLETED ITEMS:
- Crossed out / strikethrough text = COMPLETED, skip these
- Items marked "done", "completed", "closed", "rectified" = skip
- Only extract items that are STILL OPEN

STATUS KEYWORDS TO LOOK FOR:
Pass: pass, passed, compliant, satisfactory, acceptable, complete, no issues, no defects, meets requirements, approved, verified
Fail: fail, failed, non-compliant, unsatisfactory, defect, deficiency, NCR, breach, outstanding, missing, incorrect, incomplete, inadequate, requires rectification, action required
Partial: partial pass, conditionally approved, subject to, pending, provisional, reinspection required, follow-up required

LOCATION KEYWORDS: level, floor, zone, room, unit, apartment, lot, riser, shaft, plant room, ceiling space, service zone, wall, slab, penetration

EXTRACT THE INSPECTION DATE from the report content. Look for: inspection date, date of inspection, site visit date, report date. Format as YYYY-MM-DD.

Your response must be a JSON object:
{{
  "report_type": "council" or "consultant",
  "outcome": "pass" or "fail" or "partial",
  "inspection_date": "YYYY-MM-DD" or null,
  "issues": [
    {{
      "title": "short description (under 10 words)",
      "description": "full detail from report",
      "location": "extracted location or null"
    }}
  ]
}}

The inspection type is: {inspection_type}
The filename is: {filename}

{"VISUAL CHECK: Look for strikethrough text in the images — exclude those items." if use_vision else ""}

Return ONLY valid JSON. No explanation, no markdown.

Report text:
{text[:15000]}"""})

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

        result = json.loads(response_text)
        return result

    except Exception as e:
        print(f"Analysis error: {e}")
        return {"outcome": "error", "report_type": "unknown", "issues": [], "inspection_date": None, "error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass


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
        filename, file_data, fields = parse_multipart(body, content_type)

        company_id = fields.get("company_id", "")
        project_id = fields.get("project_id", "")
        inspection_type = fields.get("inspection_type", "")

        if not file_data:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "No file found"}).encode())
            return

        if not company_id:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "company_id is required"}).encode())
            return

        # Auto-detect type from filename if not provided
        if not inspection_type:
            inspection_type = detect_inspection_type(filename)

        try:
            result = analyze_pdf(file_data, filename, inspection_type)

            issues = result.get("issues", [])
            outcome = result.get("outcome", "unknown")
            report_type = result.get("report_type", "unknown")
            inspection_date = result.get("inspection_date", None)

            # Override type with Claude's detection if we had no type
            if not inspection_type and result.get("inspection_type"):
                inspection_type = result["inspection_type"]

            # Save to database
            saved = save_to_supabase(
                issues, company_id, project_id or None,
                inspection_type, inspection_date,
                outcome, report_type, filename
            )

            response = json.dumps({
                "success": True,
                "filename": filename,
                "inspection_type": inspection_type,
                "inspection_date": inspection_date,
                "outcome": outcome,
                "report_type": report_type,
                "issues": issues,
                "total_items": len(issues),
                "saved_to_db": saved
            })

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(response.encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
