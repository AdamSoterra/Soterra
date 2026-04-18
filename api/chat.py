"""
Vercel Serverless Function: Soterra Assistant Chat
Endpoint: POST /api/chat

Answers questions from:
1. Company inspection data (passed as context.company_summary)
2. Current project data (passed as context.project_summary)
3. Attached construction plans (fetched from Supabase Storage, sent to Claude Vision)
4. General NZ construction knowledge (with disclaimers)

Response format rules enforced via system prompt.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import base64
import tempfile
import urllib.request


SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://pffwyxygovfswchxlxun.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

MAX_PLANS = 5
MAX_PAGES_PER_PLAN = 3


SYSTEM_PROMPT_TEMPLATE = """You are Soterra Assistant, an AI embedded in the Soterra construction inspection intelligence platform.

You help NZ construction project managers and site teams with four kinds of questions:

1. **Questions about THEIR company's inspection data** — historical failure patterns, current project KPIs.
2. **Questions about the construction plans they've attached** — the user may have uploaded drawings for this project. When plan images are attached above, you can see them directly and answer questions about the building (elevations, floor plans, details, cladding, layout etc.).
3. **General NZ construction knowledge** — building codes (NZBC), NZS standards, best practices.
4. **Combinations of the above**.

## RESPONSE RULES (IMPORTANT)

When answering about THEIR inspection data, ALWAYS start with:
📊 Your data shows…
…and cite specific numbers from the context.

When answering from THEIR attached plans, ALWAYS start with:
📐 From your plans…
…and reference which plan you're looking at (by filename). Be specific about what you see.

When answering a GENERAL construction question, ALWAYS start with:
📚 General knowledge:
…and include the disclaimer at the end:
*Always verify against official building codes (NZBC, NZS standards) before making compliance decisions.*

If a question combines multiple types, give separate sections with the right prefixes.

Never invent specific regulation numbers, clause references, or legal requirements — if not 100% sure, say so.

If the question is outside construction/inspection scope, politely redirect:
"I'm focused on helping with construction inspections and your Soterra data. Is there something in that area I can help with?"

Keep answers concise — aim for 3-6 sentences per section unless the user asks for detail.

## COMPANY DATA CONTEXT

{company_summary}

## CURRENT PROJECT CONTEXT

{project_summary}

## ATTACHED PLANS

{plans_summary}

## CONVERSATION GUIDELINES

- Be professional but friendly — you're talking to a PM, not a code reviewer
- Use bullet points for multi-item answers
- Number action items
- Answer directly from context — don't say "upload more data" unless the question truly can't be answered
- If they ask something the data doesn't cover, be honest: "I don't see that in the current data."
"""


def build_system_prompt(company_summary, project_summary, plans_summary):
    return SYSTEM_PROMPT_TEMPLATE.format(
        company_summary=company_summary or "No company data uploaded yet.",
        project_summary=project_summary or "No current project selected.",
        plans_summary=plans_summary or "No plans attached to this project yet."
    )


def sb_request(method, path, data=None):
    url = f"{SUPABASE_URL}{path}"
    body = json.dumps(data).encode() if data is not None else None
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            txt = resp.read().decode("utf-8")
            return json.loads(txt) if txt else None, None
    except Exception as e:
        return None, str(e)


def sb_storage_download(path):
    """Download file from Supabase Storage 'project-plans' bucket."""
    url = f"{SUPABASE_URL}/storage/v1/object/project-plans/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    })
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def render_plan_as_images(file_bytes, max_pages=MAX_PAGES_PER_PLAN):
    """Render a PDF (bytes) into base64 JPEG images, up to max_pages."""
    try:
        import pypdfium2
        import io as _io
        tmp_path = os.path.join(tempfile.gettempdir(), f"plan_{os.getpid()}.pdf")
        with open(tmp_path, "wb") as f:
            f.write(file_bytes)
        try:
            pdf_doc = pypdfium2.PdfDocument(tmp_path)
            images = []
            for i in range(min(len(pdf_doc), max_pages)):
                page = pdf_doc[i]
                bitmap = page.render(scale=2)  # 2x is enough for plan legibility while keeping token cost lower
                img = bitmap.to_pil()
                buf = _io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
                images.append(b64)
            return images
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except Exception as e:
        print(f"render_plan_as_images error: {e}")
        return []


def fetch_plan_images(plan_ids):
    """Given a list of plan/document ids, fetch each PDF and return [(filename, [b64 pages...]), ...]."""
    results = []
    if not plan_ids or not SUPABASE_KEY:
        return results
    # Limit to MAX_PLANS
    plan_ids = plan_ids[:MAX_PLANS]
    # Fetch metadata for all requested plans in one query
    # PostgREST: /rest/v1/documents?id=in.(id1,id2)&select=id,name,storage_path,content_type
    ids_csv = ",".join(str(i) for i in plan_ids)
    data, err = sb_request("GET", f"/rest/v1/documents?id=in.({ids_csv})&select=id,name,storage_path,content_type")
    if err or not data:
        print(f"Plan metadata fetch error: {err}")
        return results
    # Preserve caller order
    id_to_row = {row["id"]: row for row in data}
    for pid in plan_ids:
        row = id_to_row.get(pid)
        if not row:
            continue
        ct = (row.get("content_type") or "").lower()
        # Only process PDFs via Vision for now (jpg/png could also be sent directly)
        if "pdf" in ct or row["name"].lower().endswith(".pdf"):
            try:
                pdf_bytes = sb_storage_download(row["storage_path"])
                images = render_plan_as_images(pdf_bytes)
                if images:
                    results.append((row["name"], images))
            except Exception as e:
                print(f"Failed to fetch plan {row['name']}: {e}")
    return results


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self._json(400, {"error": "Invalid JSON"})
            return

        message = (payload.get("message") or "").strip()
        history = payload.get("history") or []
        context = payload.get("context") or {}
        plan_ids = payload.get("plan_ids") or []

        if not message:
            self._json(400, {"error": "Empty message"})
            return

        try:
            reply = run_chat(message, history, context, plan_ids)
            self._json(200, {"success": True, "reply": reply})
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


def run_chat(message, history, context, plan_ids):
    import anthropic

    # Build plans summary text (list of filenames/ids) for the system prompt
    attached = context.get("attached_plans") or []
    if attached:
        lines = [f"- {p.get('name','(unnamed)')}" for p in attached[:MAX_PLANS]]
        extra = len(attached) - MAX_PLANS
        if extra > 0:
            lines.append(f"(+ {extra} more plans attached but not sent as images)")
        plans_summary = "The following construction plans are attached to this project:\n" + "\n".join(lines)
    else:
        plans_summary = ""

    system = build_system_prompt(
        context.get("company_summary", ""),
        context.get("project_summary", ""),
        plans_summary
    )

    # Fetch plan images if plan_ids provided
    plan_images = []
    if plan_ids:
        plan_images = fetch_plan_images(plan_ids)

    # Build messages: last 10 history turns + current message (with plans prepended if any)
    messages = []
    for turn in history[-10:]:
        role = turn.get("role")
        content_val = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content_val:
            messages.append({"role": role, "content": content_val})

    # Construct current user message — may include plan images
    if plan_images:
        user_content = []
        for filename, images in plan_images:
            user_content.append({
                "type": "text",
                "text": f"[Plan: {filename}]"
            })
            for b64 in images:
                user_content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}
                })
        user_content.append({"type": "text", "text": message})
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": message})

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        system=system,
        messages=messages
    )

    # Extract text response
    reply = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            reply += block.text
    return reply.strip() or "I didn't catch that — can you rephrase?"
