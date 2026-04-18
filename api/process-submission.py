"""
Vercel Serverless Function: Process a submitted upload_request
Endpoint: POST /api/process-submission

Steps:
1. Load upload_request by id
2. Create company + join code
3. For each file in manifest: download from Supabase Storage, run Claude extraction, save inspection_items
4. Mark upload_request as 'processed' with company_id and join_code
5. Return summary
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
import tempfile
import base64
import urllib.request
import random
import string


SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://pffwyxygovfswchxlxun.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def sb_request(method, path, data=None, extra_headers=None):
    """Make an authenticated request to Supabase REST API."""
    url = f"{SUPABASE_URL}{path}"
    body = json.dumps(data).encode() if data is not None else None
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            txt = resp.read().decode("utf-8")
            return json.loads(txt) if txt else None, None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}"
    except Exception as e:
        return None, str(e)


def sb_storage_download(path):
    """Download a file from Supabase Storage (service role)."""
    url = f"{SUPABASE_URL}/storage/v1/object/pending-uploads/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    })
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def generate_join_code():
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(chars) for _ in range(6))


def detect_inspection_type(filename):
    """Auto-detect inspection type from filename — returns '' when unclear
    so Claude can classify from content."""
    fn = (filename or "").lower()

    def has(pattern):
        return re.search(r"\b" + pattern + r"\b", fn) is not None or pattern in fn

    if any(has(k) for k in ['bco', 'council', 'consentium', 'ipl', 'ipp', 'ipb', 'ime', 'bca']):
        return 'council'
    if any(has(k) for k in ['fire', 'canf', 'passive fire', 'fpanz']):
        return 'fire'
    mechani = any(has(k) for k in ['mechani', 'hvac'])
    electri = any(has(k) for k in ['electri', 'electrical', 'mep'])
    if mechani:
        return 'mechanical'
    if electri:
        return 'electrical'
    if any(has(k) for k in ['building services', 'services', 'sir-']):
        return 'electrical'
    if any(has(k) for k in ['hydraul', 'plumb', 'drain', 'drainage', 'site visit report', 'hsc']):
        return 'hydraulic'
    if any(has(k) for k in ['structur', 'foundation', 'rebar']):
        return 'structural'
    if any(has(k) for k in ['seism', 'geotech']):
        return 'seismic'
    if any(has(k) for k in ['architect', 'arch ', 'sor', 'site observation', 'observation report',
                             'facade', 'façade', 'cladding', 'elevation', 'tgo', 'ca-']):
        return 'architectural'
    if any(has(k) for k in ['acousti', 'cpr ', 'sound', 'noise']):
        return 'acoustic'
    if any(has(k) for k in ['waterproof', 'weather', 'membrane']):
        return 'architectural'
    return ''


def parse_claude_json(text):
    """Robustly parse JSON out of a Claude response."""
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    if "```" in text:
        m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except Exception:
                pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = text.find(open_c)
        end = text.rfind(close_c)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end+1])
            except Exception:
                continue
    return None


def analyze_pdf(file_data, filename, inspection_type):
    """Use Claude to extract structured data from a PDF."""
    import anthropic
    import pdfplumber
    import io as _io

    tmp_path = os.path.join(tempfile.gettempdir(), "sub_" + str(os.getpid()) + "_" + str(random.randint(1, 99999)) + ".pdf")
    with open(tmp_path, "wb") as f:
        f.write(file_data)

    try:
        # Vision attempt
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

EXTRACT THE INSPECTION DATE from the report. Format YYYY-MM-DD.

Your response must be a JSON object:
{{
  "report_type": "council" or "consultant",
  "outcome": "pass" or "fail" or "partial",
  "inspection_date": "YYYY-MM-DD" or null,
  "inspection_type": "fire" | "electrical" | "hydraulic" | "mechanical" | "structural" | "architectural" | "acoustic" | "seismic" | "council" | "other",
  "issues": [
    {{"title":"short","description":"full detail","location":"extracted or null"}}
  ]
}}

INSPECTION TYPE CLASSIFICATION: Classify based on the report content — fire, electrical, hydraulic, mechanical, structural, architectural, acoustic, seismic, council (statutory), or "other" only if you truly cannot classify. If the caller provided a type hint, use it; otherwise classify from content.

The filename hint is: {filename}
The caller's type hint (may be empty): {inspection_type}

{"VISUAL CHECK: Look for strikethrough text in the images — exclude those items." if use_vision else ""}

Return ONLY valid JSON. No explanation, no markdown.

Report text:
{text[:15000]}"""})

        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            messages=[{"role": "user", "content": content}]
        )

        response_text = msg.content[0].text.strip()
        result = parse_claude_json(response_text)
        if result is None:
            return {"outcome": "error", "report_type": "unknown", "issues": [], "inspection_date": None, "error": "Could not parse Claude response as JSON"}
        return result

    except Exception as e:
        return {"outcome": "error", "report_type": "unknown", "issues": [], "inspection_date": None, "error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass


def save_items(items, company_id, inspection_type, inspection_date, outcome, report_type, filename):
    if not items:
        return 0
    rows = []
    for item in items:
        rows.append({
            "company_id": company_id,
            "project_id": None,
            "inspection_type": inspection_type,
            "inspection_date": inspection_date,
            "outcome": outcome,
            "report_type": report_type,
            "item_title": item.get("title", ""),
            "item_description": item.get("description", ""),
            "location": item.get("location"),
            "source_filename": filename
        })
    _, err = sb_request("POST", "/rest/v1/inspection_items", rows, {"Prefer": "return=minimal"})
    if err:
        print(f"Save error: {err}")
        return 0
    return len(rows)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self._json(400, {"error": "Invalid JSON"})
            return

        request_id = payload.get("request_id")
        if not request_id:
            self._json(400, {"error": "request_id required"})
            return

        if not SUPABASE_KEY:
            self._json(500, {"error": "SUPABASE_SERVICE_KEY not configured"})
            return

        try:
            result = process(request_id)
            self._json(200, result)
        except Exception as e:
            self._json(500, {"success": False, "error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def process(request_id):
    # Load upload_request
    data, err = sb_request("GET", f"/rest/v1/upload_requests?id=eq.{request_id}")
    if err or not data or len(data) == 0:
        return {"success": False, "error": f"Request not found: {err or 'empty'}"}
    req = data[0]

    if req.get("status") == "processed":
        return {"success": False, "error": "Already processed"}

    manifest = req.get("file_manifest") or []
    if not manifest:
        return {"success": False, "error": "No files in submission"}

    # Create company with join code
    join_code = generate_join_code()
    comp_data, err = sb_request("POST", "/rest/v1/companies", {
        "name": req["company_name"],
        "join_code": join_code
    })
    if err or not comp_data:
        return {"success": False, "error": f"Company creation failed: {err}"}
    company_id = comp_data[0]["id"]

    # Process each file
    total_items = 0
    types_found = set()
    file_results = []
    for entry in manifest:
        path = entry.get("path")
        name = entry.get("name", "report.pdf")
        if not path:
            continue
        try:
            pdf_bytes = sb_storage_download(path)
            itype = detect_inspection_type(name)
            result = analyze_pdf(pdf_bytes, name, itype)
            issues = result.get("issues", [])
            outcome = result.get("outcome", "unknown")
            rtype = result.get("report_type", "unknown")
            idate = result.get("inspection_date")
            # Use Claude's classification when filename detection didn't match
            if not itype and result.get("inspection_type"):
                itype = result["inspection_type"]
            final_type = itype or "other"
            saved = save_items(issues, company_id, final_type, idate, outcome, rtype, name)
            total_items += saved
            types_found.add(final_type)
            file_results.append({"name": name, "items": saved, "outcome": outcome, "type": final_type})
        except Exception as e:
            file_results.append({"name": name, "items": 0, "error": str(e)})

    # Update upload_request to processed
    sb_request("PATCH", f"/rest/v1/upload_requests?id=eq.{request_id}", {
        "status": "processed",
        "processed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "processed_company_id": company_id,
        "processed_join_code": join_code
    })

    return {
        "success": True,
        "company_name": req["company_name"],
        "company_id": company_id,
        "join_code": join_code,
        "total_items": total_items,
        "types": sorted(list(types_found)),
        "files": file_results
    }
