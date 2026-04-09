"""
Soterra Local Server
====================
Runs a small local server that handles PDF program uploads
and returns parsed inspection data.

Usage:
    uv run --with pdfplumber --with anthropic --with flask --with flask-cors server.py

Then open: http://localhost:5000
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import sys
import tempfile
import json

# Add tools dir to path so we can import parse_program
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_program import extract_with_pdfplumber, assign_lots, extract_inspections, extract_with_claude, group_by_lot

# Load env
ENV_PATH = os.path.join(os.path.expanduser("~"), ".soterra", ".env")
if os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key] = val

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), ".."))
CORS(app)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "setup.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)


@app.route("/api/parse-program", methods=["POST"])
def parse_program():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    use_smart = request.form.get("smart", "false") == "true"

    # Save to temp file (Windows needs delete=False and manual cleanup)
    tmp_path = os.path.join(tempfile.gettempdir(), "soterra_upload_" + str(os.getpid()) + ".pdf")
    file.save(tmp_path)

    try:
        if use_smart:
            inspections = extract_with_claude(tmp_path)
        else:
            rows = extract_with_pdfplumber(tmp_path)
            rows = assign_lots(rows)
            inspections = extract_inspections(rows)

        # If standard mode found nothing, try smart mode as fallback
        if not inspections and not use_smart and os.environ.get("ANTHROPIC_API_KEY"):
            print("Standard extraction found nothing, trying Claude API...")
            inspections = extract_with_claude(tmp_path)

        by_lot = group_by_lot(inspections)

        return jsonify({
            "success": True,
            "filename": file.filename,
            "total": len(inspections),
            "inspections": inspections,
            "by_lot": by_lot,
            "lots": list(by_lot.keys()),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    print("\n  Soterra Server running!")
    print("  Open: http://localhost:5000\n")
    app.run(debug=True, port=5000)
