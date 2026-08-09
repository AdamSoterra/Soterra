import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Turn a short recording from the composer's mic into text.
//
// Why this exists: on an iPhone home-screen web app the Web Speech API is
// exposed but does nothing — Apple refuses the speech path there, while
// getUserMedia in the same app records perfectly. Since Add to Home Screen is
// our entire iOS channel, the browser cannot do this for us and the audio has
// to come here. (The Android app doesn't use this route at all; it has the
// phone's own engine through Capacitor.)
//
//   POST /api/transcribe   FormData { audio: Blob }  →  { text }
//
// Deliberately vendor-agnostic: the endpoint is OpenAI-compatible, so moving
// between Groq and OpenAI is a base URL and a model name, set by env.
const STT_URL = process.env.STT_BASE_URL ?? "https://api.groq.com/openai/v1";
const STT_MODEL = process.env.STT_MODEL ?? "whisper-large-v3-turbo";
const STT_KEY = process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

// A short question at arm's length on a windy site is a few tens of KB. This is
// a cap on abuse, not on speech; the client already stops recording at 60s.
const MAX_BYTES = 8 * 1024 * 1024;

// Whisper takes a bias prompt, and it is the single biggest accuracy lever we
// have on a noisy site. Without it "SG8" comes back as "SGA" and "GIB" as "jib".
// Keep this to REAL vocabulary the model would otherwise mangle — it biases,
// so junk in here shows up in transcripts.
const VOCAB =
  "New Zealand construction. Terms: NZS 3604, NZBC, E2/AS1, B1, H1.2, SG8, MSG8, " +
  "GIB, GIB Barrierline, GIB Aqualine, Rondo, Ryanfire, BOSS Fire, Allproof, Resene, " +
  "ColorSteel, James Hardie, Kingspan Thermakraft, Dimond, cavity batten, lintel, " +
  "loaded dimension, bracing, purlin, soffit, flashing, sarking, dwang, nog, " +
  "pre-line, pre-pour, code compliance certificate, producer statement, RFI.";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  if (!STT_KEY) {
    // No key configured. Say so plainly with a distinct status so the client
    // can fall back to the keyboard's mic key rather than showing a mystery
    // failure — voice on iPhone still works, just not through us.
    return Response.json({ error: "not-configured" }, { status: 503 });
  }

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof File) audio = f;
  } catch {
    return Response.json({ error: "Could not read the recording." }, { status: 400 });
  }
  if (!audio || audio.size === 0) return Response.json({ error: "No audio received." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });

  // iOS records MP4/AAC, not WebM — the extension has to match the container or
  // the API rejects the file outright.
  const ext = audio.type.includes("mp4") || audio.type.includes("m4a") ? "m4a"
    : audio.type.includes("webm") ? "webm"
    : audio.type.includes("ogg") ? "ogg"
    : audio.type.includes("wav") ? "wav"
    : "m4a";

  const body = new FormData();
  body.append("file", audio, `speech.${ext}`);
  body.append("model", STT_MODEL);
  body.append("language", "en");
  body.append("prompt", VOCAB);
  body.append("response_format", "json");

  try {
    const res = await fetch(`${STT_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${STT_KEY}` },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("transcribe upstream failed:", res.status, detail.slice(0, 500));
      return Response.json({ error: "Transcription failed." }, { status: 502 });
    }
    const json = (await res.json()) as { text?: string };
    return Response.json({ text: (json.text ?? "").trim() });
  } catch (e) {
    console.error("transcribe failed:", e);
    return Response.json({ error: "Transcription failed." }, { status: 502 });
  }
}
