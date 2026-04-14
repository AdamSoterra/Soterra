"""
Vercel Cron Job: Send calendar event reminders
Runs daily at 7am NZT, checks for events with reminders due today, sends emails via EmailJS
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timedelta


SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://pffwyxygovfswchxlxun.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
EMAILJS_SERVICE = "service_mnv0ack"
EMAILJS_TEMPLATE = "template_ohsp3wb"
EMAILJS_PUBLIC_KEY = "4DeNw2Orjq9ph7Vz2"


def get_events_with_reminders():
    """Fetch all calendar events that have reminders and assignee emails."""
    url = f"{SUPABASE_URL}/rest/v1/calendar_events?assignee_email=not.is.null&reminder=not.eq.0&select=*"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"Error fetching events: {e}")
        return []


def send_email(to_email, subject, message):
    """Send email via EmailJS REST API."""
    data = json.dumps({
        "service_id": EMAILJS_SERVICE,
        "template_id": EMAILJS_TEMPLATE,
        "user_id": EMAILJS_PUBLIC_KEY,
        "template_params": {
            "to_email": to_email,
            "subject": subject,
            "message": message,
            "name": "Soterra"
        }
    }).encode()

    req = urllib.request.Request(
        "https://api.emailjs.com/api/v1.0/email/send",
        data=data,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"Email send error: {e}")
        return False


def check_and_send_reminders():
    """Check for events with reminders due today and send emails."""
    events = get_events_with_reminders()
    today = datetime.utcnow().date()
    sent_count = 0

    for event in events:
        if not event.get("assignee_email") or not event.get("reminder"):
            continue
        if event["reminder"] == "0":
            continue

        event_date = datetime.strptime(event["event_date"], "%Y-%m-%d").date()
        reminder = event["reminder"]

        # Calculate when reminder should fire
        if reminder == "morning":
            remind_date = event_date
        else:
            days_before = int(reminder)
            remind_date = event_date - timedelta(days=days_before)

        if remind_date == today:
            # Send the reminder
            subject = f"Reminder: {event.get('type', '')} — {event['title']} — {event_date.strftime('%d %b %Y')}"
            message = (
                f"Hi,\n\n"
                f"This is a reminder for an upcoming event:\n\n"
                f"Event: {event['title']}\n"
                f"Type: {event.get('type', 'Other')}\n"
                f"Date: {event_date.strftime('%d %b %Y')}\n"
                f"{('Note: ' + event['note'] + chr(10)) if event.get('note') else ''}\n"
                f"Regards,\nSoterra"
            )

            if send_email(event["assignee_email"], subject, message):
                sent_count += 1
                print(f"Sent reminder to {event['assignee_email']} for {event['title']}")

    return sent_count


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Called by Vercel cron or manual trigger."""
        sent = check_and_send_reminders()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "success": True,
            "reminders_sent": sent,
            "checked_at": datetime.utcnow().isoformat()
        }).encode())
