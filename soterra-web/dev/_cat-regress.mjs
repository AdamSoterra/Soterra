import { extractText, getDocumentProxy } from "unpdf";
import fs from "node:fs/promises";
import path from "node:path";
const SERVICES_SUBJECT = /\b(?:sanitary|soil (?:pipe|stack)|waste (?:pipe|stack|water)|foul water|storm ?water|drain(?:age|s)?|pipe(?:s|work)?|plumb\w*|hydraulic|flush ?box(?:es)?|duct(?:s|work|ing)?)\b/i;
const base = (acou) => ([
  { re: /\bpassive fire|fire ?stop|firestop|fire collar|fire wrap|fire sleeve|fire seal|fire lin(?:ing|ed)|fire rated|fire[- ]resist|fire wall|fire cell|frr\b|fire curtain|fire damper|fire door|smoke door|smoke seal|intumescent|fire glazing|fire design|fire report|fire alarm|manual call point|smoke detector|heat detector|exit sign|emergency light|sprinkler|hydrant|fire service|non-?combustib|penetration.*fire|fire.*penetration|service penetration|final exit|fire blocked|fire protection/i, cat: "Fire" },
  { re: /\bseismic|sway brace|service restraint|restrained? (?:for|against) earthquake|bracing of services|seismic (?:gap|clearance|restraint)/i, cat: "Seismic" },
  ...acou.strong,
  { re: /\bcavity|building wrap|rigid air barrier|\brab\b|flashing|weather ?(?:tight|proof)|\bcladding\b|membrane|saddle|upstand|apron|brick (?:rebate|veneer|tie)|capillary gap|deck\/?balcony|threshold step|roof(?:ing)? (?:underlay|junction|penetration)|soffit|spouting|gutter|downpipe|tanking|waterproof|damp ?proof|\bdpc\b|joinery.*(?:tape|air seal)|window (?:flashing|seal)|vermin proof|drainage enabled|wrap (?:restraint|lapped|returned)/i, cat: "Weathertightness / Cladding" },
  { re: acou.plumb, cat: "Plumbing & Drainage" },
  { re: /\belectric(?:al|ity)?\b|flush box|switchboard|distribution board|\bcable(?:s|way|tray)?\b|conduit|earth(?:ing|ed|bond)|\bsocket|luminaire|light fitting|\blighting\b|power (?:outlet|supply|point)|\bcomms?\b|data (?:cabling|outlet)|\bmeter box/i, cat: "Electrical" },
  { re: /\bhvac\b|mechanical (?:services|plant)|ventilation|\bduct(?:s|work|ing)?\b|extract(?:or|ion)|air ?condition|heat pump|\bfan\b|make-?up air|\bdamper/i, cat: "Mechanical" },
  ...acou.weak,
  { re: /\bframing\b|\bstud(?:s)?\b|\blintel|\bbeam(?:s)?\b|\bbracing\b|\bbrace(?:s|d)?\b|bottom plate|top plate|foundation|\bslab\b|\bfooting|reinforc|\brebar\b|\bpile(?:s|d)?\b|\btruss|portal|point load|diaphragm|structural (?:steel|stability|design)|\bengineer(?:'s)? (?:confirm|approval|review)|moisture content|timber (?:treatment|grade)|\bh1\.2\b|\bsg8\b|notches and holes|bearing|tie ?down|anchor|block ?wall|strapping|pallet racking/i, cat: "Structural" },
  { re: /\bbarrier|balustrade|handrail|\bstair(?:s|case|well)?\b|\bramp\b|accessible|\bf4\b|restrictor|opening.*(?:100 ?mm|1 ?m wide)|door width|landing|nosing|riser (?:height|and going)|\bgoing\b|clear width|wheelchair|access hatch|\bd1\b/i, cat: "Access & Barriers" },

  { re: /\blining(?:s)?\b|\bgib\b|plasterboard|\bwet area|shower|\btile(?:s|d|ing)?\b|insulation|\br-?value|ceiling|stopp(?:ed|ing)|floor covering|slip resistance|manifestation|safety glass|\bglazing\b|impervious|coved|vanity|\bbasin\b|kitchen|laundry|\bsheet (?:fixing|edge|lining)|back ?block|building interior|\bnzs ?2208/i, cat: "Interior / Linings" },
  { re: /\bsite safety|excavat|retaining|\bfenc(?:e|ing)|driveway|paving|ground (?:level|clearance)|erosion|sediment|\bsite (?:tidy|access)|boundary|landscap|stormwater (?:detention|soak)/i, cat: "Site / External" },
  { re: /\barchitect|as per (?:the )?architectural|setout|set-?out|\bfinish(?:es)? schedule|colour|aesthetic|\bdetail \d|non-?conformance with (?:the )?drawings/i, cat: "Architect" },
]);
const PLUMB_OLD = /\bplumb|drain(?:age|layer|s)?\b|foul water|storm ?water|waste ?water|water supply|\bpipe(?:s|work)?\b|gully|\btrap(?:s|ped)?\b|air admittance|\bhwc\b|hot water|cylinder|tempering valve|\btpr\b|backflow|back flow|non return valve|sanitary|gradient|\bvent(?:s|ing|ed)?\b|tundish|overflow relief|syphon|cesspit|reflux valve|inspection junction|\bmanhole|non-?potable|\bg13\b|\bg12\b|as\/?nzs ?3500/i;
const PLUMB_NEW = /\bplumb|drain(?:age|layer|s)?\b|foul water|storm ?water|waste ?water|water supply|\bpipe(?:s|work)?\b|soil (?:pipe|stack)|waste (?:pipe|stack)|gully|\btrap(?:s|ped)?\b|air admittance|\bhwc\b|hot water|cylinder|tempering valve|\btpr\b|backflow|back flow|non return valve|sanitary|gradient|\bvent(?:s|ing|ed)?\b|tundish|overflow relief|syphon|cesspit|reflux valve|inspection junction|\bmanhole|non-?potable|\bg13\b|\bg12\b|as\/?nzs ?3500/i;
const OLD = base({ strong: [{ re: /\bacoustic|\bstc\b|\biic\b|sound (?:seal|insulation|transmission|rating)|noise (?:level|control)|inter-?tenancy/i, cat: "Acoustic" }], weak: [], plumb: PLUMB_OLD });
const NEW = base({ strong: [{ re: /\bstc\b|\biic\b|sound (?:transmission|rating|insulation|seal(?:s|ant|ed)?)|noise (?:level|control|criteria)|acoustic (?:report|design|engineer|consultant|separation|rating|performance|test|system|rail|treatment)|\binter-?tenancy\b/i, cat: "Acoustic", unless: SERVICES_SUBJECT }], weak: [{ re: /\bacoustic|\bsound (?:seal|insulation)/i, cat: "Acoustic" }], plumb: PLUMB_NEW });
const run = (rules, t) => { for (const r of rules) { if (!r.re.test(t)) continue; if (r.unless && r.unless.test(t)) continue; return r.cat; } return null; };

const root = "C:/Users/adam/Desktop/Soterra Github/Soterra/All inspection reports";
const lines = new Set();
for (const d of await fs.readdir(root, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of await fs.readdir(path.join(root, d.name))) {
    if (!f.toLowerCase().endsWith(".pdf")) continue;
    let text = "";
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(path.join(root, d.name, f))));
      text = String((await extractText(pdf, { mergePages: true })).text).replace(/\s+/g, " ");
    } catch { continue; }
    // council checklist lines end in a verdict token
    for (const m of text.matchAll(/([A-Z][^.]{8,120}?)\s+(?:Pass|Fail|N\/A|Partial)\b/g)) lines.add(m[1].trim());
    // consultant numbered items
    for (const m of text.matchAll(/\d+\.\s+(?:\d{2}\/\d{2}\/\d{4}\s+)?([A-Z][^.]{10,160}\.)/g)) lines.add(m[1].trim());
  }
}
const arr = [...lines];
let diffs = 0;
const shift = {};
for (const t of arr) {
  const a = run(OLD, t), b = run(NEW, t);
  if (a !== b) { diffs++; const k = `${a} -> ${b}`; (shift[k] ||= []).push(t); }
}
console.log(`lines scanned: ${arr.length}   changed: ${diffs}\n`);
for (const [k, v] of Object.entries(shift).sort((x, y) => y[1].length - x[1].length)) {
  console.log(`### ${k}   (${v.length})`);
  for (const t of v.slice(0, 8)) console.log("   " + t.slice(0, 140));
}
