"""
Vercel Serverless Function: Extract failed items from inspection report PDFs
Endpoint: POST /api/extract-issues
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
import tempfile
import base64

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

        inspection_type = fields.get("inspection_type", "")
        lot = fields.get("lot", "")

        if not file_data:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "No file found"}).encode())
            return

        try:
            # Try text extraction first
            issues = extract_issues_from_pdf(file_data, filename, inspection_type, lot)

            # Explicit error from extraction — don't mask as "pass"
            if isinstance(issues, dict) and issues.get("error"):
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "error": "Could not extract issues: " + issues.get("error", "unknown")
                }).encode())
                return

            # Handle structured response with report_type and outcome
            if isinstance(issues, dict):
                extracted_issues = issues.get("issues", [])
                outcome = issues.get("outcome", "fail")
                report_type = issues.get("report_type", "consultant")
            else:
                extracted_issues = issues
                outcome = "fail" if issues else "pass"
                report_type = "unknown"

            result = json.dumps({
                "success": True,
                "issues": extracted_issues,
                "total": len(extracted_issues),
                "outcome": outcome,
                "report_type": report_type,
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

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def extract_issues_from_pdf(file_data, filename, inspection_type, lot):
    """Use Claude API to read inspection report and extract failed items. Text-first approach."""
    import anthropic
    import pdfplumber
    import io as _io

    tmp_path = os.path.join(tempfile.gettempdir(), "soterra_report_" + str(os.getpid()) + ".pdf")
    with open(tmp_path, "wb") as f:
        f.write(file_data)

    try:
        # Try Vision first (can see strikethrough/crossed out items)
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

        # Fall back to text extraction if Vision unavailable
        text = ""
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"

        if not text.strip() and not use_vision:
            return []

        client = anthropic.Anthropic()
        # Build message content — use Vision if available
        content = []
        if use_vision:
            for b64 in encoded_pages:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})

        content.append({"type": "text", "text": f"""You are reading a construction inspection report from a New Zealand construction project. There are two types of reports:

TYPE 1 — COUNCIL/CONSENTIUM REPORTS: These have a formal inspection checklist with clear Pass/Fail/Partial Pass outcomes. They follow Auckland Council or Consentium format with checklist items. If the overall outcome is PASS, do NOT extract any items. If FAIL or PARTIAL PASS, extract only the failed checklist items.

TYPE 2 — CONSULTANT ADVICE NOTICES: These are letters from fire engineers, structural engineers, or other consultants. They describe site observations, defects, and items needing attention. They do NOT have a formal Pass/Fail outcome. If ANY items need action, extract them ALL — even minor ones. Only return empty if the consultant genuinely found nothing.

IMPORTANT — IGNORE COMPLETED/RESOLVED ITEMS:
- Items that are crossed out, struck through, or have strikethrough text are COMPLETED — do NOT extract these
- Items marked as "done", "completed", "closed", "resolved", "rectified", "addressed", "confirmed complete" are NOT active issues
- Items with notes saying "now compliant", "has been fixed", "work completed" are resolved — skip them
- Only extract items that are STILL OPEN and need action
- If a report shows previous items with completion notes alongside new items, only extract the new/open items

Your response must be a JSON object (not array) with this structure:
{{"report_type": "council" or "consultant", "outcome": "pass" or "fail" or "partial", "issues": [...]}}

Rules:
- For council PASS reports: outcome="pass", issues=[]
- For council FAIL reports: outcome="fail", issues=[list of failed items]
- For council PARTIAL PASS: outcome="partial", issues=[list of outstanding items]
- For consultant reports with items: outcome="fail", issues=[list of all items needing action]
- For consultant reports with no items: outcome="pass", issues=[]

Each issue: {{"title": "short description", "description": "full detail from report"}}

The inspection type is: {inspection_type}
The lot/area is: {lot}

Return ONLY valid JSON. No explanation, no markdown code blocks.

{"CRITICAL VISUAL CHECK: You are viewing actual images of the report. CAREFULLY LOOK for any text that has a horizontal line drawn through it (strikethrough text). In construction reports, items with strikethrough/line-through formatting mean they have been COMPLETED and RESOLVED. You MUST EXCLUDE any item where the text has a line drawn through it. Only include items where the text is clean and NOT crossed out. This is extremely important — if an item has strikethrough formatting, it is done and must NOT appear in the issues list." if use_vision else ""}

Report text:
{text[:12000]}"""})

        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            messages=[{"role": "user", "content": content}],
        )

        response_text = msg.content[0].text.strip()
        result = parse_claude_json(response_text)
        if result is None:
            return {"error": "Could not parse Claude response as JSON"}

        # Handle both old array format and new object format
        if isinstance(result, list):
            return result
        elif isinstance(result, dict):
            return result
        else:
            return {"error": "Unexpected response type from Claude"}

    except Exception as e:
        return {"error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass


def parse_claude_json(text):
    """Robustly parse JSON out of a Claude response.
    Returns dict/list on success, None on failure.
    Tries: direct parse, stripped markdown, or largest {...}/[...] substring."""
    if not text:
        return None
    # 1) Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # 2) Strip markdown fences
    if "```" in text:
        m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if m:
            inner = m.group(1).strip()
            try:
                return json.loads(inner)
            except Exception:
                pass
    # 3) Find outermost { ... } or [ ... ]
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = text.find(open_c)
        end = text.rfind(close_c)
        if start != -1 and end != -1 and end > start:
            candidate = text[start:end+1]
            try:
                return json.loads(candidate)
            except Exception:
                continue
    return None
