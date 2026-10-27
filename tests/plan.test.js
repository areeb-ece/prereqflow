"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const PFPlan = require("../js/plan.js");
const data = require("../data/ontario-tech-engineering-2026-2027.json");

const all = new Map(data.courses.map(c => [c.code, c]));
const MECH = "Mechanical Engineering 2026-2027";
const ELEC = "Electrical Engineering 2026-2027";
const inProgram = p => data.courses.filter(c => c.programs.includes(p));
const firstYear = p => inProgram(p).filter(c => c.semester <= 2).map(c => c.code);

test("rules come from the notes: credit thresholds and Capstone's years 1–3", () => {
  assert.deepEqual(PFPlan.rules(all.get("ENGR 3360U")), { minCredits: 54, yearsComplete: 0 });
  assert.deepEqual(PFPlan.rules(all.get("ENGR 4760U")), { minCredits: 84, yearsComplete: 0 });
  assert.deepEqual(PFPlan.rules(all.get("ENGR 4111U")), { minCredits: 0, yearsComplete: 3 });
  assert.deepEqual(PFPlan.rules(all.get("ELEE 2250U") || data.courses[0]), { minCredits: 0, yearsComplete: 0 });
});

test("nothing completed: exactly the courses with no prerequisites are available", () => {
  const { status, credits } = PFPlan.evaluate(all, new Set());
  assert.equal(credits, 0);
  for (const c of data.courses) {
    const r = PFPlan.rules(c);
    const free = !c.prereqs.length && !r.minCredits && !r.yearsComplete
      && c.coreqs.every(g => g.some(x => all.has(x) && all.get(x).prereqs.length === 0));
    assert.equal(status.get(c.code).state === "ready", free, c.code);
  }
});

test("completing a prerequisite makes the course that needs it available", () => {
  const target = data.courses.find(c => c.prereqs.length === 1 && c.prereqs[0].length === 1 && !c.coreqs.length && !PFPlan.rules(c).minCredits
    && all.get(c.prereqs[0][0]).prereqs.length === 0);
  const pre = target.prereqs[0][0];
  assert.equal(PFPlan.evaluate(all, new Set()).status.get(target.code).state, "locked");
  assert.equal(PFPlan.evaluate(all, new Set([pre])).status.get(target.code).state, "ready");
  assert.equal(PFPlan.evaluate(all, new Set([pre, target.code])).status.get(target.code).state, "done");
});

test("either/or: one option is enough; options that aren't loaded don't block", () => {
  // MANE 2220U needs CHEM 1020U (not loaded) or CHEM 1800U
  const c = all.get("MANE 2220U");
  const others = c.prereqs.filter(g => !g.includes("CHEM 1800U")).map(g => g.find(x => all.has(x)));
  const st = PFPlan.evaluate(all, new Set(others)).status.get("MANE 2220U");
  assert.deepEqual(st.prereqs, [["CHEM 1020U", "CHEM 1800U"]]);
  assert.equal(PFPlan.evaluate(all, new Set([...others, "CHEM 1800U"])).status.get("MANE 2220U").state, "ready");
});

test("credit thresholds: 18 courses unlock Engineering Economics, 28 unlock Ethics and Law", () => {
  const order = [...data.courses].sort((a, b) => a.semester - b.semester).map(c => c.code).filter(x => x !== "ENGR 3360U" && x !== "ENGR 4760U");
  const at = n => PFPlan.evaluate(all, new Set(order.slice(0, n))).status;
  assert.equal(at(17).get("ENGR 3360U").state, "locked");
  assert.equal(at(17).get("ENGR 3360U").creditsShort, 3);
  assert.equal(at(18).get("ENGR 3360U").state, "ready");
  assert.equal(at(27).get("ENGR 4760U").state, "locked");
  assert.equal(at(28).get("ENGR 4760U").state, "ready");
});

test("completions are global: a shared course done once counts in every program", () => {
  const done = new Set(firstYear(MECH));
  const shared = firstYear(MECH).filter(x => all.get(x).programs.includes(ELEC));
  assert.ok(shared.length > 5);
  const st = PFPlan.evaluate(all, done, ELEC).status;
  for (const x of shared) assert.equal(st.get(x).state, "done");
});

test("capstone: needs every year 1–3 course of the program", () => {
  const years = p => inProgram(p).filter(c => c.semester <= 6).map(c => c.code);
  const done = new Set(years(MECH));
  assert.equal(PFPlan.evaluate(all, done, MECH).status.get("ENGR 4111U").state, "ready");
  // in the all-programs view the program closest to done counts
  assert.equal(PFPlan.evaluate(all, done, "").status.get("ENGR 4111U").state, "ready");
  // with Electrical shown, Mechanical's courses don't cover it
  const elec = PFPlan.evaluate(all, done, ELEC).status.get("ENGR 4111U");
  assert.equal(elec.state, "locked");
  assert.equal(elec.years.program, ELEC);
  assert.ok(elec.years.left.length > 0);
  done.delete(years(MECH)[0]);
  const st = PFPlan.evaluate(all, done, MECH).status.get("ENGR 4111U");
  assert.equal(st.state, "locked");
  assert.deepEqual(st.years.left, [years(MECH)[0]]);
});

test("goal path: steps in prerequisite order, starting with what's available now", () => {
  const goal = "ENGR 4222U"; // Capstone II, after Capstone I, after all of years 1–3
  const done = new Set(firstYear(MECH));
  const P = PFPlan.plan(all, done, [goal], MECH);
  const { status } = PFPlan.evaluate(all, done, MECH);
  assert.ok(P.needed.has(goal) && P.needed.has("ENGR 4111U"));
  for (const x of P.needed) assert.ok(!done.has(x));
  for (const x of P.steps[0]) assert.equal(status.get(x).state, "ready", `${x} in step 1 is available now`);
  assert.equal(P.step.get(goal), P.step.get("ENGR 4111U") + 1);
  // every chosen prerequisite comes in an earlier step
  for (const x of P.needed) {
    for (const g of all.get(x).prereqs) {
      const opts = g.filter(y => P.needed.has(y));
      if (g.some(y => done.has(y)) || !opts.length) continue;
      assert.ok(opts.some(y => P.step.get(y) < P.step.get(x)), `${x} after ${g.join("|")}`);
    }
  }
  assert.ok(P.pools.has("ENGR 4111U"));
});

test("goal path: credit thresholds push a course back until enough courses come first", () => {
  const P = PFPlan.plan(all, new Set(), ["ENGR 3360U"], MECH);
  assert.deepEqual([...P.needed], ["ENGR 3360U"]);
  assert.equal(P.short.get("ENGR 3360U"), 18, "the plan has nothing else, so 18 more courses are needed");
  const done = new Set(firstYear(MECH));
  const P2 = PFPlan.plan(all, done, ["ENGR 4760U", "ENGR 4222U"], MECH);
  const before = [...P2.needed].filter(x => P2.step.get(x) < P2.step.get("ENGR 4760U")).length;
  assert.ok(done.size + before >= 28, "Ethics and Law comes after 28 courses");
  assert.ok(!P2.short.has("ENGR 4760U"));
});

test("goal path: completed goals need nothing", () => {
  const P = PFPlan.plan(all, new Set(["ENGR 1015U"]), ["ENGR 1015U"]);
  assert.equal(P.needed.size, 0);
  assert.deepEqual(P.doneGoals, ["ENGR 1015U"]);
});

test("either/or in a goal path: the option in the shown program wins", () => {
  // Power Systems needs Electric Machines (Electrical) or MECE 3410U (Energy only)
  const done = new Set(firstYear(ELEC));
  const P = PFPlan.plan(all, done, ["ELEE 3260U"], ELEC);
  assert.ok(P.needed.has("ELEE 3250U") && !P.needed.has("MECE 3410U"));
  assert.equal(P.step.get("ELEE 3250U"), P.step.get("ELEE 3260U") - 1, "Electric Machines is the last step before Power Systems");
  for (const x of P.needed) assert.ok(all.get(x).programs.includes(ELEC), `${x} is an Electrical course`);
  assert.ok(P.picks.some(k => k.course === "ELEE 3260U" && k.picked === "ELEE 3250U" && k.over.includes("MECE 3410U")));
  // with Energy shown, Energy's option wins
  const E = PFPlan.plan(all, done, ["ELEE 3260U"], "Energy Engineering 2026-2027");
  assert.ok(E.needed.has("MECE 3410U") && !E.needed.has("ELEE 3250U"));
  // all programs: the option most of Power Systems' programs use
  assert.ok(PFPlan.plan(all, done, ["ELEE 3260U"], "").needed.has("ELEE 3250U"));
  // a completed option settles it, whichever program is shown
  const viaMece = PFPlan.plan(all, new Set([...done, "MECE 3410U"]), ["ELEE 3260U"], ELEC);
  assert.deepEqual([...viaMece.needed], ["ELEE 3260U"]);
});

test("either/or in a goal path: every goal in a program stays inside it when it can", () => {
  for (const prog of data.programs) {
    const list = inProgram(prog);
    for (const goal of list) {
      const P = PFPlan.plan(all, new Set(), [goal.code], prog);
      for (const k of P.picks) {
        const g = [k.picked, ...k.over];
        if (g.some(x => all.get(x).programs.includes(prog))) assert.ok(all.get(k.picked).programs.includes(prog), `${shortName(prog)} → ${goal.code}: ${k.picked} over ${k.over}`);
      }
    }
  }
});
const shortName = p => p.replace(/ 2026-2027$/, "");

test("each program's own semester decides which courses its capstone counts", () => {
  // MECE 2640U is year 2 in Automotive but year 3 semester 1 in Mechatronics
  const MECHA = "Mechatronics Engineering 2026-2027", AUTO = "Automotive Engineering 2026-2027";
  const c = all.get("MECE 2640U");
  assert.equal(PFPlan.semIn(c, MECHA), 5);
  assert.equal(PFPlan.semIn(c, AUTO), 3);
  const cap = all.get("ENGR 4111U");
  const pool = PFPlan.yearsPool(all, new Set(), MECHA, cap, 3);
  assert.ok(pool.list.includes("MECE 2640U"), "year 3 semester 1 is within years 1–3");
  const two = PFPlan.yearsPool(all, new Set(), MECHA, cap, 2);
  assert.ok(!two.list.includes("MECE 2640U"), "not a year 1–2 course in Mechatronics");
  assert.ok(PFPlan.yearsPool(all, new Set(), AUTO, cap, 2).list.includes("MECE 2640U"), "but it is in Automotive");
});
