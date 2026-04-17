"""
Vercel Serverless Function: Soterra Assistant Chat
Endpoint: POST /api/chat

Answers questions from:
1. Company inspection data (passed as context_summary)
2. General NZ construction knowledge (with disclaimers)

Response format rules enforced via system prompt.
"""

from http.server import BaseHTTPRequestHandler
import json


SYSTEM_PROMPT_TEMPLATE = """You are Soterra Assistant, an AI embedded in the Soterra construction inspection intelligence platform.

You help NZ construction project managers and site teams with two kinds of questions:

1. **Questions about THEIR company's inspection data** — you have access to a summary of their historical inspections, failure patterns, and current project KPIs below.
2. **General NZ construction knowledge** — building codes (NZBC), NZS standards, best practices for inspections, typical failure modes, compliance tips, etc.

## RESPONSE RULES (IMPORTANT)

When answering about THEIR data, ALWAYS start the response with:
📊 Your data shows…

…and cite specific numbers from the context provided (e.g. "Based on your 30 inspection items across 2 types").

When answering a GENERAL construction question, ALWAYS start with:
📚 General knowledge:

…and include this disclaimer at the end:
*Always verify against official building codes (NZBC, NZS standards) before making compliance decisions.*

Never invent specific regulation numbers, clause references, or legal requirements — if you're not 100% sure, tell the user to verify with an official source.

If a question combines both (e.g. "what's passive fire and what fails most on my site?"), give TWO sections, one with each prefix.

If the question is outside construction/inspection scope (e.g. weather, sports, unrelated coding help), politely redirect:
"I'm focused on helping with construction inspections and your Soterra data. Is there something in that area I can help with?"

Keep answers concise — aim for 3-6 sentences per section unless the user asks for detail.

## COMPANY DATA CONTEXT

{company_summary}

## CURRENT PROJECT CONTEXT

{project_summary}

## CONVERSATION GUIDELINES

- Be professional but friendly — talk to a PM, not to a code reviewer
- Use bullet points for multi-item answers
- When suggesting action items, number them
- If the user asks something you can tell from context, answer directly — don't say "upload more data" unless the question truly can't be answered
- If they ask something the data doesn't cover ("how many preline inspections failed last month"), be honest: "I don't see that in the current data."
"""


def build_system_prompt(company_summary, project_summary):
    return SYSTEM_PROMPT_TEMPLATE.format(
        company_summary=company_summary or "No company data uploaded yet — admin should upload historical reports via admin-setup.",
        project_summary=project_summary or "No current project selected."
    )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
            return

        message = (payload.get("message") or "").strip()
        history = payload.get("history") or []
        context = payload.get("context") or {}

        if not message:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Empty message"}).encode())
            return

        try:
            reply = run_chat(message, history, context)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "reply": reply
            }).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": False,
                "error": str(e)
            }).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def run_chat(message, history, context):
    import anthropic

    system = build_system_prompt(
        context.get("company_summary", ""),
        context.get("project_summary", "")
    )

    # Build messages array — last 10 history turns + current message
    messages = []
    for turn in history[-10:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system,
        messages=messages
    )

    # Extract text response
    reply = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            reply += block.text
    return reply.strip() or "I didn't catch that — can you rephrase?"
