"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const PF = require("../js/parser.js");

test("course line: name, prerequisites, either/or and coreqs", () => {
  const p = PF.parseCourseText("ELEE 3180U Design Principles (ELEE 2250U, ELEE 2530U or MATH 2860U; Coreq: ELEE 3240U)");
  assert.equal(p.kind, "course");
  assert.equal(p.code, "ELEE 3180U");
  assert.equal(p.name, "Design Principles");
  assert.deepEqual(p.prereqs, [["ELEE 2250U"], ["ELEE 2530U", "MATH 2860U"]]);
  assert.deepEqual(p.coreqs, [["ELEE 3240U"]]);
});

test("credit restrictions are kept aside, not drawn", () => {
  const p = PF.parseCourseText("ENGR 1050U Engineering Communications (Credit restrictions: COMM 1050U/SOCI 1470U)");
  assert.deepEqual(p.prereqs, []);
  assert.equal(p.ignored.length, 1);
});

test("elective slots are not courses", () => {
  assert.equal(PF.parseCourseText("Engineering Elective").kind, "elective");
});

test("semester labels set the semester of the lines below", () => {
  const entries = PF.splitEntries("2-1\nMATH 2860U Differential Equations (MATH 1020U)\nYear 3 Semester 2\nELEE 3070U Random Signals (ELEE 3110U)");
  assert.deepEqual(entries.map(e => e.semester), [3, 6]);
});

test("wrapped text collapses to one course per line", () => {
  const entries = PF.splitEntries("SOFE 2715U Data\nStructures (SOFE\n2710U)\nSOFE 2720U Requirements (SOFE 2710U, SOFE 2800U)");
  assert.equal(entries.length, 2);
  assert.equal(PF.parseCourseText(entries[0].text).name, "Data Structures");
});

test("text export round-trips through the line parser", () => {
  const c = { code: "MECE 3350U", name: "Control Systems", prereqs: [["ELEE 2790U", "METE 2010U"], ["MATH 2860U"]], coreqs: [], notes: [], ignored: [] };
  const back = PF.parseCourseText(PF.courseToLine(c));
  assert.deepEqual(back.prereqs, c.prereqs);
  assert.equal(back.name, c.name);
});

test("merging keeps each program's own semester and the fuller either/or group", () => {
  const map = new Map();
  PF.mergeInto(map, [{ code: "MANE 2220U", name: "Materials", semester: 4, prereqs: [["CHEM 1800U"]], coreqs: [], programs: ["A"] }]);
  PF.mergeInto(map, [{ code: "MANE 2220U", name: "Materials", semester: 3, prereqs: [["CHEM 1020U", "CHEM 1800U"]], coreqs: [], programs: ["B"] }]);
  const c = map.get("MANE 2220U");
  assert.equal(c.semester, 3, "the fallback (all-programs view) is the earliest");
  assert.deepEqual(c.semesters, { A: 4, B: 3 });
  assert.equal(PF.semIn(c, "A"), 4);
  assert.equal(PF.semIn(c, "B"), 3);
  assert.deepEqual(c.prereqs, [["CHEM 1020U", "CHEM 1800U"]]);
  assert.deepEqual(c.programs, ["A", "B"]);
});

test("course level never decides a program's semester: a 2000-level course can be in year 3", () => {
  const map = new Map();
  const p = PF.parseCourseText("MECE 2640U Thermodynamics and Heat Transfer (MATH 1020U, PHY 1010U)");
  PF.mergeInto(map, [PF.mkCourse(p, 3, "Automotive")]);
  PF.mergeInto(map, [PF.mkCourse(p, 5, "Mechatronics")]);
  const c = map.get("MECE 2640U");
  assert.equal(PF.semIn(c, "Automotive"), 3);
  assert.equal(PF.semIn(c, "Mechatronics"), 5);
});

test("a program listing a course twice keeps its earliest; an earlier program elsewhere moves no one else", () => {
  const map = new Map();
  // old-format record: one semester for every program it lists
  PF.mergeInto(map, [{ code: "STAT 2800U", name: "Stats", semester: 4, prereqs: [], coreqs: [], programs: ["A", "B"] }]);
  PF.mergeInto(map, [PF.mkCourse({ code: "STAT 2800U", name: "Stats" }, 3, "C")]);
  PF.mergeInto(map, [PF.mkCourse({ code: "STAT 2800U", name: "Stats" }, 6, "A")]);
  const c = map.get("STAT 2800U");
  assert.deepEqual(c.semesters, { A: 4, B: 4, C: 3 });
  assert.equal(c.semester, 3);
});
