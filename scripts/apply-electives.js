#!/usr/bin/env node
/* Writes the engineering electives list into the built-in data (`electives.courses`):
 * for each elective, its prerequisites, the programs that may take it (outright or with
 * special permission) and the term it's offered in. Where each program map places its
 * electives (`electives.slots`) comes from the map PDFs (scripts/apply-program-maps.js).
 *
 *   node scripts/apply-electives.js [sources/engineering-electives-2026-2027.json] [--dry-run]
 *   node scripts/build-data.js
 *
 * The list names programs without the year ("Mechanical Engineering (AI Specialization)");
 * each must match exactly one built-in program, or nothing is written. Liberal studies
 * and science electives aren't in the list and aren't offered. */
"use strict";
const fs = require("fs");
const path = require("path");
const PF = require("../js/parser.js");

const DATA = path.join(__dirname, "..", "data", "ontario-tech-engineering-2026-2027.json");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const src = args.find(a => !a.startsWith("--")) || path.join(__dirname, "..", "sources", "engineering-electives-2026-2027.json");
if (!fs.existsSync(src)) {
  console.error("usage: node scripts/apply-electives.js [electives list .json] [--dry-run]");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const list = JSON.parse(fs.readFileSync(src, "utf8"));
if (!list || !Array.isArray(list.courses)) { console.error(`${src} has no courses list`); process.exit(1); }

// "Electrical Engineering (Smart Grid Specialization)" → "Electrical Engineering: Smart Grid Specialization 2026-2027"
const ALIAS = { ai: "artificial intelligence", iot: "iot" };
const norm = s => String(s).toLowerCase().replace(/\s+(?:19|20)\d{2}\s*[-–]\s*(?:19|20)?\d{2}$/, "")
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").map(w => ALIAS[w] || w).join(" ");
const byName = new Map();
for (const p of data.programs) byName.set(norm(p), p);
const problems = [];
const program = name => {
  const p = byName.get(norm(name));
  if (!p) problems.push(`"${name}" doesn't name a built-in program`);
  return p;
};

const groups = gs => PF.dedupeGroups((gs || []).map(g => g.map(PF.normCode).filter(Boolean)).filter(g => g.length));
const out = [];
for (const c of list.courses) {
  const code = PF.normCode(c.code);
  if (!code) { problems.push(`bad course code ${JSON.stringify(c.code)}`); continue; }
  const programs = (c.elective_in || []).map(program).filter(Boolean);
  const permission = (c.special_permission_in || []).map(program).filter(Boolean).filter(p => !programs.includes(p));
  let offered = c.offered;
  if (offered === "conflicting" || c.offered_by_program) {
    offered = {};
    for (const [name, t] of Object.entries(c.offered_by_program || {})) { const p = program(name); if (p) offered[p] = t; }
    const terms = new Set(Object.values(offered));
    if (terms.size === 1) offered = [...terms][0];
  }
  const ok = t => ["fall", "winter", "both"].includes(t);
  if (typeof offered === "string" ? !ok(offered) : !Object.values(offered).every(ok)) problems.push(`${code}: unknown term ${JSON.stringify(c.offered)}`);
  const rec = { code, name: String(c.name || code).trim(), prereqs: groups(c.prerequisites), coreqs: groups(c.corequisites), notes: c.notes ? [String(c.notes)] : [], programs, permission, offered };
  // a course the data already has keeps its name there, and should need the same courses
  const ex = data.courses.find(x => x.code === code);
  if (ex) {
    const key = gs => JSON.stringify(gs.map(g => g.slice().sort()).sort());
    if (key(ex.prereqs) !== key(rec.prereqs) || key(ex.coreqs) !== key(rec.coreqs)) problems.push(`${code}: the list's requirements differ from the program maps' (${PF.requirementText(rec)} vs ${PF.requirementText(ex)}); the maps' are used once it's on the sheet`);
    rec.name = ex.name;
  }
  out.push(rec);
}
out.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

// each program's options, as a check that the slots can be filled
const slots = (data.electives && data.electives.slots) || {};
for (const [p, sems] of Object.entries(slots)) {
  const mine = out.filter(c => c.programs.includes(p) || c.permission.includes(p));
  if (!mine.length) console.log(`  ${p}: ${sems.length} elective slot${sems.length === 1 ? "" : "s"} but no electives listed`);
  else console.log(`  ${p}: ${mine.length} electives for ${sems.length} slot${sems.length === 1 ? "" : "s"}`);
}
if (problems.length) {
  console.log(`\n${problems.length} to check by hand`);
  for (const x of [...new Set(problems)]) console.log("  " + x);
  if (problems.some(x => /doesn't name|bad course|unknown term/.test(x))) { console.error("\nnothing written"); process.exit(1); }
}
if (dry) { console.log("\n--dry-run: nothing written"); process.exit(0); }
data.electives = { slots, courses: out };
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
console.log(`\nwrote ${out.length} electives to ${path.relative(process.cwd(), DATA)}; now run: node scripts/build-data.js`);
