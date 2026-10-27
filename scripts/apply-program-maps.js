#!/usr/bin/env node
/* Reads the official Ontario Tech program-map PDFs and writes each program's own
 * semester for every course into the built-in data (the `semesters` map). Nothing else
 * in the data changes: names, requirements, notes and program lists stay as they are.
 *
 *   npm i --no-save pdfjs-dist@4.10.38
 *   node scripts/apply-program-maps.js <folder of PDFs> [--dry-run]
 *   node scripts/build-data.js
 *
 * Each PDF's title (e.g. "Mechatronics Engineering 2026-2027") must name one of the
 * built-in programs. The report lists every semester that changed, and anything that
 * doesn't line up (courses a map lists that aren't in the data, or the other way round)
 * so it can be checked by hand. */
"use strict";
const fs = require("fs");
const path = require("path");
const PF = require("../js/parser.js");

const DATA = path.join(__dirname, "..", "data", "ontario-tech-engineering-2026-2027.json");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const dir = args.find(a => !a.startsWith("--"));
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/apply-program-maps.js <folder of program-map PDFs> [--dry-run]");
  process.exit(1);
}

const mat = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// one PDF → { title, cells: [{ semester, text }] }, the same way the page reads them
async function readMap(lib, file) {
  const doc = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  let title = "";
  const cells = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const items = [];
    for (const it of (await page.getTextContent()).items) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const t = mat(vp.transform, it.transform);
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) });
    }
    const tb = PF.extractTable(items);
    if (!title && tb.title) title = tb.title;
    if (tb.tableFound) cells.push(...tb.cells);
  }
  await doc.destroy();
  return { title: PF.cleanTitle(title), cells };
}

(async () => {
  let lib;
  try { lib = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
  catch (e) { console.error("pdf.js isn't installed: npm i --no-save pdfjs-dist@4.10.38"); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const byCode = new Map(data.courses.map(c => [c.code, c]));
  const progByName = new Map(data.programs.map(p => [norm(p), p]));
  const found = new Map(); // program → Map(code → [semesters])
  const problems = [];

  const pdfs = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort();
  if (!pdfs.length) { console.error(`no PDFs in ${dir}`); process.exit(1); }
  for (const f of pdfs) {
    const { title, cells } = await readMap(lib, path.join(dir, f));
    const program = progByName.get(norm(title)) || progByName.get(norm(PF.programFromFilename(f)));
    if (!program) { problems.push(`${f}: title "${title}" doesn't name a built-in program; skipped`); continue; }
    if (found.has(program)) { problems.push(`${f}: ${program} was already read from another file; skipped`); continue; }
    if (!cells.length) { problems.push(`${f}: no program-map table found; skipped`); continue; }
    const m = new Map();
    for (const cell of cells) {
      const p = PF.parseCourseText(cell.text);
      if (!p || p.kind !== "course") continue;
      if (!m.has(p.code)) m.set(p.code, []);
      m.get(p.code).push(cell.semester);
    }
    found.set(program, m);
    console.log(`${f} → ${program}: ${m.size} courses`);
  }

  // write each program's semester; a program that lists a course twice keeps the earliest
  const changes = [];
  for (const [program, m] of found) {
    for (const [code, sems] of m) {
      const c = byCode.get(code);
      if (!c) { problems.push(`${program}: ${code} is on the map but not in the data`); continue; }
      if (!c.programs.includes(program)) { problems.push(`${program}: ${code} is on the map but the data doesn't list it for this program`); continue; }
      if (new Set(sems).size > 1) problems.push(`${program}: ${code} is listed in ${sems.map(PF.semesterLabel).join(" and ")}; the earliest is used`);
      const sem = Math.min(...sems);
      const all = PF.programSemesters(c);
      if (all[program] !== sem) changes.push(`${code} in ${program}: ${PF.semesterLabel(all[program])} → ${PF.semesterLabel(sem)}`);
      all[program] = sem;
      c.semesters = all;
    }
    for (const c of data.courses) {
      if (c.programs.includes(program) && !m.has(c.code)) problems.push(`${program}: the data lists ${c.code} but the map doesn't`);
    }
  }
  // tidy: the fallback is the earliest; a course taken in the same semester everywhere needs no map
  for (const c of data.courses) {
    if (!c.semesters) continue;
    const vals = c.programs.map(p => c.semesters[p]).filter(Boolean);
    c.semester = Math.min(...vals);
    c.term = PF.semesterLabel(c.semester);
    if (new Set(vals).size <= 1 && vals.length === c.programs.length) delete c.semesters;
    else c.semesters = Object.fromEntries(c.programs.filter(p => c.semesters[p]).map(p => [p, c.semesters[p]]));
  }

  console.log(`\n${changes.length} semester${changes.length === 1 ? "" : "s"} changed`);
  for (const x of changes) console.log("  " + x);
  if (problems.length) { console.log(`\n${problems.length} to check by hand`); for (const x of problems) console.log("  " + x); }
  const missing = data.programs.filter(p => !found.has(p));
  if (missing.length) console.log(`\nNo map read for: ${missing.join("; ")}`);

  if (dry) { console.log("\n--dry-run: nothing written"); return; }
  // keep the key order of the file: semesters sits right after term
  const out = data.courses.map(c => {
    const o = {};
    for (const [k, v] of Object.entries(c)) { if (k === "semesters") continue; o[k] = v; if (k === "term" && c.semesters) o.semesters = c.semesters; }
    return o;
  });
  fs.writeFileSync(DATA, JSON.stringify({ ...data, courses: out }, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), DATA)}; now run: node scripts/build-data.js`);
})().catch(e => { console.error(e); process.exit(1); });
