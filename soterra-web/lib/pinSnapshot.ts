// ─── Pin snapshot ─────────────────────────────────────────────────────────
//
// Renders ONE page of a project's uploaded drawing to a PNG with its pins
// drawn on — the image attached to a flag/fix email so the sub sees exactly
// where on the sheet each numbered issue sits. Same render path as
// /api/doc-page (unpdf + @napi-rs/canvas, private Blob), plus the overlay.
//
// Pins are stored as % of the sheet, so the maths here is the same as the
// on-screen overlay: cx = x/100 * width.

import { and, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { db } from "./db";
import { planPages } from "./schema";
import { PIN_FONT_B64 } from "./pinFont";

// The pin NUMBER is drawn with canvas fillText, which needs a real font file.
// Vercel's Linux serverless has no "Arial" (a Windows/Mac face), so the numbers
// silently rendered nowhere on the emailed snapshot while the circles still drew.
// Register an embedded Noto Sans subset once per cold start so text renders
// everywhere. registerFn is @napi-rs/canvas's GlobalFonts, passed in after the
// dynamic import.
const PIN_FONT = "PinNumber";
let fontRegistered = false;
function ensureFont(GlobalFonts: { register: (buf: Buffer, name?: string) => unknown }): void {
  if (fontRegistered) return;
  try {
    GlobalFonts.register(Buffer.from(PIN_FONT_B64, "base64"), PIN_FONT);
  } catch {
    /* if registration ever fails, fillText falls back to the platform default */
  }
  fontRegistered = true;
}

export type SnapshotPin = { x: number; y: number; label: string };

/** PNG buffer of the sheet with pins, or null when the page/file is missing.
 *  projectId must already be authorised by the caller (verified Scope). */
export async function renderSheetWithPins(
  projectId: string,
  doc: string,
  page: number,
  pins: SnapshotPin[]
): Promise<Buffer | null> {
  const [row] = await db
    .select({ file: planPages.file })
    .from(planPages)
    .where(and(eq(planPages.projectId, projectId), eq(planPages.doc, doc), eq(planPages.page, page)))
    .limit(1);
  if (!row?.file) return null;

  try {
    const got = await get(row.file, { access: "private" });
    if (!got || got.statusCode !== 200 || !got.stream) return null;
    const bytes = new Uint8Array(await new Response(got.stream).arrayBuffer());

    const { renderPageAsImage } = await import("unpdf");
    const png = await renderPageAsImage(bytes, page, {
      scale: 2,
      canvasImport: () => import("@napi-rs/canvas"),
    });

    const canvasMod = await import("@napi-rs/canvas");
    const { createCanvas, loadImage } = canvasMod;
    ensureFont(canvasMod.GlobalFonts);
    const img = await loadImage(Buffer.from(png as ArrayBuffer));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Pin size scales with the sheet so it reads the same at any render size.
    const r = Math.max(14, Math.round(img.width / 60));
    for (const pin of pins) {
      const cx = (pin.x / 100) * img.width;
      const cy = (pin.y / 100) * img.height;
      // tail (triangle pointing at the exact spot), then the numbered head
      ctx.fillStyle = "#F59E0B";
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(2, r / 7);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.9);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - r * 1.35, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${Math.round(r * 1.05)}px ${PIN_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pin.label.slice(0, 3), cx, cy - r * 1.3);
    }

    return canvas.toBuffer("image/png");
  } catch (e) {
    console.error("pin snapshot render failed:", e);
    return null;
  }
}
