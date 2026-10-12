"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/layout.js");
const data = require("../data/ontario-tech-engineering-2026-2027.json");

const views = [["all programs", data.courses], ...data.programs.map(p => [p, data.courses.filter(c => c.programs.includes(p))])];

test("free flow: every prerequisite sits strictly left of its course", () => {
  for (const [name, courses] of views) {
    const lay = L.compute(courses, { mode: "free" });
    for (const e of lay.edges) {
      assert.ok(lay.nodes.get(e.from).col < lay.nodes.get(e.to).col, `${name}: ${e.from} → ${e.to}`);
      assert.equal(e.kind, "fwd");
    }
  }
});

test("free flow holds for corequisites and cycles in user data too", () => {
  const courses = [
    { code: "AAA 1000U", semester: 5, prereqs: [], coreqs: [] },
    { code: "BBB 2000U", semester: 1, prereqs: [["AAA 1000U"]], coreqs: [["CCC 2000U"]] },
    { code: "CCC 2000U", semester: 1, prereqs: [["AAA 1000U"]], coreqs: [] },
    { code: "DDD 3000U", semester: 2, prereqs: [["EEE 3000U"]], coreqs: [] },
    { code: "EEE 3000U", semester: 2, prereqs: [["DDD 3000U"]], coreqs: [] }, // a cycle
  ];
  const lay = L.compute(courses, { mode: "free" });
  const col = c => lay.nodes.get(c).col;
  assert.ok(col("AAA 1000U") < col("CCC 2000U"));
  assert.ok(col("CCC 2000U") < col("BBB 2000U"));
  const cyc = lay.edges.filter(e => e.from[0] === "D" || e.from[0] === "E");
  assert.equal(cyc.filter(e => e.kind === "back").length, 1, "exactly one link of the cycle is drawn backwards");
});

test("semester layout: columns are semesters", () => {
  const lay = L.compute(data.courses, { mode: "semester", semCount: 8 });
  assert.equal(lay.nCols, 8);
  for (const c of data.courses) assert.equal(lay.nodes.get(c.code).col, c.semester - 1);
});

test("cards never overlap within a column", () => {
  for (const mode of ["semester", "free"]) {
    const lay = L.compute(data.courses, { mode, semCount: 8 });
    for (const col of lay.cols) {
      const ys = col.map(c => lay.nodes.get(c)).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i].y >= ys[i - 1].y + ys[i - 1].h, `${mode}: ${ys[i - 1].code} / ${ys[i].code}`);
    }
  }
});

test("every link has a drawable path ending at an arrow", () => {
  const lay = L.compute(data.courses, { mode: "free" });
  for (const e of lay.edges) {
    assert.match(e.d, /^M[\d.-]+,[\d.-]+ /);
    assert.ok(Number.isFinite(e.arrow.x) && Number.isFinite(e.arrow.y));
  }
});

test("isotonic placement keeps order and spacing", () => {
  const ys = L.placeColumn([10, 0, 50], [1, 1, 1], [20, 20]);
  assert.ok(ys[1] - ys[0] >= 20 - 1e-9 && ys[2] - ys[1] >= 20 - 1e-9);
});

test("built-in data: the .js wrapper matches the .json", () => {
  global.window = {};
  require("../data/ontario-tech-engineering-2026-2027.js");
  assert.deepEqual(global.window.PREREQFLOW_DEFAULT, data);
  delete global.window;
});
