/**
 * Sanity-check generated challenge PDFs: text-based? do the deterministic
 * council parsers (filename / header / fail list) read them? No model, no DB.
 *   npx tsx dev/check-challenge-pdf-text.mts <pdf> [<pdf>...]
 */
import fs from "node:fs";
import path from "node:path";

const { parseCouncilFilename, parseCouncilHeader, parseCouncilFails, expectedItemCount, hasUsableText } = await import(
  "../lib/inspectionExtract.ts"
);
const { extractText, getDocumentProxy } = await import("unpdf");

for (const arg of process.argv.slice(2)) {
  const filename = path.basename(arg);
  const bytes = new Uint8Array(fs.readFileSync(arg));
  const pdf = await getDocumentProxy(bytes);
  const out = await extractText(pdf, { mergePages: true });
  const text = String(out.text).replace(/\s+/g, " ").trim();
  console.log(`\n${filename}`);
  console.log(`  pages ${out.totalPages} · text ${text.length} chars · usable ${hasUsableText(text, out.totalPages)}`);
  console.log(`  filename parse: ${JSON.stringify(parseCouncilFilename(filename))}`);
  console.log(`  header parse:   ${JSON.stringify(parseCouncilHeader(text))}`);
  console.log(`  fail list:      ${JSON.stringify(parseCouncilFails(text))}`);
  console.log(`  expected items: ${expectedItemCount(text)}`);
  console.log(`  first 300 chars: ${text.slice(0, 300)}`);
}
