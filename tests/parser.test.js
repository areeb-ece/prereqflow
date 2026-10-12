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

test("merging keeps the earliest semester and the fuller either/or group", () => {
  const map = new Map();
  PF.mergeInto(map, [{ code: "MANE 2220U", name: "Materials", semester: 4, prereqs: [["CHEM 1800U"]], coreqs: [], programs: ["A"] }]);
  PF.mergeInto(map, [{ code: "MANE 2220U", name: "Materials", semester: 3, prereqs: [["CHEM 1020U", "CHEM 1800U"]], coreqs: [], programs: ["B"] }]);
  const c = map.get("MANE 2220U");
  assert.equal(c.semester, 3);
  assert.deepEqual(c.prereqs, [["CHEM 1020U", "CHEM 1800U"]]);
  assert.deepEqual(c.programs, ["A", "B"]);
});
