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

            result = json.dumps({
                "success": True,
                "issues": issues,
                "total": len(issues),
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
    """Use Claude API to read inspection report and extract failed items."""
    import anthropic

    # Convert PDF to images for Claude Vision
    tmp_path = os.path.join(tempfile.gettempdir(), "soterra_report_" + str(os.getpid()) + ".pdf")
    with open(tmp_path, "wb") as f:
        f.write(file_data)

    try:
        import pypdfium2
        import io

        pdf = pypdfium2.PdfDocument(tmp_path)
        encoded_pages = []
        for i in range(min(len(pdf), 5)):  # Max 5 pages
            page = pdf[i]
            bitmap = page.render(scale=2)
            img = bitmap.to_pil()
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=80)
            b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
            encoded_pages.append(b64)

        client = anthropic.Anthropic()

        content = []
        for b64 in encoded_pages:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })

        content.append({
            "type": "text",
            "text": f"""You are reading a construction inspection report. Extract ALL items that FAILED or need attention.

For each failed/non-compliant item, provide:
- title: short description of the issue (e.g. "Fire stopping gap at riser", "Pipe penetration not sealed")
- description: the full detail from the report about this issue

Ignore items that passed or are compliant. Only extract failures, defects, non-conformances, and items requiring action.

The inspection type is: {inspection_type}
The lot/area is: {lot}

Return ONLY valid JSON array. No explanation. Example:
[
  {{"title": "Fire stopping gap at riser", "description": "Gap in fire stopping around service penetration at Level 3 riser. Needs to be sealed to maintain fire rating."}},
  {{"title": "Smoke detector placement incorrect", "description": "Smoke detector in apartment 4B installed too close to air conditioning vent. Must be relocated as per NZS 4512."}}
]

If no failed items are found, return: []"""
        })

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

        issues = json.loads(response_text)
        return issues if isinstance(issues, list) else []

    except Exception as e:
        # If PDF reading fails, try with just text
        try:
            import pdfplumber
            text = ""
            with pdfplumber.open(tmp_path) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text += t + "\n"

            if not text.strip():
                return []

            client = anthropic.Anthropic()
            msg = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": f"""Extract ALL failed/non-compliant items from this inspection report.

For each failed item provide: title (short) and description (full detail).
Inspection type: {inspection_type}, Lot: {lot}

Return ONLY valid JSON array.

Report text:
{text[:10000]}"""}],
            )

            response_text = msg.content[0].text.strip()
            if "```" in response_text:
                json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", response_text, re.DOTALL)
                if json_match:
                    response_text = json_match.group(1)

            issues = json.loads(response_text)
            return issues if isinstance(issues, list) else []
        except:
            return []
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass
