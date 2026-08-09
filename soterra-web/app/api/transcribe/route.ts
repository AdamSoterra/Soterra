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

// The bias prompt: the single biggest accuracy lever we have on a noisy site.
//
// ⚠️ Written as PROSE, not a glossary, and that is not a style choice. Whisper's
// prompt is a style prime — it continues the text you hand it — so real
// sentences with the awkward tokens in natural positions beat a comma-separated
// list. Measured on synthesised site questions: no prompt 5/10 key terms
// survived, a term list 8/10, this prose 9/10. The list also let "galvanised"
// through as "Galvanese"; the prose keeps the NZ spelling.
//
// Keep it to vocabulary a builder would really say. It biases, so anything put
// in here can surface in a transcript.
const VOCAB =
  "A New Zealand builder is asking a question on site. " +
  "What size lintel do I need over a 2.4 m opening in SG8 timber with a light roof? " +
  "Does GIB Barrierline need a cavity batten, and what does E2/AS1 say about the flashing? " +
  "Can I use galvanised nails in corrosion zone D, or does NZS 3604 Table 4.3 require stainless steel? " +
  "Is MSG8 acceptable for the bracing, and what H1.2 treatment do the dwangs need? " +
  "Check the ColorSteel, Dimond, James Hardie, Rondo, Ryanfire, Allproof, Resene and " +
  "Kingspan Thermakraft details before the pre-line inspection.";

// The last mile the prompt cannot reach. "Barrierline" is a compound brand word
// and comes back as "Bari Erline" no matter how the prompt is written (tested:
// repeating the brand doesn't help). These are deliberately few and each is a
// distinctive string that cannot plausibly be anything else — a correction map
// that guesses is worse than a transcript that is honestly wrong, because the
// user can see and fix the second one.
const FIXES: [RegExp, string][] = [
  // Whisper splits the word and drops an r: "GIB Bari Erline", "Gibbari Erline".
  // The GIB-prefixed form has to come first — in "Gibbari" the brand isn't at a
  // word boundary, so the standalone rule below can't see it.
  [/\bgib\s*barr?i?[\s-]?erline\b/gi, "GIB Barrierline"],
  [/\bbarr?i?[\s-]?erline\b/gi, "Barrierline"],
  [/\bcavity bat[oa]ns?\b/gi, "cavity batten"],
  // Clause references: "E2-AS1" / "E2 AS1" → "E2/AS1", the form the Code uses
  // and the form retrieval indexes on.
  [/\b([A-H]\d)\s*[-–]\s*(AS|VM)\s?(\d)\b/gi, "$1/$2$3"],
];
const tidy = (s: string) => FIXES.reduce((t, [re, to]) => t.replace(re, to), s);

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
    return Response.json({ text: tidy((json.text ?? "").trim()) });
  } catch (e) {
    console.error("transcribe failed:", e);
    return Response.json({ error: "Transcription failed." }, { status: 502 });
  }
}
