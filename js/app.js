/* PrereqFlow page: state, import, chart rendering, zoom, highlights, planning and exports.
 * Depends on PF (parser.js), PFLayout (layout.js), PFPlan (plan.js), PFImage (image.js)
 * and the built-in data set (window.PREREQFLOW_DEFAULT). */
(() => {
"use strict";

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cmpCode = (a, b) => a.localeCompare(b, "en", { numeric: true });
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const semLabel = s => PF.semesterLabel(s);
const semLong = s => { const y = Math.ceil(s / 2), t = s - (y - 1) * 2; return `Year ${y} · Semester ${t}`; };
const clampSem = s => Math.max(1, Math.min(16, Math.round(+s) || 1));
const shortProg = p => String(p).replace(/\s+(?:19|20)\d{2}\s*[-–]\s*(?:19|20)?\d{2}$/, "");
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isNarrow = () => window.matchMedia("(max-width: 860px)").matches;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let uidN = 0;
const uid = () => `r${++uidN}`;

// ───────────────────────── state ─────────────────────────
const STORE_KEY = "prereqflow.session.v2";
const THEME_KEY = "prereqflow.theme";
const MANUAL = "__manual__";
const DIRS = { pre: "prereqs", post: "unlocks", both: "both" };
const N_HL = 6;
const DEFAULT = window.PREREQFLOW_DEFAULT || null;
const state = {
  courses: new Map(), programs: [], semCount: 8, filter: "", query: "",
  hovered: null, selected: null,
  mode: "semester", highlights: [], dimOthers: true,
};

function snapshot() {
  return JSON.stringify({
    semCount: state.semCount, programs: state.programs, courses: [...state.courses.values()],
    mode: state.mode, highlights: state.highlights, dimOthers: state.dimOthers, filter: state.filter,
  });
}
function loadSnapshot(json) {
  const o = typeof json === "string" ? JSON.parse(json) : json;
  state.courses = new Map((o.courses || []).map(c => { const n = normalizeCourse(c); return [n.code, n]; }));
  state.programs = Array.isArray(o.programs) ? o.programs.slice() : [];
  state.semCount = [4, 6, 8, 10, 12].includes(+o.semCount) ? +o.semCount : 8;
  if (o.mode === "free" || o.mode === "semester") state.mode = o.mode;
  state.highlights = Array.isArray(o.highlights)
    ? o.highlights.filter(h => h && state.courses.has(h.code) && DIRS[h.dir]).map(h => ({ code: h.code, dir: h.dir, color: ((+h.color || 0) % N_HL + N_HL) % N_HL }))
    : [];
  if (typeof o.dimOthers === "boolean") state.dimOthers = o.dimOthers;
  if (typeof o.filter === "string") state.filter = o.filter;
  if (state.filter && state.filter !== MANUAL && !state.programs.includes(state.filter)) state.filter = "";
  if (state.selected && !state.courses.has(state.selected)) state.selected = null;
  state.hovered = null;
}
function persist() {
  try {
    if (state.courses.size) localStorage.setItem(STORE_KEY, JSON.stringify({ savedAt: Date.now(), data: JSON.parse(snapshot()) }));
    else localStorage.removeItem(STORE_KEY);
  } catch (e) { /* storage unavailable: the session just won't be remembered */ }
}
function readSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.data && Array.isArray(o.data.courses) && o.data.courses.length ? o : null;
  } catch (e) { return null; }
}

// Plan mode: completed courses and goal courses. Kept apart from the sheet, so it
// survives switching programs, reloading the built-in maps and turning plan mode off.
// A course is completed everywhere it appears, whichever program is shown.
const PLAN_KEY = "prereqflow.plan.v1";
const BRUSHES = ["done", "goal", "pin"];
const plan = { on: false, brush: "done", panel: true, completed: new Set(), goals: [] };
function loadPlan() {
  try {
    const o = JSON.parse(localStorage.getItem(PLAN_KEY) || "null");
    if (!o) return;
    plan.on = !!o.on;
    if (BRUSHES.includes(o.brush)) plan.brush = o.brush;
    if (typeof o.panel === "boolean") plan.panel = o.panel;
    plan.completed = new Set((Array.isArray(o.completed) ? o.completed : []).map(PF.normCode).filter(Boolean));
    plan.goals = [...new Set((Array.isArray(o.goals) ? o.goals : []).map(PF.normCode).filter(Boolean))];
  } catch (e) { /* storage unavailable or unreadable: start with an empty plan */ }
}
function savePlan() {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify({ on: plan.on, brush: plan.brush, panel: plan.panel, completed: [...plan.completed].sort(cmpCode), goals: plan.goals }));
  } catch (e) { /* storage unavailable: the plan just won't be remembered */ }
}
loadPlan();

function toGroups(v) {
  if (!v) return [];
  if (typeof v === "string") { const r = PF.parseRequirementText(v); return [...r.prereqs, ...r.coreqs]; }
  if (!Array.isArray(v)) return [];
  return v.flatMap(x => {
    if (Array.isArray(x)) { const g = x.map(PF.normCode).filter(Boolean); return g.length ? [g] : []; }
    const r = PF.parseRequirementText(String(x));
    return [...r.prereqs, ...r.coreqs];
  });
}
function normalizeCourse(c) {
  const code = PF.normCode(c.code);
  let sem = c.semester;
  if (typeof sem === "string") sem = PF.parseSemesterLabel(sem) || parseInt(sem, 10);
  return {
    code,
    name: String(c.name || "").trim() || code,
    semester: clampSem(sem || PF.semesterFromCode(code)),
    prereqs: PF.dedupeGroups(toGroups(c.prereqs)),
    coreqs: PF.dedupeGroups(toGroups(c.coreqs)),
    notes: Array.isArray(c.notes) ? c.notes.map(String) : [],
    ignored: Array.isArray(c.ignored) ? c.ignored.map(String) : [],
    programs: Array.isArray(c.programs) ? c.programs.map(String) : [],
  };
}

// ───────────────────────── PDF reading (pdf.js, loaded on first use) ─────────────────────────
// Only the Ontario Tech program-map table layout is understood. Every current map is built
// in, so PDF import is switched off; the reader stays for parsing future years' maps
// (set PDF_IMPORT to true to offer it in the file picker again).
const PDF_IMPORT = false;
const PDFJS_SOURCES = [
  { lib: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs", worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs" },
  { lib: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs", worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs" },
];
const TINY_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF";
const PDF_OPTS = { isEvalSupported: false, disableFontFace: true, verbosity: 0 };
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      for (const src of PDFJS_SOURCES) {
        try {
          const lib = await import(src.lib);
          lib.GlobalWorkerOptions.workerSrc = src.worker;
          const task = lib.getDocument({ ...PDF_OPTS, data: new TextEncoder().encode(TINY_PDF) });
          const probe = await task.promise;
          if (!probe.numPages) throw new Error("PDF reader self-test failed");
          await task.destroy();
          return lib;
        } catch (e) { console.warn("PDF reader source failed", src.lib, e); }
      }
      throw new Error("The PDF reader couldn't load (it needs cdn.jsdelivr.net or cdnjs.cloudflare.com). Paste the course lines into Line input instead.");
    })();
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}
const mat = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

async function readPdf(file) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ ...PDF_OPTS, data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    let title = "";
    const cells = [], loose = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        const t = mat(vp.transform, it.transform);
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) });
      }
      const tb = PF.extractTable(items);
      if (!title && tb.title) title = tb.title;
      if (tb.tableFound) cells.push(...tb.cells);
      else if (tb.lines.length) loose.push(PF.linesToText(tb.lines));
      if (page.cleanup) page.cleanup();
    }
    const program = PF.cleanTitle(title) || PF.programFromFilename(file.name);
    if (cells.length) return fromCells(cells, program, file.name);
    if (loose.length) return fromText(loose.join("\n"), program, file.name, "PDF text");
    throw new Error("No text found. Only Ontario Tech program maps parse directly; paste other course lists into Line input.");
  } finally {
    task.destroy();
  }
}

// ───────────────────────── records from each source ─────────────────────────
function newReport(name, program, mode) {
  return { name, program, mode, courses: 0, electives: [], other: [], restrictions: 0, notes: [], alts: 0, coreqs: 0, guessed: 0, error: "" };
}
function tally(rep, p) {
  rep.restrictions += p.ignored.length;
  rep.alts += p.prereqs.filter(g => g.length > 1).length + p.coreqs.filter(g => g.length > 1).length;
  rep.coreqs += p.coreqs.length;
  for (const n of p.notes) rep.notes.push(`${p.code}: ${n}`);
}
function fromCells(cells, program, fileName) {
  const rep = newReport(fileName, program, "PDF table");
  const records = [];
  for (const c of cells) {
    const p = PF.parseCourseText(c.text);
    if (!p) continue;
    if (p.kind === "course") { records.push(PF.mkCourse(p, c.semester, program)); tally(rep, p); }
    else if (p.kind === "elective") rep.electives.push(c.text);
    else rep.other.push(c.text);
  }
  rep.courses = records.length;
  return { records, programs: [program], report: rep };
}
function fromText(text, program, fileName, mode = "Text") {
  const rep = newReport(fileName, program, mode);
  const records = [];
  for (const e of PF.splitEntries(text)) {
    if (e.kind !== "course") { (e.kind === "elective" ? rep.electives : rep.other).push(e.text); continue; }
    const p = PF.parseCourseText(e.text);
    if (!p || p.kind !== "course") { rep.other.push(e.text); continue; }
    let sem = e.semester;
    if (!sem) { sem = PF.semesterFromCode(p.code); rep.guessed++; }
    records.push(PF.mkCourse(p, clampSem(sem), program));
    tally(rep, p);
  }
  rep.courses = records.length;
  return { records, programs: program ? [program] : [], report: rep };
}
function fromJson(text, fileName) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error("This file isn't valid JSON."); }
  const list = Array.isArray(o) ? o : (o && Array.isArray(o.courses) ? o.courses : null);
  if (!list) throw new Error('No course list found. Expected a list of courses, or an object with a "courses" list.');
  const records = list.filter(c => c && c.code).map(normalizeCourse);
  const rep = newReport(fileName, o && o.format === "prereqflow" ? "PrereqFlow export" : PF.programFromFilename(fileName), "JSON");
  rep.courses = records.length;
  for (const r of records) { rep.restrictions += r.ignored.length; rep.coreqs += r.coreqs.length; rep.alts += [...r.prereqs, ...r.coreqs].filter(g => g.length > 1).length; }
  const programs = (o && Array.isArray(o.programs)) ? o.programs.map(String) : [...new Set(records.flatMap(r => r.programs))];
  const p = o && o.plan;
  const planIn = p && (Array.isArray(p.completed) || Array.isArray(p.goals))
    ? { completed: (p.completed || []).map(PF.normCode).filter(Boolean), goals: (p.goals || []).map(PF.normCode).filter(Boolean) } : null;
  return { records, programs, report: rep, semCount: o && +o.semesters, plan: planIn };
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function fromCsv(text, fileName) {
  const rows = parseCSV(text.replace(/^﻿/, ""));
  if (!rows.length) throw new Error("This CSV is empty.");
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iCode = col("code", "course code", "course");
  if (iCode < 0) return fromText(rows.map(r => r.join(" ")).join("\n"), PF.programFromFilename(fileName), fileName, "CSV");
  const iName = col("name", "course name", "title"), iSem = col("semester", "sem", "semester number"), iYT = col("year-semester", "year-term", "term", "term label");
  const iPre = col("prerequisites", "prerequisite", "prereqs", "prereq", "requires"), iCo = col("corequisites", "corequisite", "coreqs", "coreq");
  const iNotes = col("notes", "note"), iIgn = col("ignored", "ignored text"), iProg = col("programs", "program");
  const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
  const splitList = s => s ? s.split(/\s*[;|]\s*/).filter(Boolean) : [];
  const records = [];
  for (const r of rows.slice(1)) {
    const code = get(r, iCode);
    if (!code) continue;
    const pre = PF.parseRequirementText(get(r, iPre)), co = PF.parseRequirementText(get(r, iCo));
    records.push(normalizeCourse({
      code, name: get(r, iName), semester: get(r, iSem) || get(r, iYT),
      prereqs: [...pre.prereqs], coreqs: [...pre.coreqs, ...co.prereqs, ...co.coreqs],
      notes: [...splitList(get(r, iNotes)), ...pre.notes], ignored: [...splitList(get(r, iIgn)), ...pre.ignored],
      programs: splitList(get(r, iProg)),
    }));
  }
  const rep = newReport(fileName, PF.programFromFilename(fileName), "CSV");
  rep.courses = records.length;
  return { records, programs: [...new Set(records.flatMap(c => c.programs))], report: rep };
}

async function readFile(file) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") {
    if (PDF_IMPORT) return readPdf(file);
    throw new Error("PDFs aren't imported: every Ontario Tech engineering program map is already built in. Load a .json, .csv or .txt, or paste course lines into Line input.");
  }
  const text = await file.text();
  if (ext === "json" || /^\s*[\[{]/.test(text)) return fromJson(text, file.name);
  if (ext === "csv") return fromCsv(text, file.name);
  const own = /^\s*#\s*PrereqFlow/i.test(text);
  return fromText(text, own ? "" : PF.programFromFilename(file.name), file.name, "Text");
}

// ───────────────────────── merging + report ─────────────────────────
let lastUndo = null;
let replaceOnImport = false; // set by the start screen: the next import replaces the sheet
function clearSheet() {
  state.courses.clear(); state.programs = []; state.selected = state.hovered = null;
  state.filter = ""; state.query = ""; state.highlights = [];
  $("#search").value = "";
}
function mergeBatches(batches) {
  const before = snapshot();
  if (replaceOnImport) { clearSheet(); replaceOnImport = false; }
  const sizeBefore = state.courses.size;
  // semester observations, to report conflicts (earliest wins)
  const seen = new Map();
  const note = (code, sem, label) => {
    if (!seen.has(code)) seen.set(code, new Map());
    const m = seen.get(code);
    if (!m.has(sem)) m.set(sem, new Set());
    m.get(sem).add(label);
  };
  for (const b of batches) for (const r of b.records) {
    const code = PF.normCode(r.code), ex = state.courses.get(code);
    if (ex && !seen.has(code)) note(code, ex.semester, "already loaded");
  }
  for (const b of batches) for (const r of b.records) note(PF.normCode(r.code), r.semester, (r.programs && r.programs[0]) || b.label || "pasted text");

  for (const b of batches) {
    PF.mergeInto(state.courses, b.records);
    for (const p of b.programs || []) if (p && !state.programs.includes(p)) state.programs.push(p);
    if (b.semCount && [4, 6, 8, 10, 12].includes(b.semCount)) state.semCount = Math.max(state.semCount, b.semCount);
  }
  const fixes = PF.resolveCodes(state.courses);
  const maxSem = Math.max(0, ...[...state.courses.values()].map(c => c.semester));
  if (maxSem > state.semCount) state.semCount = [4, 6, 8, 10, 12].find(n => n >= maxSem) || 12;

  const conflicts = [];
  for (const [code, m] of seen) {
    if (m.size < 2) continue;
    const sems = [...m.keys()].sort((a, b) => a - b);
    conflicts.push({ code, kept: sems[0], all: sems.map(s => ({ sem: s, from: [...m.get(s)] })) });
  }
  conflicts.sort((a, b) => cmpCode(a.code, b.code));
  const incomingCodes = new Set(batches.flatMap(b => b.records.map(r => PF.normCode(r.code))));
  const missing = new Map();
  for (const code of incomingCodes) {
    const c = state.courses.get(code);
    if (!c) continue;
    for (const g of [...c.prereqs, ...c.coreqs]) for (const p of g) if (!state.courses.has(p)) {
      if (!missing.has(p)) missing.set(p, new Set());
      missing.get(p).add(code);
    }
  }
  const fixMap = new Map(fixes.map(([a, b]) => [a, b]));
  lastUndo = before;
  persist();
  return { added: state.courses.size - sizeBefore, total: state.courses.size, conflicts, fixes: [...fixMap], missing };
}

function showReport(reports, result, title) {
  const body = $("#reportBody");
  const ok = reports.filter(r => !r.error);
  const rows = reports.map(r => r.error
    ? `<tr><td>${esc(r.program || r.name)}<div class="muted">${esc(r.name)}</div></td><td colspan="4" class="err">${esc(r.error)}</td></tr>`
    : `<tr><td>${esc(r.program || "Line input")}${r.name && r.name !== r.program ? `<div class="muted">${esc(r.name)} · ${esc(r.mode)}</div>` : ""}</td>
        <td class="num sd-num">${r.courses}</td><td class="num sd-num">${r.alts}</td><td class="num sd-num">${r.coreqs}</td>
        <td class="num sd-num">${r.electives.length + r.restrictions}</td></tr>`).join("");
  let html = `<p class="rsum"><b>${plural(result.total, "course")}</b> loaded`
    + (result.added ? `, ${result.added} new` : "") + ` from ${plural(ok.length, "source")}.`
    + (result.conflicts.length ? ` ${plural(result.conflicts.length, "course")} appeared in more than one semester; the earliest was kept.` : "") + `</p>`;
  html += `<div class="rtable-wrap"><table class="rtable sd-table"><thead><tr><th>Source</th><th class="num sd-num">Courses</th><th class="num sd-num">Either/or</th><th class="num sd-num">Coreqs</th><th class="num sd-num">Skipped</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  html += `<p class="help mt">Skipped counts elective slots and credit-restriction notes, which aren't prerequisites.</p>`;
  if (result.conflicts.length) {
    html += `<div class="rsec"><h3>Semester conflicts · earliest kept</h3><ul>${result.conflicts.map(c =>
      `<li>${esc(c.code)} → <b>${semLabel(c.kept)}</b> <span class="muted">(${esc(trimList(c.all[0].from))})</span>; also listed in ${c.all.slice(1).map(a => `${semLabel(a.sem)} <span class="muted">(${esc(trimList(a.from))})</span>`).join(", ")}</li>`).join("")}</ul></div>`;
  }
  if (result.fixes.length) {
    html += `<div class="rsec"><h3>Corrected codes</h3><ul>${result.fixes.map(([a, b]) => `<li>${esc(a)} → ${esc(b)} <span class="muted">(missing suffix in the source)</span></li>`).join("")}</ul></div>`;
  }
  if (result.missing.size) {
    const items = [...result.missing].sort((a, b) => cmpCode(a[0], b[0]));
    html += `<div class="rsec"><h3>Required but not loaded · ${items.length}</h3><ul>${items.map(([code, by]) => `<li>${esc(code)} <span class="muted">needed by ${esc([...by].sort(cmpCode).join(", "))}</span></li>`).join("")}</ul></div>`;
  }
  const notes = ok.flatMap(r => r.notes);
  if (notes.length) html += `<div class="rsec"><h3>Requirements kept as notes (no course code)</h3><ul>${[...new Set(notes)].slice(0, 30).map(n => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
  const guessed = ok.reduce((n, r) => n + r.guessed, 0);
  if (guessed) html += `<div class="rsec"><h3>No semester given</h3><ul><li>${plural(guessed, "course")} placed by course level (1000-level → 1-1, 2000-level → 2-1, …). Double-click a course to move it, or switch to Free flow, which ignores semesters.</li></ul></div>`;
  const other = [...new Set(ok.flatMap(r => r.other))];
  if (other.length) html += `<div class="rsec"><h3>Text that wasn't a course</h3><ul>${other.slice(0, 20).map(t => `<li>${esc(t)}</li>`).join("")}${other.length > 20 ? `<li class="muted">…and ${other.length - 20} more</li>` : ""}</ul></div>`;
  body.innerHTML = html;
  $("#reportTitle").textContent = title || "Import summary";
  $("#btnUndoImport").hidden = !lastUndo;
  openDialog("#reportDlg");
}
function trimList(arr) {
  const a = arr.map(shortProg);
  return a.length > 2 ? `${a.slice(0, 2).join("; ")} +${a.length - 2} more` : a.join("; ");
}

async function importFiles(fileList) {
  const files = [...fileList].filter(Boolean);
  if (!files.length) return;
  closeDialog("#importDlg");
  closeDialog("#welcomeDlg");
  showToast(`<span class="spin"></span>Reading ${plural(files.length, "file")}…`, 0);
  const batches = [], reports = [];
  for (const [i, f] of files.entries()) {
    if (files.length > 1) showToast(`<span class="spin"></span>Reading ${i + 1} of ${files.length}: ${esc(f.name)}`, 0);
    try {
      const res = await readFile(f);
      batches.push({ records: res.records, programs: res.programs, label: res.report.program || f.name, semCount: res.semCount, plan: res.plan });
      reports.push(res.report);
    } catch (e) {
      const r = newReport(f.name, PF.programFromFilename(f.name), "");
      r.error = (e && e.message) || String(e);
      reports.push(r);
    }
  }
  hideToast();
  if (!batches.some(b => b.records.length)) {
    lastUndo = null;
    showReport(reports, { added: 0, total: state.courses.size, conflicts: [], fixes: [], missing: new Map() }, "Nothing imported");
    render();
    return;
  }
  const result = mergeBatches(batches);
  // a PrereqFlow JSON export carries its plan: add it to the one already here
  const planned = batches.filter(b => b.plan);
  if (planned.length) {
    for (const b of planned) {
      for (const c of b.plan.completed) plan.completed.add(c);
      for (const g of b.plan.goals) if (!plan.goals.includes(g)) plan.goals.push(g);
    }
    planCache = null;
    savePlan();
  }
  render();
  fitAll(false);
  showReport(reports, result);
}

// ───────────────────────── layout + chart ─────────────────────────
let view = null;
let cardEls = new Map(), edgeEls = [];
let zoom = 1;
const Z = { min: 0.12, max: 3 };

function visibleCourses() {
  const all = [...state.courses.values()];
  if (!state.filter) return all;
  if (state.filter === MANUAL) return all.filter(c => !c.programs.length);
  return all.filter(c => c.programs.includes(state.filter));
}

// requirements written as notes (see plan.js) that the layout draws: Capstone's years 1–3
const withRules = c => { const y = PFPlan.rules(c).yearsComplete; return y ? { ...c, yearsComplete: y } : c; };
function computeView(courses = visibleCourses(), opts = {}) {
  const lay = PFLayout.compute(courses.map(withRules), { mode: state.mode, semCount: opts.semCount || state.semCount });
  lay.visible = courses;
  return lay;
}

// column header text for both layouts
function columnLabels(lay) {
  const out = [];
  for (let k = 0; k < lay.nCols; k++) {
    if (lay.mode === "semester") {
      const y = Math.floor(k / 2) + 1, t = k % 2 + 1;
      out.push({ main: `${y}-${t}`, sub: `sem ${t}`, n: lay.cols[k].length, band: `Year ${y}`, bandStart: k % 2 === 0 });
    } else {
      out.push({ main: `T${k + 1}`, sub: k === 0 ? "tier · entry" : "tier", n: lay.cols[k].length });
    }
  }
  return out;
}

function markerDefs() {
  const ids = ["ah", "ah-n", "ah-u", "ah-d", "ah-b", ...Array.from({ length: N_HL }, (_, i) => `ah-h${i}`)];
  return ids.map(id => `<marker id="${id}" class="ah" viewBox="0 0 8 8" refX="7.6" refY="4" markerWidth="${id === "ah" || id === "ah-d" ? 7 : 8}" markerHeight="${id === "ah" || id === "ah-d" ? 7 : 8}" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.8 L8,4 L0,7.2 z"/></marker>`).join("");
}

// a stable pseudo-random number per course, so each card drifts on its own rhythm
function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const motionOn = () => document.documentElement.dataset.motion !== "off" && !reduceMotion; // reduced motion holds the sheet still

// ── ambient float ──
// Every card bobs on a slow wave that ripples across the sheet, plus a small wobble
// of its own. Cards run as compositor animations pinned to the document clock; link
// ends read the same clock and ride along with their cards, so nothing comes loose.
// To stay light, only cards near the visible area animate, and when zoomed far out
// (where the float is about a pixel on screen) link ends stop following.
const FLOAT_MS = 11000;  // one full cycle; every component is a whole-number harmonic of it
const FLOAT_STEPS = 48;
const LINKS_FOLLOW_ZOOM = 0.42;
let floatParams = new Map(), edgeGeo = [], floatAnims = new Map(), floatAmp = 0;
let floatTimer = 0, floatOn = false, zoomChangedAt = 0, linksMoved = false, cullTimer = 0;
function prepareFloat() {
  floatParams = new Map();
  for (const n of view.nodes.values()) {
    const h = hashCode(n.code);
    floatParams.set(n.code, {
      wave: n.x * 0.0042 + n.y * 0.0021,                 // shared wave: neighbours move together
      k1: 2 + (h % 2), k2: 1 + ((h >>> 3) % 2),           // per-card wobble harmonics
      p1: ((h >>> 5) % 628) / 100, p2: ((h >>> 13) % 628) / 100,
    });
  }
  // split each path into literal text and numbers; the first two points belong to the
  // source card's end, the last two to the target card's end
  edgeGeo = view.edges.map(e => {
    const parts = e.d.split(/(-?\d+(?:\.\d+)?)/);
    const nums = [];
    for (let i = 1; i < parts.length; i += 2) nums.push(+parts[i]);
    return { parts, nums, from: e.from, to: e.to };
  });
}
// offset of a card at cycle position u ∈ [0, 1)
function floatAt(f, u, amp) {
  const a = 2 * Math.PI * u;
  return [amp * 0.35 * Math.sin(a * f.k2 + f.p2), amp * (0.65 * Math.sin(a - f.wave) + 0.35 * Math.sin(a * f.k1 + f.p1))];
}
// a touch more travel when zoomed out, so the sheet never looks frozen
const wantedAmp = () => Math.min(7, 3.4 / Math.sqrt(Math.max(zoom, 0.15))) * (reduceMotion ? 0.5 : 1);
function floatCard(code, el) {
  const f = floatParams.get(code);
  if (!f) return;
  const frames = [];
  for (let i = 0; i <= FLOAT_STEPS; i++) {
    const [dx, dy] = floatAt(f, i / FLOAT_STEPS, floatAmp);
    frames.push({ transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)` });
  }
  const anim = el.animate(frames, { duration: FLOAT_MS, iterations: Infinity, easing: "linear" });
  anim.startTime = 0; // every card on the same clock as the link ends
  floatAnims.set(code, anim);
  el.classList.add("fl");
}
// animate the cards in (or near) the visible part of the sheet, and only those
function cullFloat(rebuild = false) {
  if (!floatOn || !view) return;
  if (rebuild) { stopCardFloat(); floatAmp = wantedAmp(); }
  const vpEl = $("#viewport");
  const m = 0.12; // a little margin on every side
  const x0 = (vpEl.scrollLeft - m * vpEl.clientWidth) / zoom, x1 = (vpEl.scrollLeft + (1 + m) * vpEl.clientWidth) / zoom;
  const y0 = (vpEl.scrollTop - m * vpEl.clientHeight) / zoom, y1 = (vpEl.scrollTop + (1 + m) * vpEl.clientHeight) / zoom;
  for (const [code, el] of cardEls) {
    const n = view.nodes.get(code);
    const near = n && n.x + n.w > x0 && n.x < x1 && n.y + n.h > y0 && n.y < y1;
    if (near && !floatAnims.has(code)) floatCard(code, el);
    else if (!near && floatAnims.has(code)) { floatAnims.get(code).cancel(); floatAnims.delete(code); el.classList.remove("fl"); }
  }
}
function scheduleCull() { clearTimeout(cullTimer); cullTimer = setTimeout(() => cullFloat(), 120); }
function stopCardFloat() {
  for (const a of floatAnims.values()) a.cancel();
  floatAnims.clear();
  for (const el of cardEls.values()) el.classList.remove("fl");
}
function movedPath(g, off) {
  const a = off.get(g.from) || [0, 0], b = off.get(g.to) || [0, 0];
  const n = g.nums.length, out = g.parts.slice();
  for (let k = 0; k < n; k++) {
    const o = k >= n - 4 ? b : k < 4 ? a : null;
    if (o) out[2 * k + 1] = (g.nums[k] + o[k % 2]).toFixed(1);
  }
  return out.join("");
}
function resetLinks() {
  if (!linksMoved || !view) return;
  linksMoved = false;
  for (const el of edgeEls) el.setAttribute("d", view.edges[+el.dataset.i].d);
  for (const el of $("#edgesFlow").children) el.setAttribute("d", view.edges[+el.dataset.i].d);
}
// A plain timer, not requestAnimationFrame: a rAF loop makes the browser service every
// card animation on the main thread each frame, even on frames where it does nothing.
function floatTick() {
  floatTimer = setTimeout(floatTick, zoom < LINKS_FOLLOW_ZOOM ? 400 : 40);
  const now = performance.now();
  if (!view) return;
  // after zooming settles, retune the travel distance
  if (now - zoomChangedAt > 400 && !zAnim && Math.abs(wantedAmp() - floatAmp) / floatAmp > 0.3) cullFloat(true);
  if (zoom < LINKS_FOLLOW_ZOOM) { resetLinks(); return; }
  const u = ((document.timeline.currentTime || now) % FLOAT_MS) / FLOAT_MS;
  const off = new Map();
  for (const code of floatAnims.keys()) off.set(code, floatAt(floatParams.get(code), u, floatAmp));
  const move = el => {
    const g = edgeGeo[+el.dataset.i];
    if (off.has(g.from) || off.has(g.to)) el.setAttribute("d", movedPath(g, off));
  };
  for (const el of edgeEls) move(el);
  for (const el of $("#edgesFlow").children) move(el);
  linksMoved = true;
}
// (re)start after every chart render, or stop when motion is off / nothing is loaded
function syncFloat() {
  const want = motionOn() && !!view;
  if (want) {
    if (!floatOn) { floatOn = true; floatTimer = setTimeout(floatTick, 0); }
    linksMoved = true; // fresh paths after a render
    cullFloat(true);
  } else if (floatOn || floatAnims.size) {
    floatOn = false;
    clearTimeout(floatTimer);
    stopCardFloat();
    resetLinks();
  }
}

function renderChart() {
  const before = view ? new Map([...view.nodes].map(([c, n]) => [c, { x: n.x, y: n.y }])) : null;
  view = computeView();
  treeCache = null;
  planCache = null;
  const { width, height, nodes, dims: D } = view;
  const world = $("#world");
  world.style.width = width + "px";
  world.style.height = height + "px";

  let z = "";
  for (let k = 0; k < view.nCols; k++) {
    const x = view.colX(k) - D.gutter / 2;
    const major = view.mode === "free" || k % 2 === 0;
    const alt = view.mode === "free" ? k % 2 === 1 : Math.floor(k / 2) % 2 === 1;
    z += `<div class="zone${major ? " major" : ""}${alt ? " alt" : ""}" style="left:${Math.max(0, x)}px;width:${D.colW + D.gutter}px"></div>`;
  }
  $("#zones").innerHTML = z;

  const svg = $("#edges");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const hi = $("#edgesHi");
  hi.innerHTML = "";
  $("#edgesFlow").innerHTML = "";
  flowKey = "";
  $("#edgesBase").innerHTML = view.edges.map((e, i) => {
    const cls = (e.alt ? "alt" : "") + (e.kind === "back" ? " back" : "") + (e.kind === "bus" ? " bus" : "");
    return `<path class="e ${cls}" data-i="${i}" data-base="${cls}" d="${e.d}" marker-end="url(#${e.kind === "back" ? "ah-b" : "ah"})"></path>`;
  }).join("");
  edgeEls = $$("#edgesBase path");

  $("#cards").innerHTML = view.visible.map(c => {
    const p = nodes.get(c.code);
    const h = hashCode(c.code);
    const fresh = !before || !before.has(c.code);
    const drift = `--sd:${(9 + (h % 70) / 10).toFixed(1)}s;--sdl:-${((h >>> 8) % 160) / 10}s${fresh ? `;--in:${Math.min(900, p.col * 55 + (p.y / 76) * 10).toFixed(0)}ms` : ""}`;
    const rq = ruleTag(c);
    return `<button type="button" class="card${fresh ? " rise" : ""}" data-code="${esc(c.code)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;${drift}" aria-label="${esc(`${c.code} ${c.name}, ${semLong(c.semester)}`)}"><span class="code">${esc(c.code)}${rq ? `<i class="rq" title="${esc(rq.title)}">${esc(rq.text)}</i>` : ""}${c.programs.length > 1 ? `<i title="Listed in ${c.programs.length} programs">×${c.programs.length}</i>` : ""}</span><span class="name">${esc(c.name)}</span><span class="pm"></span><span class="marks"></span></button>`;
  }).join("");
  cardEls = new Map($$("#cards .card").map(el => [el.dataset.code, el]));
  // cards that were already on the sheet glide from their old spot; links fade back in
  if (before && motionOn()) {
    let moved = false;
    for (const [code, el] of cardEls) {
      const o = before.get(code), n = nodes.get(code);
      if (!o || (o.x === n.x && o.y === n.y)) continue;
      moved = true;
      el.animate([{ translate: `${o.x - n.x}px ${o.y - n.y}px` }, { translate: "0px 0px" }], { duration: 650, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
    if (moved) {
      svg.classList.add("settling");
      clearTimeout(renderChart.t);
      renderChart.t = setTimeout(() => svg.classList.remove("settling"), 420);
    }
  }
  prepareFloat();
  sizeWorld();
  renderColhead();
  applyHighlight();
  syncPlanbar();
  syncFloat();
}

// the requirements with no links of their own get a small tag on the card
function ruleTag(c) {
  const r = PFPlan.rules(c);
  if (r.yearsComplete) return { text: `Y1–${r.yearsComplete}`, title: `Needs every program course in years 1–${r.yearsComplete}` };
  if (r.minCredits) return { text: `${r.minCredits} cr`, title: `Needs at least ${r.minCredits} credit hours (${Math.ceil(r.minCredits / PFPlan.CREDITS)} courses)` };
  return null;
}

function renderColhead() {
  const head = $("#colhead");
  if (!view) { head.innerHTML = ""; return; }
  const sl = $("#viewport").scrollLeft;
  const D = view.dims;
  const labels = columnLabels(view);
  const compact = D.colW * zoom < 110;
  let h = "";
  if (view.mode === "semester") {
    for (let k = 0; k < view.nCols; k += 2) {
      const x0 = (view.colX(k) - D.gutter / 2) * zoom - sl;
      const w = (Math.min(view.nCols, k + 2) - k) * (D.colW + D.gutter) * zoom;
      h += `<div class="band" style="left:${x0}px;width:${w}px">${compact ? `Y${k / 2 + 1}` : labels[k].band}</div>`;
    }
  }
  labels.forEach((l, k) => {
    const x = view.colX(k) * zoom - sl, w = D.colW * zoom;
    if (x + w < -20 || x > head.clientWidth + 20) return;
    h += `<div class="ch${view.mode === "free" ? " solo" : ""}" style="left:${x}px;width:${w}px"><b>${l.main}</b>${compact ? "" : `<span class="t">${l.sub}</span><span class="n" title="Courses in this column">${l.n}</span>`}</div>`;
  });
  head.innerHTML = h;
}

// ───────────────────────── zoom + pan ─────────────────────────
function drawerInset() {
  const d = $("#details");
  if (d.hidden) return { r: 0, b: 0 };
  return isNarrow() ? { r: 0, b: d.offsetHeight } : { r: d.offsetWidth, b: 0 };
}
function sizeWorld() {
  if (!view) return;
  const ins = drawerInset();
  $("#world").style.transform = `scale(${zoom})`;
  $("#sizer").style.width = Math.ceil(view.width * zoom + ins.r) + "px";
  $("#sizer").style.height = Math.ceil(view.height * zoom + ins.b) + "px";
  $("#zPct").textContent = Math.round(zoom * 100) + "%";
  zoomChangedAt = performance.now();
  scheduleCull();
}
// anchor: point in viewport client coordinates that stays put
function setZoom(z, anchor) {
  if (!view) return;
  const vp = $("#viewport");
  z = Math.max(Z.min, Math.min(Z.max, z));
  const ax = anchor ? anchor.x : vp.clientWidth / 2, ay = anchor ? anchor.y : vp.clientHeight / 2;
  const wx = (vp.scrollLeft + ax) / zoom, wy = (vp.scrollTop + ay) / zoom;
  zoom = z;
  sizeWorld();
  vp.scrollLeft = wx * zoom - ax;
  vp.scrollTop = wy * zoom - ay;
  renderColhead();
}

// Animated zoom. Wheel notches and buttons set a target; each frame closes part of
// the gap, so a burst of wheel events turns into one smooth glide.
let zAnim = null;
function stopAnim() { if (zAnim) cancelAnimationFrame(zAnim.raf); zAnim = null; }
function zoomBy(factor, anchor) {
  if (!view) return;
  if (!motionOn()) { stopAnim(); setZoom(zoom * factor, anchor); return; }
  const target = Math.max(Z.min, Math.min(Z.max, (zAnim && zAnim.kind === "zoom" ? zAnim.target : zoom) * factor));
  if (zAnim && zAnim.kind !== "zoom") stopAnim();
  if (zAnim) { zAnim.target = target; zAnim.anchor = anchor; return; }
  zAnim = { kind: "zoom", target, anchor, raf: 0 };
  const step = () => {
    const a = zAnim;
    if (!a) return;
    const next = zoom * Math.pow(a.target / zoom, 0.24);
    if (Math.abs(a.target - next) / a.target < 0.003) { setZoom(a.target, a.anchor); zAnim = null; return; }
    setZoom(next, a.anchor);
    a.raf = requestAnimationFrame(step);
  };
  zAnim.raf = requestAnimationFrame(step);
}
// Glide the camera: zoom to z1 with world point (wx, wy) at the centre of the visible area.
function flyTo(z1, wx, wy, smooth = true) {
  if (!view) return;
  stopAnim();
  const vp = $("#viewport");
  const ins = drawerInset();
  const vw = Math.max(80, vp.clientWidth - ins.r), vh = Math.max(80, vp.clientHeight - ins.b);
  z1 = Math.max(Z.min, Math.min(Z.max, z1));
  const place = (z, x, y) => { zoom = z; sizeWorld(); vp.scrollLeft = x * z - vw / 2; vp.scrollTop = y * z - vh / 2; renderColhead(); };
  if (!smooth || !motionOn()) { place(z1, wx, wy); return; }
  const z0 = zoom, x0 = (vp.scrollLeft + vw / 2) / zoom, y0 = (vp.scrollTop + vh / 2) / zoom;
  const t0 = performance.now(), dur = 520;
  const ease = t => 1 - Math.pow(1 - t, 3);
  zAnim = { kind: "fly", raf: 0 };
  const step = now => {
    if (!zAnim || zAnim.kind !== "fly") return;
    const t = Math.min(1, (now - t0) / dur), k = ease(t);
    place(z0 * Math.pow(z1 / z0, k), x0 + (wx - x0) * k, y0 + (wy - y0) * k);
    if (t < 1) zAnim.raf = requestAnimationFrame(step); else zAnim = null;
  };
  zAnim.raf = requestAnimationFrame(step);
}
// fit a world-space rectangle into the visible part of the viewport
function fitRect(x0, y0, x1, y1, { maxZ = 1.25, pad = 32, smooth = true } = {}) {
  if (!view) return;
  const vp = $("#viewport");
  const ins = drawerInset();
  const vw = Math.max(80, vp.clientWidth - ins.r), vh = Math.max(80, vp.clientHeight - ins.b);
  const z = Math.max(Z.min, Math.min(maxZ, (vw - 2 * pad) / Math.max(1, x1 - x0), (vh - 2 * pad) / Math.max(1, y1 - y0)));
  // keep the sheet's top-left corner from drifting into view when it is smaller than the screen
  const cx = Math.max((x0 + x1) / 2, vw / 2 / z), cy = Math.max((y0 + y1) / 2, vh / 2 / z);
  flyTo(z, cx, cy, smooth);
}
function fitAll(smooth = true) { if (view) fitRect(0, 0, view.width, view.height, { maxZ: 1, pad: 12, smooth }); }
function boundsOf(codes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of codes) {
    const n = view && view.nodes.get(c);
    if (!n) continue;
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
function zoomToCodes(codes) {
  const b = boundsOf(codes);
  if (b) fitRect(b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20, { maxZ: 1.4 });
}

// ───────────────────────── highlighting ─────────────────────────
function closure(start, nbrs) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const x = stack.pop();
    for (const y of nbrs.get(x) || []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return seen;
}
function matchesQuery(c, q) {
  const k = q.replace(/\s+/g, "").toLowerCase();
  return c.code.replace(/\s+/g, "").toLowerCase().includes(k) || c.name.toLowerCase().includes(q.toLowerCase());
}
// highlighted trees → card colours and edge colours (first tree wins)
let treeCache = null;
function treeSets(lay = view, highlights = state.highlights) {
  if (lay === view && treeCache) return treeCache;
  const cards = new Map(), edges = new Map(), roots = new Map();
  for (const h of highlights) {
    if (!lay.nodes.has(h.code)) continue;
    const anc = h.dir !== "post" ? closure(h.code, lay.preds) : new Set([h.code]);
    const desc = h.dir !== "pre" ? closure(h.code, lay.succs) : new Set([h.code]);
    roots.set(h.code, h.color);
    for (const c of new Set([...anc, ...desc])) {
      if (!cards.has(c)) cards.set(c, []);
      if (!cards.get(c).includes(h.color)) cards.get(c).push(h.color);
    }
    lay.edges.forEach((e, i) => {
      if (!edges.has(i) && ((anc.has(e.from) && anc.has(e.to)) || (desc.has(e.from) && desc.has(e.to)))) edges.set(i, h.color);
    });
  }
  const out = { cards, edges, roots, any: cards.size > 0 };
  if (lay === view) treeCache = out;
  return out;
}
function treeCodes(h) {
  if (!view || !view.nodes.has(h.code)) return [];
  const anc = h.dir !== "post" ? closure(h.code, view.preds) : new Set([h.code]);
  const desc = h.dir !== "pre" ? closure(h.code, view.succs) : new Set([h.code]);
  return [...new Set([...anc, ...desc])];
}

function applyHighlight() {
  if (!view) return;
  const q = state.query.trim();
  // hovering traces a chain; otherwise an active search wins over the pinned course
  const focus = [state.hovered, q ? null : state.selected].find(c => c && view.nodes.has(c)) || null;
  let anc = null, desc = null;
  if (focus) { anc = closure(focus, view.preds); desc = closure(focus, view.succs); }
  const matches = q ? new Set(view.visible.filter(c => matchesQuery(c, q)).map(c => c.code)) : null;
  $("#searchCount").textContent = q ? (matches.size ? String(matches.size) : "No match") : "";
  const trees = treeSets();
  const P = plan.on ? planInfo() : null;
  const path = P && P.path;
  for (const [code, el] of cardEls) {
    let cls = "card";
    const tc = trees.cards.get(code);
    let pm = "", pmCls = "";
    if (P) {
      const st = P.status.get(code);
      cls += st.state === "done" ? " p-done" : st.state === "ready" ? " p-ready" : " p-locked";
      const goal = path && path.goals.includes(code), step = path && path.step.get(code);
      if (goal) cls += " p-goal";
      else if (step) cls += " p-path";
      else if (path && st.state !== "done") cls += " p-off";
      if (goal) { pm = step ? `◎ goal · ${step}` : st.state === "done" ? "◎ ✓ done" : "◎ goal"; pmCls = "goal"; }
      else if (st.state === "done") { pm = "✓ done"; pmCls = "done"; }
      else if (step) { pm = `step ${step}`; pmCls = "step"; }
      else if (st.state === "ready") { pm = "available"; pmCls = "ready"; }
      else if (st.creditsShort) { pm = `${P.credits}/${st.minCredits} cr`; pmCls = "lock"; }
      else if (st.years && st.years.left.length) { pm = `${st.years.left.length} left`; pmCls = "lock"; }
    }
    if (anc) cls += code === focus ? " is-focus" : anc.has(code) ? " is-needs" : desc.has(code) ? " is-unlocks" : " is-dim";
    else if (matches) cls += matches.has(code) ? " is-match" : " is-dim";
    else if (trees.any) cls += tc ? " is-hl" + (trees.roots.has(code) ? " is-root" : "") : state.dimOthers ? " is-dim" : "";
    if (code === state.selected) cls += " is-selected";
    if (el.classList.contains("rise")) cls += " rise"; // keep the entrance and float state
    if (el.classList.contains("fl")) cls += " fl";
    if (el.className !== cls) el.className = cls;
    const hc = tc ? `var(--h${tc[0]})` : "";
    if (el.style.getPropertyValue("--hc") !== hc) { if (hc) el.style.setProperty("--hc", hc); else el.style.removeProperty("--hc"); }
    const marks = tc ? tc.map(c => `<i style="--hc:var(--h${c})"></i>`).join("") : "";
    const mEl = el.lastElementChild;
    if (mEl.dataset.m !== marks) { mEl.innerHTML = marks; mEl.dataset.m = marks; }
    const pEl = mEl.previousElementSibling, pc = "pm" + (pmCls ? " " + pmCls : "");
    if (pEl.textContent !== pm) pEl.textContent = pm;
    if (pEl.className !== pc) pEl.className = pc;
  }
  const base = $("#edgesBase"), hi = $("#edgesHi");
  const flows = [];
  for (const el of edgeEls) {
    const i = +el.dataset.i, e = view.edges[i];
    let s = "", marker = e.kind === "back" ? "ah-b" : "ah", color = "";
    if (anc) s = anc.has(e.from) && anc.has(e.to) ? "n" : desc.has(e.from) && desc.has(e.to) ? "u" : "d";
    else if (matches) s = matches.has(e.from) || matches.has(e.to) ? "" : "d";
    else if (trees.any) {
      if (trees.edges.has(i)) { s = "h"; color = `var(--h${trees.edges.get(i)})`; marker = `ah-h${trees.edges.get(i)}`; }
      else if (state.dimOthers) s = "d";
    } else if (path && path.needed.size) s = path.needed.has(e.from) && path.needed.has(e.to) ? "g" : "d";
    if (s === "n" || s === "u" || s === "d" || s === "g") marker = `ah-${s}`;
    const cls = `e ${el.dataset.base} ${s}`.replace(/\s+/g, " ").trim();
    if (el.getAttribute("class") !== cls) el.setAttribute("class", cls);
    if (el.style.stroke !== color) el.style.stroke = color;
    const m = `url(#${marker})`;
    if (el.getAttribute("marker-end") !== m) el.setAttribute("marker-end", m);
    const lifted = s === "n" || s === "u" || s === "h" || s === "g";
    if (lifted && e.kind !== "back") flows.push([i, s === "n" ? "var(--needs)" : s === "u" ? "var(--unlocks)" : s === "g" ? "var(--goal)" : color]);
    if (lifted && el.parentNode !== hi) hi.appendChild(el);
    else if (!lifted && el.parentNode !== base) base.appendChild(el);
  }
  renderFlows(flows);
  renderReadout(focus, anc, desc);
}

// small particles that travel along traced / highlighted links, towards the course they unlock
let flowKey = "";
function renderFlows(flows) {
  const key = flows.map(f => f.join(":")).join("|");
  if (key === flowKey) return;
  flowKey = key;
  $("#edgesFlow").innerHTML = flows.slice(0, 160).map(([i, color]) =>
    `<path class="flow" data-i="${i}" d="${view.edges[i].d}" style="stroke:${color};animation-delay:-${(hashCode(String(i)) % 16) / 10}s"></path>`).join("");
}

function renderReadout(focus, anc, desc) {
  const r = $("#readout");
  if (!focus || (focus === state.selected && !$("#details").hidden)) { r.hidden = true; return; }
  const c = state.courses.get(focus);
  const direct = view.preds.get(focus).length, unl = view.succs.get(focus).length;
  r.innerHTML = `<span class="c">${esc(c.code)}</span><span class="nm">${esc(c.name)}</span>
    <span class="st"><span class="n">${anc.size - 1}</span> in prerequisite chain (${direct} direct) · <span class="u">${desc.size - 1}</span> unlocked (${unl} direct)</span>`
    + (plan.on ? `<span class="ps ${planInfo().status.get(focus).state}">${esc(statusText(focus, true))}</span>` : "");
  r.hidden = false;
}

// ───────────────────────── tree highlights ─────────────────────────
function nextColor() {
  const used = new Set(state.highlights.map(h => h.color));
  for (let i = 0; i < N_HL; i++) if (!used.has(i)) return i;
  return state.highlights.length % N_HL;
}
function setHighlight(code, dir) {
  const i = state.highlights.findIndex(h => h.code === code);
  if (i >= 0 && (!dir || state.highlights[i].dir === dir)) state.highlights.splice(i, 1);
  else if (i >= 0) state.highlights[i].dir = dir;
  else state.highlights.push({ code, dir, color: nextColor() });
  treeCache = null;
  persist();
  renderTrees();
  renderDetails();
  applyHighlight();
}
function renderTrees() {
  const box = $("#trees");
  const hs = state.highlights.filter(h => state.courses.has(h.code));
  box.hidden = !hs.length;
  $("#hint").hidden = !!hs.length;
  if (!hs.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="lbl">Trees</span>` + hs.map(h => {
    const off = view && !view.nodes.has(h.code);
    return `<span class="tree-chip" style="--hc:var(--h${h.color})" data-tree="${esc(h.code)}" title="${off ? "Not in the current program filter" : "Zoom to this tree"}"${off ? ' data-off="1"' : ""}><i></i>${esc(h.code)} <span class="d">${DIRS[h.dir]}</span><button type="button" class="x" data-untree="${esc(h.code)}" aria-label="Remove ${esc(h.code)} highlight">×</button></span>`;
  }).join("")
    + `<button type="button" class="btn sd-btn sd-small" id="treeDim" aria-pressed="${state.dimOthers}">${state.dimOthers ? "Dim others: on" : "Dim others: off"}</button>`
    + `<button type="button" class="btn sd-btn sd-small" id="treeZoom">Zoom to trees</button>`
    + `<button type="button" class="btn ghost sd-btn sd-small sd-ghost" id="treeClear">Clear</button>`;
}

// ───────────────────────── planning ─────────────────────────
// availability and the goal path, recomputed after any change to the sheet, the
// program filter or the plan
let planCache = null;
function planInfo() {
  if (planCache) return planCache;
  const program = state.filter && state.filter !== MANUAL ? state.filter : "";
  const ev = PFPlan.evaluate(state.courses, plan.completed, program);
  const goals = plan.goals.filter(g => state.courses.has(g));
  planCache = { ...ev, program, path: goals.length ? PFPlan.plan(state.courses, plan.completed, goals, program) : null };
  return planCache;
}
const progName = p => p ? shortProg(p) : "the loaded courses";
// one line on why a course is or isn't available
function statusText(code, short = false) {
  const P = planInfo(), st = P.status.get(code);
  if (!st) return "";
  if (st.state === "done") return "Completed";
  if (st.state === "ready") return "Available now";
  const bits = [];
  const grp = g => g.length > 1 ? g.join(" or ") : g[0];
  if (st.prereqs.length) bits.push(`needs ${st.prereqs.map(grp).join(", ")}`);
  if (st.coreqs.length) bits.push(`coreq ${st.coreqs.map(grp).join(", ")}`);
  if (st.creditsShort) bits.push(`needs ${st.minCredits} credit hours (${P.credits} so far, ${Math.ceil(st.creditsShort / PFPlan.CREDITS)} more courses)`);
  if (st.years && st.years.left.length) bits.push(`${plural(st.years.left.length, "course")} left in years 1–${st.years.years}${short ? "" : ` of ${progName(st.years.program)}`}`);
  return "Locked: " + bits.join("; ");
}
function setPlanOn(on) {
  const drawer = $("#details").hidden;
  plan.on = on;
  savePlan();
  syncControls();
  renderDetails();
  applyHighlight();
  if (drawer !== $("#details").hidden) fitAll(); // the plan panel opened or closed
}
function setBrush(b) {
  plan.brush = b;
  savePlan();
  syncControls();
}
function planChanged() {
  planCache = null;
  savePlan();
  syncControls();
  renderDetails();
  applyHighlight();
}
function toggleDone(code) {
  if (!code || !state.courses.has(code)) return;
  const was = new Set([...planInfo().status].filter(([, st]) => st.state === "ready").map(([c]) => c));
  const on = !plan.completed.has(code);
  if (on) plan.completed.add(code); else plan.completed.delete(code);
  planChanged();
  // a short pulse on the courses this just opened up
  const fresh = [...planInfo().status].filter(([c, st]) => st.state === "ready" && !was.has(c)).map(([c]) => c);
  if (motionOn()) for (const c of fresh) { const el = cardEls.get(c); if (el) el.animate([{ scale: 1 }, { scale: 1.07 }, { scale: 1 }], { duration: 650, easing: "ease-out" }); }
  const shown = fresh.filter(c => view && view.nodes.has(c));
  showToast(on ? `✓ ${esc(code)} completed${shown.length ? ` · ${plural(shown.length, "course")} now available` : ""}` : `${esc(code)} marked not completed`, 2200);
}
function toggleGoal(code) {
  if (!code || !state.courses.has(code)) return;
  const i = plan.goals.indexOf(code);
  if (i >= 0) plan.goals.splice(i, 1); else plan.goals.push(code);
  if (i < 0) plan.panel = true;
  planChanged();
  if (i < 0) {
    const n = planInfo().path.needed.size;
    showToast(plan.completed.has(code) ? `${esc(code)} is already completed` : `◎ ${esc(code)} set as a goal · ${plural(n, "course")} to take`, 2600);
  }
}
function planItem(code, P) {
  const c = state.courses.get(code);
  const st = P.status.get(code);
  const off = !view || !view.nodes.has(code);
  const cr = st && st.state === "locked" && st.creditsShort ? ` · ${st.minCredits} cr` : "";
  return `<button type="button" class="pitem ${st ? st.state : ""}" data-goto="${esc(code)}" title="${esc(statusText(code))}${off ? " · not in the shown program" : ""}"><b>${esc(code)}</b><span>${esc(c.name)}</span><i>${semLabel(c.semester)}${cr}${P.path && P.path.goals.includes(code) ? " · ◎" : ""}</i></button>`;
}
// the drawer's contents in plan mode when no course is pinned
function planPanelHtml() {
  const P = planInfo();
  const vis = view ? view.visible : [];
  const doneShown = vis.filter(c => plan.completed.has(c.code)).length;
  const scope = state.filter ? (state.filter === MANUAL ? "added by hand" : shortProg(state.filter)) : `all ${plural(state.programs.length, "program")}`;
  let h = `<header><span class="dcode">Plan</span><button class="xbtn sd-x" type="button" id="dClose" aria-label="Close the plan panel">×</button>
    <div class="dname">${plural(P.count, "course")} completed · ${P.credits} credit hours</div>
    <div class="dsem">${doneShown} of ${vis.length} shown completed · ${esc(scope)}</div></header><div class="dbody">`;
  if (!plan.completed.size && !plan.goals.length) {
    h += `<p class="note sd-callout">Click a course to mark it completed; what you can take next lights up. Choose <b>Set a goal</b> and click a course to see, in order, what it takes to get there. Completed courses count in every program, and are kept between visits.</p>`;
  }
  // goals and the path to them
  const path = P.path;
  h += `<h3>Goals <span class="ct">${plan.goals.length}</span></h3>`;
  if (!plan.goals.length) h += `<p class="plain muted">No goals yet. Choose <b>Set a goal</b> next to “Click a course to”, then click a course (or use “Set as goal” on a pinned course).</p>`;
  else {
    h += `<div class="grp">${plan.goals.map(g => {
      const c = state.courses.get(g);
      return `<span class="gchip${c ? "" : " missing"}" title="${c ? esc(c.name) : "Not in the loaded courses"}">${c ? `<button type="button" class="gl" data-goto="${esc(g)}">◎ ${esc(g)}</button>` : `◎ ${esc(g)}`}<button type="button" class="x" data-ungoal="${esc(g)}" aria-label="Remove goal ${esc(g)}">×</button></span>`;
    }).join("")}</div>`;
    if (path) {
      if (path.doneGoals.length) h += `<p class="plain muted mt">Already completed: ${esc(path.doneGoals.join(", "))}.</p>`;
      if (!path.needed.size) h += `<p class="plain mt">Nothing left to take for ${path.goals.length > 1 ? "these goals" : "this goal"}.</p>`;
      else {
        h += `<h3>Path, in order <span class="ct">${plural(path.needed.size, "course")}</span></h3><div class="steps">`;
        path.steps.forEach((list, i) => {
          const now = list.every(x => P.status.get(x).state === "ready");
          h += `<div class="step"><div class="sh"><b>Step ${i + 1}</b><span>${i === 0 ? (now ? "available now" : "start here") : `after step ${i}`}</span></div>${list.map(x => planItem(x, P)).join("")}</div>`;
        });
        h += `</div><p class="plain muted mt">A step is one round of courses: each only needs earlier steps (corequisites can share one). Where a requirement offers a choice, a completed option counts; otherwise an option in the shown program comes first, then one the path already takes, then the one with the fewest courses left.</p>`;
        const picks = path.picks.filter(k => path.needed.has(k.course));
        if (picks.length) h += `<p class="plain muted mt">Either/or picks${P.program ? ` (preferring ${esc(shortProg(P.program))} courses)` : ""}: ${picks.map(k => `<b>${esc(k.picked)}</b> for ${esc(k.course)} instead of ${esc(k.over.join(" or "))}`).join("; ")}.</p>`;
        for (const [code, pool] of path.pools) h += `<p class="plain muted mt">${esc(code)} needs every year 1–${pool.years} course of ${esc(progName(pool.program))}${!P.program && pool.program ? " (the program with the fewest left)" : ""}: ${plural(pool.left.length, "course")} to go.</p>`;
        for (const [code, n] of path.short) h += `<p class="plain mt">${esc(code)} needs ${PFPlan.rules(state.courses.get(code)).minCredits} credit hours: take ${plural(n, "more course")} (electives count) before it.</p>`;
      }
    }
  }
  // available now, in this view
  const ready = vis.filter(c => P.status.get(c.code).state === "ready").sort((a, b) => a.semester - b.semester || cmpCode(a.code, b.code));
  h += `<h3>Available now <span class="ct">${ready.length}</span></h3>`;
  h += ready.length ? `<div class="plist">${ready.map(c => planItem(c.code, P)).join("")}</div>` : `<p class="plain muted">${vis.length && doneShown === vis.length ? "Every shown course is completed." : "Nothing shown is available yet."}</p>`;
  h += `</div><footer><button class="btn sd-btn sd-small" type="button" id="pClearGoals"${plan.goals.length ? "" : " disabled"}>Clear goals</button><button class="btn danger sd-btn sd-small sd-danger" type="button" id="pClearDone"${plan.completed.size ? "" : " disabled"}>Clear completed</button></footer>`;
  return h;
}
// the plan block at the top of a pinned course's details
function planDetailsHtml(c) {
  const P = planInfo(), st = P.status.get(c.code);
  const goal = plan.goals.includes(c.code);
  let h = `<h3>Plan</h3><p class="pstat ${st.state}">${esc(statusText(c.code))}</p>
    <div class="hlrow"><button type="button" class="btn sd-btn sd-small${st.state === "done" ? " on" : ""}" id="dDone" aria-pressed="${st.state === "done"}">${st.state === "done" ? "✓ Completed" : "Mark completed"}</button>
    <button type="button" class="btn sd-btn sd-small${goal ? " on" : ""}" id="dGoal" aria-pressed="${goal}">${goal ? "◎ Goal" : "Set as goal"}</button></div>`;
  if (st.years && st.years.left.length) h += `<p class="plain muted mt">Still to complete (${esc(progName(st.years.program))}):</p><div class="grp mt">${st.years.left.map(x => chip(x, "n")).join("")}</div>`;
  return h;
}

// ───────────────────────── details drawer ─────────────────────────
function chip(code, cls = "") {
  const c = state.courses.get(code);
  if (!c) return `<span class="chip missing" title="Not in the loaded courses">${esc(code)}</span>`;
  return `<button type="button" class="chip ${cls}" data-goto="${esc(code)}" title="${esc(c.name)} · ${semLabel(c.semester)}">${esc(code)}</button>`;
}
function groupsHtml(groups, cls, lead) {
  return groups.map(g => `<div class="grp">${g.length > 1 ? `<span class="lead">${lead || "one of"}</span>${g.map(x => chip(x, cls)).join(`<span class="or">or</span>`)}` : chip(g[0], cls)}</div>`).join("");
}
function renderDetails() {
  const d = $("#details");
  const c = state.selected && state.courses.get(state.selected);
  const wasOpen = !d.hidden;
  const panel = !c && plan.on && plan.panel && state.courses.size > 0;
  if (!c && !panel) {
    d.hidden = true; $("#stage").classList.remove("drawer-open");
    if (wasOpen) sizeWorld();
    return;
  }
  $("#stage").classList.add("drawer-open");
  if (panel) {
    const sc = d.querySelector(".dbody"), keep = sc && d.dataset.kind === "plan" ? sc.scrollTop : 0;
    d.innerHTML = planPanelHtml();
    d.dataset.kind = "plan";
    d.querySelector(".dbody").scrollTop = keep;
    d.hidden = false;
    if (!wasOpen) sizeWorld();
    return;
  }
  d.dataset.kind = "course";
  // Capstone's years 1–3 requirement counts as a prerequisite of the courses it covers
  const lim = course => PFPlan.rules(course).yearsComplete * 2;
  const shownCap = view ? view.visible.filter(o => lim(o) && o.code !== c.code && !lim(c) && c.semester <= lim(o) && view.nodes.has(c.code)) : [];
  const unlocks = [...new Set([...[...state.courses.values()].filter(o => [...o.prereqs, ...o.coreqs].some(g => g.includes(c.code))).map(o => o.code), ...shownCap.map(o => o.code)])].sort(cmpCode);
  const hl = state.highlights.find(h => h.code === c.code);
  let html = `<header><span class="dcode">${esc(c.code)}</span><span class="hbtns">${plan.on ? `<button class="btn ghost sd-btn sd-small sd-ghost" type="button" id="dBack" title="Back to the plan panel">← plan</button>` : ""}<button class="xbtn sd-x" type="button" id="dClose" aria-label="Close details">×</button></span>
    <div class="dname">${esc(c.name)}</div><div class="dsem">${semLabel(c.semester)} · ${semLong(c.semester)}</div></header><div class="dbody">`;
  if (plan.on) html += planDetailsHtml(c);
  html += `<h3>Highlight tree</h3><div class="hlrow"><div class="seg sd-seg" role="group" aria-label="Highlight tree">${Object.entries(DIRS).map(([k, v]) =>
    `<button type="button" data-hl="${k}" aria-pressed="${!!hl && hl.dir === k}">${v}</button>`).join("")}</div><button type="button" class="btn sd-btn sd-small" id="dZoom">Zoom to chain</button></div>`;
  const yrs = PFPlan.rules(c).yearsComplete;
  const capPre = yrs && view && view.nodes.has(c.code) ? view.preds.get(c.code).filter(x => !c.prereqs.some(g => g.includes(x))).length : 0;
  html += `<h3>Prerequisites <span class="ct">${c.prereqs.length + (yrs ? 1 : 0)}</span></h3>` + (c.prereqs.length ? `<div class="groups">${groupsHtml(c.prereqs, "n")}</div>` : yrs ? "" : `<p class="plain muted">None listed.</p>`);
  if (yrs) html += `<p class="plain${c.prereqs.length ? " mt" : ""}">Every program course in years 1–${yrs}${capPre ? `: ${plural(capPre, "course")} shown, linked along the bottom of the sheet` : ""}.</p>`;
  const cr = PFPlan.rules(c).minCredits;
  if (cr) html += `<p class="plain mt">At least ${cr} credit hours completed (${Math.ceil(cr / PFPlan.CREDITS)} courses at 3 credit hours each). Not drawn as links.</p>`;
  if (c.coreqs.length) html += `<h3>Corequisites <span class="ct">${c.coreqs.length}</span></h3><div class="groups">${groupsHtml(c.coreqs, "n")}</div><p class="plain muted mt">Taken before or alongside; drawn like prerequisites.</p>`;
  html += `<h3>Required by <span class="ct">${unlocks.length}</span></h3>` + (unlocks.length ? `<div class="grp">${unlocks.map(x => chip(x, "u")).join("")}</div>` : `<p class="plain muted">Nothing loaded requires it.</p>`);
  if (c.notes.length) html += `<h3>Notes</h3>${c.notes.map(n => `<p class="plain">${esc(n)}</p>`).join("")}`;
  if (c.ignored.length) html += `<h3>Ignored from the source</h3>${c.ignored.map(n => `<p class="plain muted">${esc(n)}</p>`).join("")}`;
  if (c.programs.length) html += `<h3>Listed in <span class="ct">${c.programs.length}</span></h3><ul class="proglist">${c.programs.map(p => `<li>${esc(shortProg(p))}</li>`).join("")}</ul>`;
  html += `</div><footer><button class="btn sd-btn sd-small" type="button" id="dEdit">Edit</button><button class="btn danger sd-btn sd-small sd-danger" type="button" id="dDelete">Delete</button></footer>`;
  d.innerHTML = html;
  d.hidden = false;
  if (!wasOpen) sizeWorld();
}

// ───────────────────────── selection ─────────────────────────
let drawerTimer = 0;
function select(code, { scroll = false, fromCard = false } = {}) {
  state.selected = code && state.courses.has(code) ? code : null;
  if (state.selected && view && !view.nodes.has(state.selected)) { state.filter = ""; syncControls(); renderChart(); }
  clearTimeout(drawerTimer);
  if (fromCard && state.selected && $("#details").hidden) {
    // open the drawer a beat later, so a double-click still lands on the card
    drawerTimer = setTimeout(() => { renderDetails(); applyHighlight(); revealCard(state.selected); }, 260);
  } else {
    renderDetails();
    if (fromCard) revealCard(state.selected);
  }
  applyHighlight();
  if (plan.on) syncPlanbar();
  if (scroll && state.selected) scrollToCard(state.selected);
}
// keep a pinned card from sitting under the drawer / bottom sheet
function revealCard(code) {
  const el = code && cardEls.get(code), d = $("#details");
  if (!el || d.hidden) return;
  const r = el.getBoundingClientRect(), dr = d.getBoundingClientRect();
  if (r.right > dr.left && r.left < dr.right && r.bottom > dr.top && r.top < dr.bottom) scrollToCard(code);
}
function scrollToCard(code) {
  const p = view && view.nodes.get(code);
  if (!p) return;
  flyTo(zoom < 0.55 ? 0.9 : zoom, p.x + p.w / 2, p.y + p.h / 2);
}

// ───────────────────────── page chrome ─────────────────────────
function syncControls() {
  const has = state.courses.size > 0;
  const nEdges = [...state.courses.values()].reduce((n, c) => n + [...c.prereqs, ...c.coreqs].reduce((k, g) => k + g.filter(x => state.courses.has(x)).length, 0), 0);
  $("#sheetInfo").textContent = has
    ? `${plural(state.courses.size, "course")} · ${plural(state.programs.length, "program")} · ${plural(nEdges, "link")}`
    : "No courses loaded";
  $("#searchWrap").hidden = !has;
  $("#legendProg").hidden = state.programs.length < 2;
  $("#btnExport").disabled = !has;
  $("#zoombar").hidden = !has;
  $("#credit").hidden = !has;
  $$("#modeSeg button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.mode === state.mode)));
  syncPlanbar(has);
  $("#semCount").hidden = state.mode !== "semester";
  const pf = $("#programFilter");
  const manual = [...state.courses.values()].filter(c => !c.programs.length).length;
  const showFilter = has && (state.programs.length > 1 || (state.programs.length && manual));
  pf.hidden = !showFilter;
  if (showFilter) {
    const counts = new Map(state.programs.map(p => [p, 0]));
    for (const c of state.courses.values()) for (const p of c.programs) counts.set(p, (counts.get(p) || 0) + 1);
    const progs = [...state.programs].sort((a, b) => a.localeCompare(b));
    pf.innerHTML = `<option value="">All ${state.programs.length} programs (${state.courses.size})</option>`
      + progs.map(p => `<option value="${esc(p)}">${esc(shortProg(p))} (${counts.get(p) || 0})</option>`).join("")
      + (manual ? `<option value="${MANUAL}">Added by hand (${manual})</option>` : "");
    pf.value = state.filter;
    if (pf.value !== state.filter) { state.filter = ""; pf.value = ""; }
  } else state.filter = "";
  $("#semCount").value = String(state.semCount);
}
function syncPlanbar(has = state.courses.size > 0) {
  const on = plan.on && has;
  $("#app").classList.toggle("planning", on);
  $$("#planSeg button").forEach(b => b.setAttribute("aria-checked", String((b.dataset.plan === "1") === plan.on)));
  $("#planbar").hidden = !on;
  $("#hint").textContent = plan.on
    ? "Plan mode. Choose what clicking a course does: mark it completed, set it as a goal to see the route to it, or show its details."
    : "Explore mode. Hover a course to trace it, click to pin it, and scroll or pinch to zoom.";
  if (!on) return;
  $$("#brushSeg button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.brush === plan.brush)));
  const P = planInfo();
  const vis = view ? view.visible : visibleCourses();
  const ready = vis.filter(c => P.status.get(c.code).state === "ready").length;
  const path = P.path;
  $("#planStats").innerHTML = `<b>${P.count}</b> completed · <b>${P.credits}</b> credit hours · <b>${ready}</b> available now`
    + (path ? ` · <b>${path.needed.size}</b> ${path.needed.size === 1 ? "course" : "courses"} to go for ${plural(path.goals.length, "goal")}${path.steps.length > 1 ? ` (${path.steps.length} steps)` : ""}` : "");
  $("#btnPlanPanel").setAttribute("aria-pressed", String(plan.panel && !state.selected));
}
function render() {
  syncControls();
  const has = state.courses.size > 0;
  $("#empty").hidden = has || !$("#welcomeDlg").hidden;
  $("#viewport").hidden = !has;
  $("#colhead").hidden = !has;
  if (has) renderChart();
  else { view = null; $("#readout").hidden = true; renderColhead(); syncFloat(); }
  renderTrees();
  renderDetails();
}

let toastTimer = 0;
function showToast(html, ms = 3200, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${html}</span>` + (action ? `<button type="button" id="toastAct">${esc(action.label)}</button>` : "");
  t.hidden = false;
  if (action) $("#toastAct").onclick = () => { hideToast(); action.run(); };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $("#toast").hidden = true; clearTimeout(toastTimer); }

let lastFocus = null;
function openDialog(sel) {
  lastFocus = document.activeElement;
  const o = $(sel);
  o.hidden = false;
  const f = o.querySelector("[autofocus], input:not([type=hidden]):not([readonly]):not([type=radio]):not([type=checkbox]), .btn.primary");
  if (f) setTimeout(() => f.focus(), 0);
}
function closeDialog(sel) {
  const o = $(sel);
  if (o.hidden) return;
  o.hidden = true;
  if (sel === "#welcomeDlg") $("#empty").hidden = state.courses.size > 0;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
function topDialog() { return $$(".overlay").reverse().find(o => !o.hidden) || null; }
function restoreUndo(undo, msg) { loadSnapshot(undo); persist(); render(); if (msg) showToast(msg); }

// ───────────────────────── start screen ─────────────────────────
function openWelcome() {
  const sel = $("#wProgram");
  if (DEFAULT) {
    const progs = [...DEFAULT.programs].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">All ${progs.length} programs (${DEFAULT.courses.length} courses)</option>`
      + progs.map(p => `<option value="${esc(p)}">${esc(shortProg(p))} (${DEFAULT.courses.filter(c => (c.programs || []).includes(p)).length})</option>`).join("");
    $("#wDefaultInfo").textContent = `All engineering programs and specializations, parsed from the official program maps: ${DEFAULT.courses.length} courses.`;
  } else {
    sel.innerHTML = `<option value="">Built-in data missing</option>`;
    $("#wDefault").disabled = true;
  }
  const saved = readSaved();
  $("#wResume").hidden = !saved;
  if (saved) {
    const when = new Date(saved.savedAt);
    const fmt = isNaN(when) ? "" : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("#wResumeInfo").textContent = `${plural(saved.data.courses.length, "course")}${saved.data.programs && saved.data.programs.length ? ` · ${plural(saved.data.programs.length, "program")}` : ""}${fmt ? ` · saved ${fmt}` : ""}`;
  }
  $("#wDate").textContent = today();
  $("#empty").hidden = true;
  openDialog("#welcomeDlg");
  setTimeout(() => $(saved ? "#wResumeBtn" : "#wDefault").focus(), 0); // a returning visitor's Enter resumes, never overwrites
}
function loadDefault(program) {
  if (!DEFAULT) return;
  const undo = state.courses.size ? snapshot() : null;
  clearSheet();
  replaceOnImport = false;
  state.courses = new Map(DEFAULT.courses.map(c => { const n = normalizeCourse(c); return [n.code, n]; }));
  state.programs = DEFAULT.programs.slice();
  state.semCount = [4, 6, 8, 10, 12].includes(+DEFAULT.semesters) ? +DEFAULT.semesters : 8;
  state.filter = program || "";
  persist();
  closeDialog("#welcomeDlg");
  render();
  fitAll(false);
  if (undo) showToast("Loaded the built-in program maps", 5000, { label: "Undo", run: () => restoreUndo(undo, "Restored previous sheet") });
}

// ───────────────────────── line input rows ─────────────────────────
let rows = [];
function newRow(text = "", sem = null) { const r = { id: uid(), text, sem }; parseRow(r); return r; }
function parseRow(r) {
  const t = r.text.trim();
  r.parsed = null; r.kind = t ? "other" : "empty"; r.inlineSem = null;
  if (!t) return;
  const lead = PF.splitLeadingLabel(t);
  const p = PF.parseCourseText(lead.semester ? lead.rest : t);
  if (lead.semester) r.inlineSem = lead.semester;
  if (p) r.kind = p.kind;
  if (p && p.kind === "course") r.parsed = p;
}
const rowSem = r => r.sem || r.inlineSem || (r.parsed ? PF.semesterFromCode(r.parsed.code) : null);
function rowInfo(r) {
  if (r.kind === "empty") return "";
  if (!r.parsed) return r.kind === "elective" ? "elective slot · will be skipped" : "not a course line · start with a code such as ELEE 3180U";
  const p = r.parsed;
  const bits = [`<b>✓ ${esc(p.code)}</b>`, esc(p.name)];
  const pre = p.prereqs.length, co = p.coreqs.length, alt = [...p.prereqs, ...p.coreqs].filter(g => g.length > 1).length;
  bits.push(pre || co ? `needs ${pre}${co ? ` + ${co} coreq` : ""}${alt ? ` (${alt} either/or)` : ""}` : "no prerequisites");
  if (p.ignored.length) bits.push("restriction ignored");
  if (p.notes.length) bits.push("note kept");
  return bits.join(" · ");
}
function rowClass(r) { return "prow" + (r.parsed ? " ok" : r.kind === "empty" ? "" : " bad"); }
function renderRows() {
  if (!rows.length) rows.push(newRow());
  $("#prows").innerHTML = rows.map(r => `<div class="${rowClass(r)}" data-id="${r.id}">
      <input class="psem sd-input sd-small sd-mono" type="number" min="1" max="16" inputmode="numeric" aria-label="Semester number" value="${r.sem || ""}" placeholder="${rowSem(r) || ""}" id="sem-${r.id}">
      <div class="pmain"><input class="ptext sd-input sd-small sd-mono" type="text" value="${esc(r.text)}" placeholder="ELEE 3180U Design Principles &amp; Project Management (ELEE 2250U, ELEE 2450U)" aria-label="Course line" id="txt-${r.id}" spellcheck="false" autocomplete="off"><div class="pinfo">${rowInfo(r)}</div></div>
      <button class="prm sd-btn sd-small sd-icon sd-ghost" type="button" aria-label="Remove row">×</button></div>`).join("");
  updatePasteFooter();
}
function refreshRow(r) {
  const el = $(`.prow[data-id="${r.id}"]`);
  if (!el) return;
  el.className = rowClass(r);
  el.querySelector(".pinfo").innerHTML = rowInfo(r);
  el.querySelector(".psem").placeholder = rowSem(r) || "";
  updatePasteFooter();
}
let skippedLines = [];
function updatePasteFooter() {
  const ok = rows.filter(r => r.parsed).length;
  const bad = rows.filter(r => !r.parsed && r.kind !== "empty").length;
  const btn = $("#btnAddRows");
  btn.disabled = !ok;
  btn.textContent = ok ? `Add ${plural(ok, "course")}` : "Add courses";
  $("#pasteStatus").textContent = bad ? `${plural(bad, "line")} will be skipped` : "";
  const sk = $("#skipped");
  sk.hidden = !skippedLines.length;
  if (skippedLines.length) {
    sk.querySelector("summary").textContent = `${plural(skippedLines.length, "pasted line")} weren't courses (electives, headings) and were left out`;
    sk.querySelector("ul").innerHTML = skippedLines.slice(0, 40).map(t => `<li>${esc(t)}</li>`).join("");
  }
}
function focusRow(id, atEnd = true) {
  const el = $(`#txt-${id}`);
  if (!el) return;
  el.focus();
  if (atEnd) { const n = el.value.length; el.setSelectionRange(n, n); }
}
function rowById(id) { return rows.find(r => r.id === id); }

function onRowsPaste(e) {
  const t = e.target;
  if (!t.classList || !t.classList.contains("ptext")) return;
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!/[\r\n]/.test(text)) return; // a one-line paste behaves normally
  e.preventDefault();
  const id = t.closest(".prow").dataset.id;
  const i = rows.findIndex(r => r.id === id);
  const cur = rows[i];
  const prefix = t.value.slice(0, t.selectionStart).trim();
  const entries = PF.splitEntries((prefix ? prefix + "\n" : "") + text);
  const fresh = [];
  for (const en of entries) {
    if (en.kind === "course") fresh.push(newRow(en.text, en.semester));
    else skippedLines.push(en.text);
  }
  if (!fresh.length) { updatePasteFooter(); return; }
  const keepCur = cur.text.trim() && !prefix ? [cur] : [];
  rows.splice(i, 1, ...keepCur, ...fresh);
  if (rows[rows.length - 1].text.trim()) rows.push(newRow());
  renderRows();
  focusRow(rows[rows.length - 1].id);
}
function addRowsToPlan() {
  const ok = rows.filter(r => r.parsed);
  if (!ok.length) return;
  const records = ok.map(r => PF.mkCourse(r.parsed, clampSem(rowSem(r)), null));
  const rep = newReport("", "Line input", "Lines");
  rep.courses = records.length;
  for (const r of ok) tally(rep, r.parsed);
  rep.electives = rows.filter(r => r.kind === "elective").map(r => r.text).concat(skippedLines);
  rep.guessed = ok.filter(r => !r.sem && !r.inlineSem).length;
  const result = mergeBatches([{ records, programs: [], label: "line input" }]);
  rows = [newRow()];
  skippedLines = [];
  closeDialog("#importDlg");
  render();
  fitAll(false);
  showReport([rep], result, "Courses added");
}

// ───────────────────────── edit / add ─────────────────────────
let editing = null;
function openEdit(code) {
  editing = code && state.courses.get(code) ? code : null;
  const c = editing ? state.courses.get(editing) : null;
  const n = Math.max(state.semCount, ...[...state.courses.values()].map(x => x.semester), c ? c.semester : 1);
  $("#fSem").innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${semLabel(i + 1)} · ${semLong(i + 1)}</option>`).join("");
  $("#editTitle").textContent = c ? `Edit ${c.code}` : "Add course";
  $("#fCode").value = c ? c.code : "";
  $("#fCode").readOnly = !!c;
  $("#fName").value = c ? c.name : "";
  $("#fSem").value = String(c ? c.semester : 1);
  const fmt = gs => gs.map(g => g.join(" or ")).join(", ");
  $("#fPre").value = c ? fmt(c.prereqs) : "";
  $("#fCo").value = c ? fmt(c.coreqs) : "";
  $("#fErr").textContent = "";
  $("#fDelete").hidden = !c;
  disarm($("#fDelete"), "Delete course");
  openDialog("#editDlg");
  setTimeout(() => (c ? $("#fName") : $("#fCode")).focus(), 0);
}
function saveEdit() {
  const rawCode = $("#fCode").value.trim();
  const m = rawCode.match(/^([A-Za-z]{2,5})\s*(\d{3,4})([A-Za-z]?)$/);
  if (!m) { $("#fErr").textContent = "Enter a course code such as ELEE 3180U."; $("#fCode").focus(); return; }
  const code = PF.canonCode(m[1], m[2], m[3]);
  if (!editing && state.courses.has(code)) { $("#fErr").textContent = `${code} is already loaded. Double-click it on the chart to edit it.`; return; }
  const name = $("#fName").value.trim();
  if (!name) { $("#fErr").textContent = "Enter the course name."; $("#fName").focus(); return; }
  const pre = PF.parseRequirementText($("#fPre").value), co = PF.parseRequirementText($("#fCo").value);
  const strip = gs => gs.map(g => g.filter(x => x !== code)).filter(g => g.length);
  const old = editing ? state.courses.get(editing) : null;
  const course = {
    code, name, semester: clampSem($("#fSem").value),
    prereqs: strip(PF.dedupeGroups(pre.prereqs)),
    coreqs: strip(PF.dedupeGroups([...pre.coreqs, ...co.prereqs, ...co.coreqs])),
    notes: old ? old.notes : [...pre.notes, ...co.notes],
    ignored: old ? old.ignored : [...pre.ignored, ...co.ignored],
    programs: old ? old.programs : [],
  };
  const undo = snapshot();
  state.courses.set(code, course);
  persist();
  closeDialog("#editDlg");
  state.selected = code;
  render();
  showToast(old ? `Saved ${esc(code)}` : `Added ${esc(code)}`, 3600, { label: "Undo", run: () => restoreUndo(undo) });
  scrollToCard(code);
}
function deleteCourse(code) {
  const undo = snapshot();
  state.courses.delete(code);
  if (state.selected === code) state.selected = null;
  if (state.hovered === code) state.hovered = null;
  state.highlights = state.highlights.filter(h => h.code !== code);
  const used = new Set([...state.courses.values()].flatMap(c => c.programs));
  state.programs = state.programs.filter(p => used.has(p));
  persist();
  render();
  showToast(`Deleted ${esc(code)}`, 5000, { label: "Undo", run: () => restoreUndo(undo) });
}

// two-step confirmation inside the page
const armTimers = new WeakMap();
function arm(btn, label, run) {
  if (btn.classList.contains("armed")) { disarm(btn); run(); return; }
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.classList.add("armed");
  btn.textContent = label;
  clearTimeout(armTimers.get(btn));
  armTimers.set(btn, setTimeout(() => disarm(btn), 4000));
}
function disarm(btn, label) {
  btn.classList.remove("armed");
  if (label) btn.dataset.label = label;
  if (btn.dataset.label) btn.textContent = btn.dataset.label;
  clearTimeout(armTimers.get(btn));
}

// ───────────────────────── data exports ─────────────────────────
function exportList(onlyFilter) {
  let list = [...state.courses.values()];
  if (onlyFilter && state.filter) list = visibleCourses();
  return list.sort((a, b) => a.semester - b.semester || cmpCode(a.code, b.code));
}
function fileBase(onlyFilter) {
  const tag = onlyFilter && state.filter && state.filter !== MANUAL ? "-" + slug(shortProg(state.filter)) : "";
  return `prereqflow${tag}-${today()}`;
}
function buildExport(kind, onlyFilter) {
  const list = exportList(onlyFilter);
  const base = fileBase(onlyFilter);
  if (kind === "json") {
    const programs = [...new Set(list.flatMap(c => c.programs))];
    const data = {
      format: "prereqflow", version: 1, exportedAt: new Date().toISOString(), semesters: state.semCount,
      programs: state.programs.filter(p => programs.includes(p)),
      courses: list.map(c => ({ code: c.code, name: c.name, semester: c.semester, term: semLabel(c.semester), prereqs: c.prereqs, coreqs: c.coreqs, notes: c.notes, ignored: c.ignored, programs: c.programs })),
    };
    if (plan.completed.size || plan.goals.length) data.plan = { completed: [...plan.completed].sort(cmpCode), goals: plan.goals.slice() };
    return { filename: base + ".json", data: JSON.stringify(data, null, 2) + "\n", mime: "application/json" };
  }
  if (kind === "csv") {
    const q = v => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const fmt = gs => gs.map(g => g.join(" or ")).join(", ");
    const lines = [["Code", "Name", "Semester", "Year-Semester", "Prerequisites", "Corequisites", "Notes", "Ignored", "Programs"].join(",")];
    for (const c of list) lines.push([c.code, c.name, String(c.semester), semLabel(c.semester), fmt(c.prereqs), fmt(c.coreqs), c.notes.join("; "), c.ignored.join("; "), c.programs.join("; ")].map(q).join(","));
    return { filename: base + ".csv", data: "﻿" + lines.join("\r\n") + "\r\n", mime: "text/csv" };
  }
  const out = [`# PrereqFlow export · ${today()} · ${plural(list.length, "course")}`, "# One course per line: CODE Name (prerequisites, Coreq: …). A line like 2-1 sets year-semester for the lines below it.", ""];
  let sem = 0;
  for (const c of list) {
    if (c.semester !== sem) { if (sem) out.push(""); sem = c.semester; out.push(semLabel(sem)); }
    out.push(PF.courseToLine(c));
  }
  return { filename: base + ".txt", data: out.join("\n") + "\n", mime: "text/plain" };
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function download(kind, onlyFilter) {
  closeMenu();
  const { filename, data, mime } = buildExport(kind, onlyFilter);
  try {
    saveBlob(new Blob([data], { type: mime + ";charset=utf-8" }), filename);
    showToast(`Downloaded ${esc(filename)}`);
  } catch (e) {
    showCopy(filename, data, `The browser blocked the download, so here is ${filename} to copy instead.`);
  }
}
function showCopy(filename, data, msg) {
  $("#copyTitle").textContent = `Copy ${filename}`;
  $("#copyMsg").textContent = msg;
  $("#copyText").value = data;
  openDialog("#copyDlg");
}
function renderMenu() {
  const n = state.courses.size, f = state.filter;
  const fn = f ? visibleCourses().length : 0;
  const fname = f === MANUAL ? "added by hand" : shortProg(f);
  let h = `<button type="button" role="menuitem" data-img="1"><b>Image · PNG / SVG</b><small>High-resolution flowchart of the shown courses, a highlighted tree, the pinned course's chain or your goal path, with your plan (completed, available, goals) if you like.</small></button><hr>
    <button type="button" role="menuitem" data-dl="json"><b>JSON · all ${n} courses</b><small>Everything, including programs and your plan (completed and goal courses). Import it again to pick up where you left off.</small></button>
    <button type="button" role="menuitem" data-dl="csv"><b>CSV spreadsheet</b><small>One row per course, for Excel or Sheets. Imports back too.</small></button>
    <button type="button" role="menuitem" data-dl="txt"><b>Text lines</b><small>One line per course, grouped by semester. Pastes back into Line input.</small></button>`;
  if (f && fn) h += `<hr><button type="button" role="menuitem" data-dl="json" data-only="1"><b>JSON · only ${esc(fname)}</b><small>The ${plural(fn, "course")} currently shown.</small></button>`;
  $("#exportMenu").innerHTML = h;
}
function openMenu() { renderMenu(); $("#exportMenu").hidden = false; $("#btnExport").setAttribute("aria-expanded", "true"); const b = $("#exportMenu button"); if (b) b.focus(); }
function closeMenu() { $("#exportMenu").hidden = true; $("#btnExport").setAttribute("aria-expanded", "false"); }

// ───────────────────────── image export ─────────────────────────
// mirrors the CSS custom properties, so the export can use either sheet; when the shared
// master palette (/design/tokens.css) has loaded, its colours are used instead (exportPalette)
const PALETTE = {
  dark: { sheet: "#17191E", head: "#14161A", card: "#1C1F25", ink: "#F1EDE5", ink2: "#CAC5BB", ink3: "#A29E96", rule: "#2E323B", rule2: "#23262D", zoneAlt: "rgba(150,175,235,0.025)", edge: "#4D5362", back: "#EE9585", accent: "#A3B8F0", ok: "#9FD4AB", goal: "#EACB76", h: ["#9FD4AB", "#C4A9F2", "#F0A391", "#EACB76", "#7DCBC4", "#EBA3C6"] },
  light: { sheet: "#F6F3EC", head: "#FAF8F3", card: "#FFFFFF", ink: "#2F2D36", ink2: "#5D5967", ink3: "#8A8592", rule: "#DDD7CB", rule2: "#E8E3D9", zoneAlt: "rgba(80,105,190,0.03)", edge: "#BDB6AA", back: "#C2564A", accent: "#4F67C6", ok: "#3F8D5B", goal: "#A9831B", h: ["#3F8D5B", "#7A58C4", "#C65A45", "#A9831B", "#2B8A84", "#B6508A"] },
};
const SITE = "areeb-ece.github.io/prereqflow";

// Reads a sheet's colours from the master palette through a hidden probe element (the
// master defines every theme on [data-theme] too), or the page's own colours for
// "current". Falls back to PALETTE offline.
function exportPalette(theme) {
  const root = document.documentElement;
  const cur = theme === "current";
  const base = PALETTE[cur ? (root.dataset.scheme || root.dataset.theme) : theme] || PALETTE.dark;
  const probe = document.createElement("div");
  probe.hidden = true;
  if (!cur) probe.dataset.theme = theme === "light" ? "light" : "dark";
  document.body.append(probe);
  const cs = getComputedStyle(cur ? root : probe);
  const v = name => cs.getPropertyValue(name).trim();
  // Theme colours can be written as color-mix(); the export needs plain rgba().
  const ctx = document.createElement("canvas").getContext("2d");
  const plain = c => {
    probe.style.color = "";
    probe.style.color = c;
    if (!probe.style.color) return "";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
  };
  let out = base;
  if (cur || v("--master")) {
    const pick = (name, fallback) => (v(name) && plain(v(name))) || fallback;
    out = {
      ...base,
      sheet: pick("--sheet-2", base.sheet), head: pick("--sheet", base.head), card: pick("--card", base.card),
      ink: pick("--ink", base.ink), ink2: pick("--ink-2", base.ink2), ink3: pick("--ink-3", base.ink3),
      rule: pick("--rule", base.rule), rule2: pick("--rule-2", base.rule2), back: pick("--danger", base.back), accent: pick("--accent", base.accent),
      h: base.h.map((c, i) => pick(`--h${i}`, c)),
    };
    // --ok and --goal are the page's own (css/style.css sets them on :root only), so only "current" can read them
    if (cur) Object.assign(out, { zoneAlt: pick("--zone-alt", base.zoneAlt), edge: pick("--edge", base.edge), ok: pick("--ok", base.ok), goal: pick("--goal", base.goal) });
  }
  probe.remove();
  return out;
}

function imageScopes() {
  const sel = state.selected && view && view.nodes.has(state.selected) ? state.selected : null;
  const hs = state.highlights.filter(h => view && view.nodes.has(h.code));
  const treeSet = new Set(hs.flatMap(treeCodes));
  const chain = sel ? [...new Set([...closure(sel, view.preds), ...closure(sel, view.succs)])] : [];
  const vis = view ? view.visible.length : 0;
  const filt = state.filter ? (state.filter === MANUAL ? "added by hand" : shortProg(state.filter)) : (state.programs.length > 1 ? `all ${state.programs.length} programs` : "all courses");
  // the goals, the courses still needed for them, and the completed courses that lead straight in
  const path = view && state.courses.size ? planInfo().path : null;
  let pathCodes = [];
  if (path) {
    const on = new Set([...path.goals, ...path.needed].filter(c => view.nodes.has(c)));
    for (const c of [...on]) for (const p of view.preds.get(c)) if (plan.completed.has(p)) on.add(p);
    pathCodes = [...on];
  }
  return [
    { id: "view", label: `Shown · ${vis}`, hint: `Every course on the sheet (${filt}).`, codes: null, ok: vis > 0 },
    { id: "trees", label: `Highlighted trees · ${treeSet.size}`, hint: hs.length ? `Trees of ${hs.map(h => h.code).join(", ")}, laid out on their own.` : "Highlight a tree first (shift+click a course, or use the course panel).", codes: [...treeSet], ok: treeSet.size > 0 },
    { id: "chain", label: sel ? `${sel} chain · ${chain.length}` : "Pinned course chain", hint: sel ? `${sel} with everything it needs and unlocks, laid out on its own.` : "Click a course to pin it first.", codes: chain, ok: chain.length > 0 },
    { id: "window", label: "Visible area", hint: "Exactly the part of the sheet on screen, at the current layout.", codes: null, ok: vis > 0 },
    { id: "path", label: `Goal path · ${pathCodes.length}`, hint: path ? `Goals ${path.goals.join(", ")}, the courses still needed for them and the completed courses leading in, laid out on their own.` : "Set a goal in plan mode first.", codes: pathCodes, ok: pathCodes.length > 0, plan: true },
  ];
}
function openImageDlg() {
  closeMenu();
  const scopes = imageScopes();
  const prev = ($("input[name=imgScope]:checked") || {}).value;
  const want = plan.on && scopes.find(s => s.id === "path").ok ? "path" : state.highlights.length ? "trees" : "view";
  const pick = (scopes.find(s => s.id === prev && s.ok) || scopes.find(s => s.id === want && s.ok) || scopes[0]).id;
  $("#imgScope").innerHTML = scopes.map(s => `<label class="choice sd-check"><input type="radio" name="imgScope" value="${s.id}"${s.ok ? "" : " disabled"}${s.id === pick ? " checked" : ""}><span>${esc(s.label)}</span></label>`).join("");
  $("#imgHl").disabled = !state.highlights.length;
  const hasPlan = plan.completed.size > 0 || plan.goals.length > 0;
  $("#imgPlan").disabled = !hasPlan;
  $("#imgPlan").checked = hasPlan && plan.on;
  $("#imgPlanHint").textContent = hasPlan ? "(completed, available now, goals and the path to them)" : "(mark courses completed or set a goal in plan mode first)";
  $("#imgStatus").textContent = "";
  updateImageDims();
  openDialog("#imageDlg");
}
function imageOptions() {
  const val = n => ($(`input[name=${n}]:checked`) || {}).value;
  return {
    scope: val("imgScope") || "view", scale: +(val("imgScale") || 3), theme: val("imgTheme") || "current",
    format: val("imgFormat") || "png", title: $("#imgTitle").checked, hl: $("#imgHl").checked && state.highlights.length > 0,
    plan: !$("#imgPlan").disabled && ($("#imgPlan").checked || val("imgScope") === "path"),
  };
}
function updateImageDims() {
  const o = imageOptions();
  const s = imageScopes().find(x => x.id === o.scope);
  $("#imgScopeHint").textContent = s ? s.hint : "";
  try {
    const spec = buildImageSpec(o);
    const fit = PFImage.fitScale(spec.width, spec.height, o.scale);
    const px = sc => `${Math.round(spec.width * sc).toLocaleString()} × ${Math.round(spec.height * sc).toLocaleString()} px`;
    $("#imgDims").textContent = o.format === "svg"
      ? `Vector · ${Math.round(spec.width)} × ${Math.round(spec.height)} units (scales without loss)`
      : `${px(fit)}${fit < o.scale ? ` · reduced from ${o.scale}× to stay within browser canvas limits` : ""}`;
  } catch (e) { $("#imgDims").textContent = ""; }
}

// layout + styles → drawing operations (see image.js)
function buildImageSpec(o) {
  const P = exportPalette(o.theme);
  const scope = imageScopes().find(s => s.id === o.scope) || imageScopes()[0];
  let lay = view;
  if (scope.codes) {
    const keep = new Set(scope.codes);
    lay = computeView(view.visible.filter(c => keep.has(c.code)), { semCount: 1 });
  }
  const D = lay.dims;
  // crop window in layout coordinates (the whole sheet unless "visible area")
  let cx = 0, cy = 0, cw = lay.width, chH = lay.height;
  if (scope.id === "window") {
    const ins = drawerInset();
    cx = vp.scrollLeft / zoom; cy = vp.scrollTop / zoom;
    cw = Math.max(50, Math.min(lay.width - cx, (vp.clientWidth - ins.r) / zoom));
    chH = Math.max(50, Math.min(lay.height - cy, (vp.clientHeight - ins.b) / zoom));
  }
  const trees = o.hl ? treeSets(lay, state.highlights) : { cards: new Map(), edges: new Map(), roots: new Map(), any: false };
  const dim = trees.any && state.dimOthers;
  // the plan, drawn as in plan mode: card states and badges, the goal path's links lit
  const PI = o.plan ? planInfo() : null;
  const goals = PI && PI.path;                                 // goal marks and step numbers
  const path = goals && goals.needed.size && !trees.any ? goals : null; // dims what's off the path
  const ops = [];
  const W = Math.max(cw, 420);
  const titleH = o.title ? 84 : 0, headH = 40, footH = 40; // the footer (with the credit) is always drawn
  const top = titleH + headH;
  const band = planBand(goals, W - 2 * D.padL - 120);
  const bandH = band.length ? 34 + band.length * 18 : 0;
  const H = top + chH + bandH + footH;
  const X = x => x - cx, Y = y => y - cy + top; // layout → image

  // column zones (under the chart) and header (over it, so a crop scrolls beneath)
  const labels = columnLabels(lay);
  const chrome = [{ t: "rect", x: 0, y: titleH, w: W, h: headH, fill: P.head }];
  for (let k = 0; k < lay.nCols; k++) {
    const x = X(lay.colX(k) - D.gutter / 2);
    const alt = lay.mode === "free" ? k % 2 === 1 : Math.floor(k / 2) % 2 === 1;
    if (alt) ops.push({ t: "rect", x, y: top, w: D.colW + D.gutter, h: chH, fill: P.zoneAlt });
    const major = lay.mode === "free" || k % 2 === 0;
    if (k > 0) {
      ops.push({ t: "path", d: `M${x},${top} V${top + chH}`, stroke: major ? P.rule : P.rule2, sw: 1, dash: major ? null : [4, 4] });
      chrome.push({ t: "path", d: `M${x},${titleH} V${top}`, stroke: major ? P.rule : P.rule2, sw: 1, dash: major ? null : [4, 4] });
    }
    const l = labels[k], lx = X(lay.colX(k));
    chrome.push({ t: "text", x: lx, y: titleH + 25, text: l.main, size: 13.5, weight: 700, color: P.ink });
    chrome.push({ t: "text", x: lx + PFImage.measure(l.main, 13.5, 700) + 8, y: titleH + 25, text: lay.mode === "semester" ? `${l.band.toLowerCase()} · ${l.sub}` : l.sub, size: 11, color: P.ink3 });
    chrome.push({ t: "text", x: lx + D.colW, y: titleH + 25, text: String(l.n), size: 11, color: P.ink3, anchor: "end" });
  }
  chrome.push({ t: "path", d: `M0,${top - 0.5} H${W}`, stroke: P.rule2, sw: 1 });

  // links: plain first, highlighted on top
  const edgeOps = [], hiOps = [];
  lay.edges.forEach((e, i) => {
    const hc = trees.edges.has(i) ? P.h[trees.edges.get(i)] : null;
    const onPath = !!path && path.needed.has(e.from) && path.needed.has(e.to);
    const lit = hc || (onPath ? P.goal : null);
    const color = e.kind === "back" ? P.back : lit || P.edge;
    const a = (dim && !hc) || (path && !onPath) ? 0.2 : 1;
    const dash = e.kind === "back" ? [2, 3] : e.alt ? [5, 4] : null;
    const list = lit ? hiOps : edgeOps;
    list.push({ t: "path", d: shiftPath(e.d, -cx, top - cy), stroke: color, sw: lit ? 2 : 1.2, dash, a });
    list.push({ t: "arrow", x: X(e.arrow.x), y: Y(e.arrow.y), dir: e.arrow.dir, color, size: lit ? 8 : 7, a });
  });
  ops.push(...edgeOps, ...hiOps);

  // cards
  for (const c of lay.visible) {
    const n = lay.nodes.get(c.code);
    const x = X(n.x), y = Y(n.y);
    if (x > W || x + n.w < 0 || y > top + chH || y + n.h < top) continue;
    const tc = trees.cards.get(c.code);
    const hc = tc ? P.h[tc[0]] : null;
    const pc = PI ? planCard(c.code, PI, goals, path, P) : null;
    const a = Math.min(dim && !hc ? 0.28 : 1, pc ? pc.a : 1);
    if (pc && pc.ring) ops.push({ t: "rect", x: x - 3, y: y - 3, w: n.w + 6, h: n.h + 6, r: 13, stroke: pc.ring, sw: 3, a: 0.32 * a });
    ops.push({ t: "rect", x, y, w: n.w, h: n.h, r: 10, fill: P.card, a });
    if (hc) ops.push({ t: "rect", x, y, w: n.w, h: n.h, r: 10, fill: hc, a: 0.1 });
    else if (pc && pc.tint) ops.push({ t: "rect", x, y, w: n.w, h: n.h, r: 10, fill: pc.tint, a: 0.1 * a });
    const border = hc || (pc && pc.border) || P.rule;
    ops.push({ t: "rect", x, y, w: n.w, h: n.h, r: 10, stroke: border, sw: trees.roots.has(c.code) ? 2.2 : pc && !hc ? pc.sw : 1, dash: !hc && pc ? pc.dash : null, a: a * (!hc && pc ? pc.ba : 1) });
    ops.push({ t: "text", x: x + 10, y: y + 19, text: c.code, size: 12.5, weight: 700, color: hc || P.ink, a });
    if (pc && pc.badge) { // the plan badge takes the corner, as on screen
      const bw = PFImage.measure(pc.badge, 10, 700) + 12;
      ops.push({ t: "rect", x: x + n.w - 7 - bw, y: y + 7, w: bw, h: 15, r: 7.5, fill: pc.badgeColor, a: 0.16 * a });
      ops.push({ t: "text", x: x + n.w - 13, y: y + 18, text: pc.badge, size: 10, weight: 700, color: pc.badgeColor, anchor: "end", a });
    } else if (!PI) {
      let xr = x + n.w - 10;
      if (c.programs.length > 1) {
        ops.push({ t: "text", x: xr, y: y + 19, text: `×${c.programs.length}`, size: 10.5, color: P.ink3, anchor: "end", a });
        xr -= PFImage.measure(`×${c.programs.length}`, 10.5) + 6;
      }
      const rq = ruleTag(c);
      if (rq) {
        const tw = PFImage.measure(rq.text, 10) + 10;
        ops.push({ t: "rect", x: xr - tw, y: y + 8, w: tw, h: 14, r: 4, stroke: P.rule, sw: 1, a });
        ops.push({ t: "text", x: xr - 5, y: y + 18.5, text: rq.text, size: 10, color: P.ink3, anchor: "end", a });
      }
    }
    PFImage.wrap(c.name, n.w - 20, 11, 400, 2).forEach((line, i) => ops.push({ t: "text", x: x + 10, y: y + 36 + i * 15, text: line, size: 11, color: pc && pc.done ? P.ink3 : P.ink2, a }));
    if (tc) tc.forEach((ci, i) => ops.push({ t: "rect", x: x + n.w - 6 - 10 * (tc.length - i), y: y + n.h - 12, w: 7, h: 7, r: 3.5, fill: P.h[ci] }));
  }
  ops.push(...chrome);

  // the goal path, step by step, under the chart
  if (band.length) {
    const by = top + chH;
    ops.push({ t: "rect", x: 0, y: by, w: W, h: bandH, fill: P.head });
    ops.push({ t: "path", d: `M0,${by + 0.5} H${W}`, stroke: P.rule2, sw: 1 });
    band.forEach((l, i) => {
      const ly = by + 26 + i * 18;
      if (l.label) ops.push({ t: "text", x: D.padL, y: ly, text: l.label, size: 11.5, weight: 700, color: l.head ? P.ink3 : P.goal, ls: l.head ? 1.2 : 0 });
      ops.push({ t: "text", x: D.padL + 120, y: ly, text: l.text, size: 11.5, weight: l.head ? 700 : 400, color: l.head ? P.ink : l.note ? P.ink3 : P.ink2 });
    });
  }

  // title block
  if (o.title) {
    const prog = state.filter ? (state.filter === MANUAL ? "Added by hand" : shortProg(state.filter)) : state.programs.length > 1 ? `All ${state.programs.length} programs` : state.programs.length ? shortProg(state.programs[0]) : "Courses";
    const what = scope.id === "trees" ? `highlighted trees: ${state.highlights.filter(h => lay.nodes.has(h.code)).map(h => `${h.code} (${DIRS[h.dir]})`).join(", ")}`
      : scope.id === "chain" ? `prerequisite chain of ${state.selected}` : scope.id === "window" ? "visible area"
      : scope.id === "path" ? `goal path to ${goals.goals.join(", ")}` : PI ? "full sheet with plan" : "full sheet";
    ops.push({ t: "rect", x: 0, y: 0, w: W, h: titleH, fill: P.head });
    ops.push({ t: "path", d: `M0,${titleH - 0.5} H${W}`, stroke: P.rule2, sw: 1 });
    const pre = "PREREQ", sl = "/";
    ops.push({ t: "text", x: D.padL, y: 32, text: pre, size: 19, weight: 700, color: P.ink, ls: 3 });
    const x1 = D.padL + PFImage.measure(pre, 19, 700) + 6 * 3;
    ops.push({ t: "text", x: x1, y: 32, text: sl, size: 19, color: P.accent });
    ops.push({ t: "text", x: x1 + PFImage.measure(sl, 19) + 3, y: 32, text: "FLOW", size: 19, weight: 700, color: P.ink, ls: 3 });
    ops.push({ t: "text", x: D.padL, y: 54, text: `${prog} · ${what}`, size: 12.5, color: P.ink2 });
    const planLine = PI ? ` · ${PI.count} completed (${PI.credits} credit hours) · ${view.visible.filter(v => PI.status.get(v.code).state === "ready").length} available now${goals && goals.needed.size ? ` · ${goals.needed.size} to go for ${plural(goals.goals.length, "goal")}` : ""}` : "";
    ops.push({ t: "text", x: D.padL, y: 72, text: `${lay.mode === "free" ? "free flow" : "by semester"} · ${plural(lay.visible.length, "course")} · ${plural(lay.edges.length, "link")}${planLine} · ${today()}`, size: 11.5, color: P.ink3 });
    // credit badge, top right
    const by = "made by areeb";
    const bw = Math.max(PFImage.measure(by, 16, 700), PFImage.measure(SITE, 13, 400)) + 32;
    if (W - bw - D.padR > 360) {
      const bx = W - D.padR - bw, byy = 16;
      ops.push({ t: "rect", x: bx, y: byy, w: bw, h: 54, r: 12, fill: P.accent, a: 0.12 });
      ops.push({ t: "rect", x: bx, y: byy, w: bw, h: 54, r: 12, stroke: P.accent, sw: 1.2, a: 0.7 });
      ops.push({ t: "text", x: bx + 16, y: byy + 23, text: by, size: 16, weight: 700, color: P.ink });
      ops.push({ t: "text", x: bx + 16, y: byy + 42, text: SITE, size: 13, color: P.accent });
    }
  }

  // footer: legend (with the title block) and the credit, always
  const fy = H - footH, ly = fy + footH / 2 + 4;
  ops.push({ t: "rect", x: 0, y: fy, w: W, h: footH, fill: P.head });
  ops.push({ t: "path", d: `M0,${fy + 0.5} H${W}`, stroke: P.rule2, sw: 1 });
  const creditW = PFImage.measure("made by areeb · ", 12.5, 700) + PFImage.measure(SITE, 12.5, 400);
  ops.push({ t: "text", x: W - D.padR - PFImage.measure(SITE, 12.5, 400), y: ly, text: SITE, size: 12.5, color: P.accent });
  ops.push({ t: "text", x: W - D.padR - creditW, y: ly, text: "made by areeb · ", size: 12.5, weight: 700, color: P.ink2 });
  if (o.title) {
    let lx = D.padL;
    const room = W - D.padR - creditW - 24;
    const item = (draw, text) => {
      const w = 34 + PFImage.measure(text, 11.5, 400);
      if (lx + w > room) return;
      draw(lx); lx += 34;
      ops.push({ t: "text", x: lx, y: ly, text, size: 11.5, color: P.ink3 });
      lx += w - 34 + 24;
    };
    if (PI) { // plan first: it's what this image is about
      const sw = (x, extra) => ops.push({ t: "rect", x: x + 5, y: ly - 10, w: 16, h: 11, r: 3, fill: P.card, ...extra });
      item(x => { sw(x, {}); ops.push({ t: "rect", x: x + 5, y: ly - 10, w: 16, h: 11, r: 3, fill: P.ok, a: 0.18 }); ops.push({ t: "rect", x: x + 5, y: ly - 10, w: 16, h: 11, r: 3, stroke: P.ok, sw: 1.5, a: 0.7 }); }, "completed");
      item(x => { sw(x, {}); ops.push({ t: "rect", x: x + 3, y: ly - 12, w: 20, h: 15, r: 5, stroke: P.accent, sw: 2, a: 0.32 }); ops.push({ t: "rect", x: x + 5, y: ly - 10, w: 16, h: 11, r: 3, stroke: P.accent, sw: 1.5 }); }, "available now");
      if (goals) item(x => { sw(x, {}); ops.push({ t: "rect", x: x + 5, y: ly - 10, w: 16, h: 11, r: 3, stroke: P.goal, sw: 1.5, dash: [3, 2] }); }, "goal path");
      if (path) item(x => ops.push({ t: "path", d: `M${x},${ly - 4} H${x + 26}`, stroke: P.goal, sw: 2 }), "path link");
    }
    item(x => ops.push({ t: "path", d: `M${x},${ly - 4} H${x + 26}`, stroke: P.ink2, sw: 1.5 }), "required");
    item(x => ops.push({ t: "path", d: `M${x},${ly - 4} H${x + 26}`, stroke: P.ink2, sw: 1.5, dash: [4, 3] }), "either / or");
    if (lay.edges.some(e => e.kind === "back")) item(x => ops.push({ t: "path", d: `M${x},${ly - 4} H${x + 26}`, stroke: P.back, sw: 1.5, dash: [2, 3] }), "listed out of order");
    if (lay.mode === "free") item(x => ops.push({ t: "path", d: `M${x},${ly - 4} H${x + 26}`, stroke: P.ink3, sw: 1 }), "prerequisites always sit to the left");
  }
  return { width: W, height: H, bg: P.sheet, ops };
}
// how a card looks in plan mode (mirrors the p-* classes in css/style.css)
function planCard(code, PI, goals, path, P) {
  const st = PI.status.get(code);
  if (!st) return null;
  const goal = !!goals && goals.goals.includes(code), step = goals && goals.step.get(code);
  const out = { a: 1, sw: 1, ba: 1, dash: null, border: null, ring: null, tint: null, badge: "", badgeColor: P.ink3, done: st.state === "done" };
  if (st.state === "done") Object.assign(out, { tint: P.ok, border: P.ok, ba: 0.6 });
  else if (st.state === "ready") Object.assign(out, { border: P.accent, sw: 1.4, ring: P.accent });
  else out.a = 0.6;
  if (goal) Object.assign(out, { a: 1, border: P.goal, ba: 1, sw: 1.8, ring: P.goal });
  else if (step) Object.assign(out, { a: 1, border: P.goal, ba: 1, sw: 1.4, dash: [4, 3] });
  else if (path && st.state !== "done") out.a = 0.38;
  if (goal) Object.assign(out, { badge: step ? `◎ goal · ${step}` : st.state === "done" ? "◎ ✓ done" : "◎ goal", badgeColor: P.goal });
  else if (st.state === "done") Object.assign(out, { badge: "✓ done", badgeColor: P.ok });
  else if (step) Object.assign(out, { badge: `step ${step}`, badgeColor: P.goal });
  else if (st.state === "ready") Object.assign(out, { badge: "available", badgeColor: P.accent });
  else if (st.creditsShort) out.badge = `${PI.credits}/${st.minCredits} cr`;
  else if (st.years && st.years.left.length) out.badge = `${st.years.left.length} left`;
  return out;
}
// the goal path as lines of text for the band under an exported chart
function planBand(goals, maxW) {
  if (!goals || !goals.goals.length) return [];
  const lines = [{ label: "GOAL PATH", text: `◎ ${goals.goals.join(", ")} · ${goals.needed.size ? `${plural(goals.needed.size, "course")} to go in ${plural(goals.steps.length, "step")}` : "nothing left to take"}`, head: true }];
  const fit = (codes, label) => { // codes never break across lines
    let cur = "";
    for (const c of codes) {
      const next = cur ? `${cur}, ${c}` : c;
      if (cur && PFImage.measure(next, 11.5) > maxW) { lines.push({ label, text: cur + "," }); label = ""; cur = c; } else cur = next;
    }
    if (cur) lines.push({ label, text: cur });
  };
  const P = planInfo();
  goals.steps.forEach((list, i) => fit(list, `Step ${i + 1}${i === 0 && list.every(x => P.status.get(x).state === "ready") ? " · now" : ""}`));
  if (goals.doneGoals.length) lines.push({ label: "", text: `Already completed: ${goals.doneGoals.join(", ")}`, note: true });
  for (const [code, n] of goals.short) lines.push({ label: "", text: `${code} needs ${PFPlan.rules(state.courses.get(code)).minCredits} credit hours: ${plural(n, "more course")} (electives count) before it`, note: true });
  return lines;
}
// move every x,y pair of an SVG path by (dx, dy)
function shiftPath(d, dx, dy) {
  const r = v => Math.round(v * 10) / 10;
  return d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (m, x, y) => `${r(+x + dx)},${r(+y + dy)}`);
}

async function runImageExport() {
  const o = imageOptions();
  const btn = $("#imgGo");
  btn.disabled = true;
  $("#imgStatus").innerHTML = `<span class="spin"></span>rendering…`;
  try {
    const spec = buildImageSpec(o);
    const scope = (o.scope === "trees" ? "-trees" : o.scope === "chain" ? `-${slug(state.selected || "chain")}` : o.scope === "window" ? "-area" : o.scope === "path" ? "-goal-path" : "")
      + (o.plan && o.scope !== "path" ? "-plan" : "");
    const base = `${fileBase(true)}${scope}-${state.mode}`;
    if (o.format === "svg") {
      const fonts = await fontData();
      saveBlob(new Blob([PFImage.toSVG(spec, fonts)], { type: "image/svg+xml;charset=utf-8" }), base + ".svg");
      showToast(`Downloaded ${esc(base)}.svg${fonts.length ? "" : " · font not embedded (open the page over http to embed mononoki)"}`, 5000);
    } else {
      const res = await PFImage.toPNG(spec, o.scale);
      saveBlob(res.blob, base + ".png");
      showToast(`Downloaded ${esc(base)}.png · ${res.w.toLocaleString()} × ${res.h.toLocaleString()} px`, 5000);
    }
    closeDialog("#imageDlg");
  } catch (e) {
    $("#imgStatus").textContent = (e && e.message) || String(e);
    $("#imgStatus").classList.add("err");
    return;
  } finally {
    btn.disabled = false;
  }
  $("#imgStatus").textContent = "";
}
let fontCache = null;
async function fontData() {
  if (fontCache) return fontCache;
  try {
    fontCache = await Promise.all(PFImage.FONT_FILES.map(async f => {
      const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { weight: f.weight, base64: btoa(s) };
    }));
  } catch (e) { fontCache = []; }
  return fontCache;
}

// ───────────────────────── events ─────────────────────────
function choose() { const fi = $("#fileInput"); fi.value = ""; fi.click(); }
function openImport(tab = "paste") {
  setTab(tab);
  if (!rows.length) rows = [newRow()];
  renderRows();
  openDialog("#importDlg");
  if (tab === "paste") setTimeout(() => focusRow(rows[rows.length - 1].id), 0);
}
function setTab(tab) {
  const paste = tab === "paste";
  $("#tabFiles").setAttribute("aria-selected", String(!paste));
  $("#tabPaste").setAttribute("aria-selected", String(paste));
  $("#paneFiles").hidden = paste;
  $("#panePaste").hidden = !paste;
  $("#pasteFooter").hidden = !paste;
}
function setMode(mode) {
  if (mode === state.mode) return;
  // keep the pinned (or centred) course in view across the switch
  const anchor = state.selected || centreCourse();
  state.mode = mode;
  persist();
  syncControls();
  renderChart();
  if (anchor && view.nodes.has(anchor)) scrollToCard(anchor); else fitAll(false);
}
function centreCourse() {
  if (!view) return null;
  const vp = $("#viewport");
  const cx = (vp.scrollLeft + vp.clientWidth / 2) / zoom, cy = (vp.scrollTop + vp.clientHeight / 2) / zoom;
  let best = null, bd = Infinity;
  for (const n of view.nodes.values()) {
    const d = Math.hypot(n.x + n.w / 2 - cx, n.y + n.h / 2 - cy);
    if (d < bd) { bd = d; best = n.code; }
  }
  return best;
}
// Motion and theme are shared settings (/design/ui.js) when that loaded: the change is
// saved there and comes back through SiteDesign.onChange. Offline they're local.
const shared = window.SiteDesign && SiteDesign.open ? SiteDesign : null;
function setMotion(on, remember = true) {
  if (remember && shared) { shared.set({ motion: on }); return; }
  if (on) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = "off";
  $("#zMotion").setAttribute("aria-pressed", String(on));
  syncFloat();
  if (remember) try { localStorage.setItem("prereqflow.motion", on ? "on" : "off"); } catch (e) { /* not remembered */ }
}
function setTheme(t, remember = true) {
  document.documentElement.dataset.theme = t;
  $("#btnTheme").textContent = t === "light" ? "Dark" : "Light";
  if (remember) try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* not remembered */ }
}

if (PDF_IMPORT) $("#fileInput").accept += ",.pdf,application/pdf";
$("#fileInput").addEventListener("change", e => importFiles(e.target.files));
document.addEventListener("click", e => {
  const a = e.target.closest("[data-action]");
  if (a) {
    const act = a.dataset.action;
    if (act === "choose") choose(); else if (act === "paste") openImport("paste"); else if (act === "home") openWelcome();
    return;
  }
  const cl = e.target.closest("[data-close]");
  if (cl) { const o = cl.closest(".overlay"); if (o) closeDialog("#" + o.id); return; }
  if (e.target.classList && e.target.classList.contains("overlay") && e.target.id !== "welcomeDlg") { closeDialog("#" + e.target.id); return; }
  if (!e.target.closest(".menu-wrap")) closeMenu();
});

// start screen
$("#wDefault").addEventListener("click", () => loadDefault($("#wProgram").value));
$("#wLines").addEventListener("click", () => { replaceOnImport = true; closeDialog("#welcomeDlg"); openImport("paste"); });
$("#wFile").addEventListener("click", () => { replaceOnImport = true; choose(); });
$("#wResumeBtn").addEventListener("click", () => {
  const saved = readSaved();
  if (!saved) return;
  loadSnapshot(saved.data);
  replaceOnImport = false;
  closeDialog("#welcomeDlg");
  render();
  fitAll(false);
});
$("#btnHome").addEventListener("click", openWelcome);

// toolbar
$("#btnImport").addEventListener("click", () => { replaceOnImport = false; openImport("paste"); });
$("#tabFiles").addEventListener("click", () => setTab("files"));
$("#tabPaste").addEventListener("click", () => { setTab("paste"); setTimeout(() => focusRow(rows[rows.length - 1].id), 0); });
$("#btnAdd").addEventListener("click", () => openEdit(null));
if (shared) shared.onChange(s => setMotion(s.motion, false));
else {
  $("#btnTheme").hidden = false;
  $("#btnTheme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
}
$("#modeSeg").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
$("#planSeg").addEventListener("click", e => { const b = e.target.closest("[data-plan]"); if (b && (b.dataset.plan === "1") !== plan.on) setPlanOn(b.dataset.plan === "1"); });
$("#brushSeg").addEventListener("click", e => { const b = e.target.closest("[data-brush]"); if (b) setBrush(b.dataset.brush); });
$("#btnPlanPanel").addEventListener("click", () => {
  const show = !(plan.panel && !state.selected);
  plan.panel = show;
  savePlan();
  if (state.selected) select(null); else { renderDetails(); applyHighlight(); }
  syncPlanbar();
});
$("#btnUndoImport").addEventListener("click", () => {
  if (!lastUndo) return;
  const u = lastUndo;
  lastUndo = null;
  closeDialog("#reportDlg");
  restoreUndo(u, "Import undone");
});
$("#btnExport").addEventListener("click", () => ($("#exportMenu").hidden ? openMenu() : closeMenu()));
$("#exportMenu").addEventListener("click", e => {
  if (e.target.closest("[data-img]")) { openImageDlg(); return; }
  const b = e.target.closest("[data-dl]");
  if (b) download(b.dataset.dl, !!b.dataset.only);
});
$("#btnCopy").addEventListener("click", () => {
  const ta = $("#copyText");
  const done = () => showToast("Copied to clipboard");
  const fallback = () => { ta.focus(); ta.select(); showToast("Selected · press Ctrl+C (⌘C) to copy"); };
  try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch (e) { fallback(); }
});
$("#imageForm").addEventListener("change", updateImageDims);
$("#imageForm").addEventListener("submit", e => { e.preventDefault(); runImageExport(); });
$("#imgGo").addEventListener("click", runImageExport);

$("#programFilter").addEventListener("change", e => {
  state.filter = e.target.value; state.hovered = null;
  persist();
  renderChart(); renderTrees(); renderDetails();
  fitAll(false);
});
$("#semCount").addEventListener("change", e => { state.semCount = +e.target.value; persist(); render(); });
$("#search").addEventListener("input", e => { state.query = e.target.value; applyHighlight(); });
$("#search").addEventListener("keydown", e => {
  if (e.key === "Enter" && view) {
    const q = state.query.trim();
    const hit = q && view.visible.filter(c => matchesQuery(c, q)).sort((a, b) => a.semester - b.semester || cmpCode(a.code, b.code))[0];
    if (hit) select(hit.code, { scroll: true });
  } else if (e.key === "Escape") { e.target.value = ""; state.query = ""; applyHighlight(); }
});

// trees strip
$("#trees").addEventListener("click", e => {
  const x = e.target.closest("[data-untree]");
  if (x) { setHighlight(x.dataset.untree, null); return; }
  if (e.target.closest("#treeDim")) { state.dimOthers = !state.dimOthers; persist(); renderTrees(); applyHighlight(); return; }
  if (e.target.closest("#treeZoom")) { zoomToCodes(state.highlights.flatMap(treeCodes)); return; }
  if (e.target.closest("#treeClear")) {
    const undo = state.highlights.slice();
    state.highlights = []; treeCache = null; persist(); renderTrees(); renderDetails(); applyHighlight();
    showToast("Cleared tree highlights", 4000, { label: "Undo", run: () => { state.highlights = undo; treeCache = null; persist(); renderTrees(); renderDetails(); applyHighlight(); } });
    return;
  }
  const t = e.target.closest("[data-tree]");
  if (t && !t.dataset.off) { const h = state.highlights.find(h => h.code === t.dataset.tree); if (h) zoomToCodes(treeCodes(h)); }
});

// cards
let suppressClick = false;
const cards = $("#cards");
cards.addEventListener("pointerover", e => {
  if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
  if (pan) return;
  const c = e.target.closest(".card");
  const code = c ? c.dataset.code : null;
  if (code !== state.hovered) { state.hovered = code; applyHighlight(); }
});
cards.addEventListener("animationend", e => { if (e.animationName === "rise") e.target.classList.remove("rise"); });
cards.addEventListener("pointerleave", () => { if (state.hovered) { state.hovered = null; applyHighlight(); } });
cards.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; return; }
  const c = e.target.closest(".card");
  if (!c) { if (state.selected) select(null); return; }
  if (e.shiftKey) { setHighlight(c.dataset.code, state.highlights.some(h => h.code === c.dataset.code) ? null : "pre"); return; }
  if (plan.on && plan.brush === "done") { toggleDone(c.dataset.code); return; }
  if (plan.on && plan.brush === "goal") { toggleGoal(c.dataset.code); return; }
  select(state.selected === c.dataset.code ? null : c.dataset.code, { fromCard: true });
});
cards.addEventListener("dblclick", e => {
  const c = e.target.closest(".card");
  if (!c || e.shiftKey || (plan.on && plan.brush !== "pin")) return; // in plan mode a double-click is two marks
  clearTimeout(drawerTimer); select(c.dataset.code); openEdit(c.dataset.code);
});
cards.addEventListener("focusin", e => { const c = e.target.closest(".card"); if (c && c.matches(":focus-visible")) { state.hovered = c.dataset.code; applyHighlight(); } });
cards.addEventListener("focusout", () => { if (state.hovered) { state.hovered = null; applyHighlight(); } });

$("#details").addEventListener("click", e => {
  const g = e.target.closest("[data-goto]");
  if (g) { select(g.dataset.goto, { scroll: true }); return; }
  const hlb = e.target.closest("[data-hl]");
  if (hlb) { setHighlight(state.selected, hlb.dataset.hl); return; }
  if (e.target.closest("#dZoom")) { const s = state.selected; zoomToCodes([...closure(s, view.preds), ...closure(s, view.succs)]); return; }
  if (e.target.closest("#dClose")) {
    if (!state.selected) { plan.panel = false; savePlan(); renderDetails(); syncPlanbar(); return; }
    if (plan.on) { plan.panel = false; savePlan(); }
    select(null); syncPlanbar(); return;
  }
  if (e.target.closest("#dBack")) { plan.panel = true; savePlan(); select(null); syncPlanbar(); return; }
  if (e.target.closest("#dDone")) { toggleDone(state.selected); return; }
  if (e.target.closest("#dGoal")) { toggleGoal(state.selected); return; }
  const ug = e.target.closest("[data-ungoal]");
  if (ug) { plan.goals = plan.goals.filter(g => g !== ug.dataset.ungoal); planChanged(); return; }
  if (e.target.closest("#pClearGoals")) {
    const undo = plan.goals.slice();
    plan.goals = []; planChanged();
    showToast("Cleared goals", 5000, { label: "Undo", run: () => { plan.goals = undo; planChanged(); } });
    return;
  }
  const cd = e.target.closest("#pClearDone");
  if (cd) {
    arm(cd, `Clear all ${plan.completed.size}?`, () => {
      const undo = new Set(plan.completed);
      plan.completed.clear(); planChanged();
      showToast("Cleared completed courses", 6000, { label: "Undo", run: () => { plan.completed = undo; planChanged(); } });
    });
    return;
  }
  if (e.target.closest("#dEdit")) { openEdit(state.selected); return; }
  const del = e.target.closest("#dDelete");
  if (del) arm(del, "Confirm delete", () => deleteCourse(state.selected));
});

$("#fSave").addEventListener("click", saveEdit);
$("#editForm").addEventListener("submit", e => { e.preventDefault(); saveEdit(); });
$("#fDelete").addEventListener("click", e => arm(e.currentTarget, "Click again to delete", () => { const c = editing; closeDialog("#editDlg"); deleteCourse(c); }));

// zoom controls
$("#zIn").addEventListener("click", () => zoomBy(1.3));
$("#zOut").addEventListener("click", () => zoomBy(1 / 1.3));
$("#zPct").addEventListener("click", () => zoomBy(1 / zoom));
$("#zMotion").addEventListener("click", () => setMotion(document.documentElement.dataset.motion === "off"));
$("#zFit").addEventListener("click", () => fitAll());
const vp = $("#viewport");
vp.addEventListener("scroll", () => { requestAnimationFrame(renderColhead); scheduleCull(); }, { passive: true });
// The wheel zooms around the pointer. Shift+wheel keeps the browser's own sideways
// scroll; a sideways trackpad swipe pans; a trackpad pinch (ctrl+wheel) zooms finer.
vp.addEventListener("wheel", e => {
  if (e.shiftKey) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.clientHeight : 1;
  const dx = e.deltaX * unit, dy = e.deltaY * unit;
  if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) { stopAnim(); vp.scrollLeft += dx; return; }
  const r = vp.getBoundingClientRect();
  const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
  const d = Math.max(-150, Math.min(150, dy));
  if (e.ctrlKey) { stopAnim(); setZoom(zoom * Math.exp(-d * 0.01), anchor); }
  else zoomBy(Math.exp(-d * 0.0024), anchor);
}, { passive: false });

// drag to pan; shift+drag draws a box to zoom into
let pan = null;
vp.addEventListener("pointerdown", e => {
  if (e.button !== 0 || e.pointerType === "touch") return;
  const r = vp.getBoundingClientRect();
  if (e.clientX - r.left > vp.clientWidth || e.clientY - r.top > vp.clientHeight) return; // scrollbars
  pan = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop, box: e.shiftKey && !e.target.closest(".card"), moved: false, id: e.pointerId };
});
vp.addEventListener("pointermove", e => {
  if (!pan || e.pointerId !== pan.id) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 5) return;
  if (!pan.moved) {
    pan.moved = true;
    stopAnim();
    vp.setPointerCapture(e.pointerId);
    vp.classList.add(pan.box ? "boxing" : "panning");
    if (state.hovered) { state.hovered = null; applyHighlight(); }
  }
  if (pan.box) {
    const sr = $("#stage").getBoundingClientRect();
    const m = $("#marquee");
    m.hidden = false;
    Object.assign(m.style, { left: Math.min(pan.x, e.clientX) - sr.left + "px", top: Math.min(pan.y, e.clientY) - sr.top + "px", width: Math.abs(dx) + "px", height: Math.abs(dy) + "px" });
  } else {
    vp.scrollLeft = pan.sl - dx;
    vp.scrollTop = pan.st - dy;
  }
});
const endPan = e => {
  if (!pan || (e && e.pointerId !== pan.id)) return;
  const p = pan;
  pan = null;
  vp.classList.remove("panning", "boxing");
  $("#marquee").hidden = true;
  if (!p.moved) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (p.box && e && e.type === "pointerup") {
    const r = vp.getBoundingClientRect();
    const toWorld = (cx, cy) => [(vp.scrollLeft + cx - r.left) / zoom, (vp.scrollTop + cy - r.top) / zoom];
    const [x0, y0] = toWorld(Math.min(p.x, e.clientX), Math.min(p.y, e.clientY));
    const [x1, y1] = toWorld(Math.max(p.x, e.clientX), Math.max(p.y, e.clientY));
    if (x1 - x0 > 20 && y1 - y0 > 20) fitRect(x0, y0, x1, y1, { maxZ: Z.max, pad: 8 });
  }
};
vp.addEventListener("pointerup", endPan);
vp.addEventListener("pointercancel", endPan);
vp.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; e.stopPropagation(); return; }
  if (!e.target.closest(".card") && state.selected) select(null);
}, true);

// two-finger pinch on touch screens
let pinch = null;
const touchDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
vp.addEventListener("touchstart", e => {
  if (e.touches.length === 2) { pinch = { d: touchDist(e.touches), z: zoom }; e.preventDefault(); }
}, { passive: false });
vp.addEventListener("touchmove", e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
  setZoom(pinch.z * touchDist(e.touches) / pinch.d, { x: mx, y: my });
}, { passive: false });
vp.addEventListener("touchend", e => { if (e.touches.length < 2) pinch = null; });

window.addEventListener("resize", () => { sizeWorld(); renderColhead(); });

// line input rows
const prowsEl = $("#prows");
prowsEl.addEventListener("paste", onRowsPaste);
prowsEl.addEventListener("input", e => {
  const rowEl = e.target.closest(".prow");
  if (!rowEl) return;
  const r = rowById(rowEl.dataset.id);
  if (!r) return;
  if (e.target.classList.contains("ptext")) { r.text = e.target.value; parseRow(r); }
  else if (e.target.classList.contains("psem")) { const v = parseInt(e.target.value, 10); r.sem = v >= 1 && v <= 16 ? v : null; }
  refreshRow(r);
});
prowsEl.addEventListener("focusout", e => {
  if (!e.target.classList.contains("ptext")) return;
  const r = rowById(e.target.closest(".prow").dataset.id);
  if (r && r.inlineSem && !r.sem) { // "3-2 ELEE 3260U …" → move the label into the Sem box
    const lead = PF.splitLeadingLabel(r.text.trim());
    r.sem = lead.semester; r.text = lead.rest.trim(); parseRow(r);
    e.target.value = r.text;
    const s = e.target.closest(".prow").querySelector(".psem"); s.value = r.sem;
    refreshRow(r);
  }
});
prowsEl.addEventListener("keydown", e => {
  if (!e.target.classList.contains("ptext")) return;
  const id = e.target.closest(".prow").dataset.id;
  const i = rows.findIndex(r => r.id === id);
  if (e.key === "Enter") {
    e.preventDefault();
    const r = newRow("", rows[i].sem);
    rows.splice(i + 1, 0, r);
    renderRows();
    focusRow(r.id);
  } else if (e.key === "Backspace" && !e.target.value && rows.length > 1) {
    e.preventDefault();
    rows.splice(i, 1);
    renderRows();
    focusRow(rows[Math.max(0, i - 1)].id);
  } else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); focusRow(rows[i - 1].id); }
  else if (e.key === "ArrowDown" && i < rows.length - 1) { e.preventDefault(); focusRow(rows[i + 1].id); }
});
prowsEl.addEventListener("click", e => {
  const b = e.target.closest(".prm");
  if (!b) return;
  rows = rows.filter(r => r.id !== b.closest(".prow").dataset.id);
  renderRows();
});
$("#addRow").addEventListener("click", () => { const r = newRow("", rows.length ? rows[rows.length - 1].sem : null); rows.push(r); renderRows(); focusRow(r.id); });
$("#btnAddRows").addEventListener("click", addRowsToPlan);
$("#btnClearRows").addEventListener("click", () => { rows = [newRow()]; skippedLines = []; renderRows(); focusRow(rows[0].id); });

// drag and drop anywhere
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("#dropVeil").hidden = false; });
window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#dropVeil").hidden = true; });
window.addEventListener("drop", e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("#dropVeil").hidden = true;
  importFiles(e.dataTransfer.files);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("#exportMenu").hidden) { closeMenu(); $("#btnExport").focus(); return; }
    const d = topDialog();
    if (d) { if (d.id !== "welcomeDlg" || state.courses.size) closeDialog("#" + d.id); return; }
    if (state.selected) select(null);
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (typing || topDialog() || !state.courses.size) return;
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
  else if ((e.key === "+" || e.key === "=") && !e.ctrlKey && !e.metaKey) zoomBy(1.3);
  else if (e.key === "-" && !e.ctrlKey && !e.metaKey) zoomBy(1 / 1.3);
  else if (e.key === "0") fitAll();
  else if (e.key === "1") zoomBy(1 / zoom);
  else if (e.key === "p" && !e.ctrlKey && !e.metaKey) setPlanOn(!plan.on);
  else if (e.key === "h" && state.selected) setHighlight(state.selected, state.highlights.some(h => h.code === state.selected) ? null : "pre");
});

if (!shared) setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark", false);
setMotion(document.documentElement.dataset.motion !== "off", false);
render();
openWelcome();
})();
