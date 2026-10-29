"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/electives.js");
const PFPlan = require("../js/plan.js");
const L = require("../js/layout.js");
const data = require("../data/ontario-tech-engineering-2026-2027.json");

const P = name => data.programs.find(p => p === name + " 2026-2027") || assert.fail(`no program ${name}`);
const sheet = () => new Map(structuredClone(data.courses).map(c => [c.code, c]));
const electives = () => E.fromData(data.electives);

test("elective slots match the program maps' Engineering Elective boxes", () => {
  // counted from sources/*.pdf (Year 4 Sem 1 = 7, Year 4 Sem 2 = 8)
  const want = {
    "Automotive Engineering": [7, 7, 8, 8], "Electrical Engineering": [7, 7, 7, 7, 8, 8],
    "Electrical Engineering: Smart Grid Specialization": [7, 8], "Energy Engineering": [8, 8, 8],
    "Industrial Engineering": [7, 8], "Manufacturing Engineering": [8], "Mechanical Engineering": [7, 8, 8, 8],
    "Mechanical Engineering: Aerospace Specialization": [8], "Mechanical Engineering: Artificial Intelligence Specialization": [8],
    "Mechatronics Engineering": [7, 7, 8], "Nuclear Engineering": [7, 7, 8, 8, 8], "Software Engineering": [7, 8, 8],
  };
  const el = electives();
  for (const p of data.programs) {
    const short = p.replace(/ 2026-2027$/, "");
    assert.deepEqual(E.slotsIn(el, p), want[short] || [], short);
  }
});

test("electives data: known programs, terms and requirement groups", () => {
  const el = electives();
  assert.equal(el.courses.size, 56);
  for (const o of el.courses.values()) {
    for (const p of [...o.programs, ...o.permission]) assert.ok(data.programs.includes(p), `${o.code}: ${p}`);
    assert.ok(o.programs.length + o.permission.length > 0, o.code);
    for (const p of [...o.programs, ...o.permission]) assert.ok(["fall", "winter", "both"].includes(E.offeredIn(o, p)), `${o.code} in ${p}`);
    for (const g of [...o.prereqs, ...o.coreqs]) assert.ok(g.length && g.every(x => /^[A-Z]{3,4} \d{4}U$/.test(x)), o.code);
  }
  // where the list differs by program, each keeps its own term
  const dsp = el.courses.get("ELEE 4420U");
  assert.equal(E.offeredIn(dsp, P("Electrical Engineering")), "fall");
  assert.equal(E.offeredIn(dsp, P("Electrical Engineering: Smart Grid Specialization")), "winter");
});

test("a slot lists only its program's electives, offered in its term, that the program doesn't already require", () => {
  const el = electives(), courses = sheet();
  for (const p of Object.keys(el.slots)) {
    for (const sem of new Set(E.slotsIn(el, p))) {
      const { list, other } = E.options(el, courses, p, sem);
      for (const x of list) {
        const o = el.courses.get(x.code);
        assert.ok(o.programs.includes(p) || o.permission.includes(p), `${x.code} isn't an elective of ${p}`);
        assert.ok(E.fitsTerm(o, p, sem), `${x.code} isn't offered in ${E.termOf(sem)}`);
        assert.ok(!E.requiredIn(courses.get(x.code), p), `${p} already requires ${x.code}`);
        assert.equal(x.permission, !o.programs.includes(p));
      }
      for (const code of other) assert.ok(!E.fitsTerm(el.courses.get(code), p, sem));
    }
  }
  const nuc = E.options(el, courses, P("Nuclear Engineering"), 7);
  assert.ok(!nuc.list.some(x => x.code === "RADI 3570U"), "Nuclear requires RADI 3570U, so it's no elective there");
  const man = E.options(el, courses, P("Manufacturing Engineering"), 8);
  assert.deepEqual(man.list.map(x => x.code), ["MANE 4700U", "MECE 3210U", "MECE 3390U", "INSE 4248U"]);
  assert.ok(man.other.includes("MANE 4380U"), "a fall-only elective can't fill Manufacturing's winter slot");
  assert.deepEqual(E.options(el, courses, P("Mechanical Engineering: Aerospace Specialization"), 8).list, []);
  assert.ok(!E.options(el, courses, P("Mechatronics Engineering"), 8).list.some(x => x.code === "SOFE 4630U"), "a Software elective isn't offered to Mechatronics");
});

test("choosing puts the course in the slot's semester, in that program only; unchoosing undoes it exactly", () => {
  const el = electives(), courses = sheet();
  const ind = P("Industrial Engineering"), before = structuredClone(courses.get("MECE 2640U"));
  // a course other programs require: Industrial gains it in Year 4 Sem 1, the others keep theirs
  const c = E.choose(courses, el, ind, 7, "MECE 2640U");
  assert.ok(c && c.programs.includes(ind));
  assert.deepEqual(c.electiveIn, [ind]);
  assert.equal(PFPlan.semIn(c, ind), 7);
  for (const p of before.programs) assert.equal(PFPlan.semIn(c, p), PFPlan.semIn(before, p), p);
  assert.equal(c.semester, before.semester);
  assert.deepEqual(E.slotTable(el, courses, ind), [{ sem: 7, total: 1, chosen: ["MECE 2640U"], open: 0 }, { sem: 8, total: 1, chosen: [], open: 1 }]);
  assert.equal(E.unchoose(courses, ind, "MECE 2640U"), false);
  const after = courses.get("MECE 2640U");
  for (const p of before.programs) assert.equal(PFPlan.semIn(after, p), PFPlan.semIn(before, p), p);
  assert.deepEqual(after.programs, before.programs);
  assert.equal(after.electiveIn, undefined);

  // a course only the electives list has: added, then gone again
  const sw = P("Software Engineering");
  assert.ok(!courses.has("ARTE 4110U"));
  const a = E.choose(courses, el, sw, 7, "ARTE 4110U");
  assert.deepEqual({ semester: a.semester, programs: a.programs, prereqs: a.prereqs }, { semester: 7, programs: [sw], prereqs: [["SOFE 3620U"]] });
  assert.equal(E.unchoose(courses, sw, "ARTE 4110U"), true);
  assert.ok(!courses.has("ARTE 4110U"));
});

test("choosing refuses another program's elective, the wrong term and a required course", () => {
  const el = electives(), courses = sheet();
  assert.equal(E.choose(courses, el, P("Mechatronics Engineering"), 7, "SOFE 4630U"), null, "a Software elective");
  assert.equal(E.choose(courses, el, P("Software Engineering"), 7, "SOFE 4630U"), null, "winter course in a fall slot");
  assert.equal(E.choose(courses, el, P("Nuclear Engineering"), 7, "RADI 3570U"), null, "required in Nuclear");
  const iot = P("Software Engineering: IoT Specialization"), was = PFPlan.semIn(courses.get("SOFE 4630U"), iot);
  const c = E.choose(courses, el, P("Software Engineering"), 8, "SOFE 4630U");
  assert.equal(PFPlan.semIn(c, P("Software Engineering")), 8);
  assert.equal(PFPlan.semIn(c, iot), was, "IoT, which requires it, keeps its own semester");
});

test("prerequisites are checked against the program's earlier courses, chosen electives included", () => {
  const el = electives(), courses = sheet(), mt = P("Mechatronics Engineering");
  const find = (sem, code) => E.options(el, courses, mt, sem).list.find(x => x.code === code);
  assert.ok(find(8, "INSE 4248U").prereqs.some(g => g.includes("ENGR 3150U")));
  E.choose(courses, el, mt, 7, "ENGR 3150U");
  assert.ok(!find(8, "INSE 4248U").prereqs.some(g => g.includes("ENGR 3150U")), "ENGR 3150U is now taken in Year 4 Sem 1");
  // a corequisite may share the semester: METE 4500U with METE 4280U (Year 4 Sem 1)
  assert.deepEqual(find(7, "METE 4500U").coreqs, []);
  // and a completed course counts too
  assert.deepEqual(E.options(el, courses, mt, 7, new Set(["ELEE 2210U"])).list.find(x => x.code === "ELEE 3110U").prereqs, []);
  // two fall electives can't be stacked: Automotive's MECE 4210U needs MECE 3420U before Year 4 Sem 1
  const au = P("Automotive Engineering");
  E.choose(courses, el, au, 7, "MECE 3420U");
  assert.deepEqual(E.options(el, courses, au, 7).list.find(x => x.code === "MECE 4210U").prereqs, [["MECE 3420U"]]);
});

test("a chosen elective plans like any course: locked, then on the goal path with its prerequisites", () => {
  const el = electives(), courses = sheet(), mf = P("Manufacturing Engineering");
  E.choose(courses, el, mf, 8, "MANE 4700U");
  const ev = PFPlan.evaluate(courses, new Set(), mf);
  assert.equal(ev.status.get("MANE 4700U").state, "locked");
  const path = PFPlan.plan(courses, new Set(), ["MANE 4700U"], mf);
  for (const x of ["MANE 2220U", "MECE 2860U", "MANE 4700U"]) assert.ok(path.needed.has(x), x);
  const done = new Set(["MANE 2220U", "MECE 2860U"]);
  assert.equal(PFPlan.evaluate(courses, done, mf).status.get("MANE 4700U").state, "ready");
});

test("open slots sit in their semester's column, clear of every card and above Capstone", () => {
  const el = electives(), courses = sheet(), mt = P("Mechatronics Engineering");
  const withRules = c => { const y = PFPlan.rules(c).yearsComplete; return y ? { ...c, yearsComplete: y } : c; };
  const shown = [...courses.values()].filter(c => c.programs.includes(mt)).map(c => ({ ...c, semester: PFPlan.semIn(c, mt) })).map(withRules);
  const slots = E.openSlots(el, courses, mt).map(s => ({ id: `slot:${s.sem}:${s.i}`, semester: s.sem }));
  assert.equal(slots.length, 3);
  const lay = L.compute(shown, { mode: "semester", semCount: 8, slots });
  assert.equal(lay.slots.size, 3);
  const boxes = [...lay.nodes.values(), ...lay.slots.values()];
  for (const s of lay.slots.values()) {
    assert.equal(s.col, s.semester - 1);
    for (const b of boxes) if (b !== s && b.col === s.col) assert.ok(b.y + b.h <= s.y || s.y + s.h <= b.y, `${s.id} overlaps ${b.code || b.id}`);
  }
  const cap = lay.nodes.get("ENGR 4111U");
  for (const s of lay.slots.values()) if (s.col === cap.col) assert.ok(s.y < cap.y, "Capstone stays at the foot, by the bus");
  // free flow has no semesters, so no slots
  assert.equal(L.compute(shown, { mode: "free", slots }).slots.size, 0);
});

test("electives survive the data/export form and merge program by program", () => {
  const el = electives();
  const back = E.fromData(JSON.parse(JSON.stringify(E.toData(el))));
  assert.deepEqual(back.slots, el.slots);
  assert.deepEqual([...back.courses.values()], [...el.courses.values()]);
  const sw = P("Software Engineering");
  const only = E.toData(el, [sw]);
  assert.deepEqual(Object.keys(only.slots), [sw]);
  assert.ok(only.courses.every(c => c.programs.concat(c.permission).every(p => p === sw)));
  assert.equal(only.courses.find(c => c.code === "ELEE 4420U"), undefined);
  // a merge keeps other programs' options and terms
  const m = E.merge(E.fromData(E.toData(el, [P("Electrical Engineering")])), E.fromData(E.toData(el, [P("Electrical Engineering: Smart Grid Specialization")])));
  const dsp = m.courses.get("ELEE 4420U");
  assert.equal(E.offeredIn(dsp, P("Electrical Engineering")), "fall");
  assert.equal(E.offeredIn(dsp, P("Electrical Engineering: Smart Grid Specialization")), "winter");
  assert.deepEqual(E.fromData(null), E.empty());
});
