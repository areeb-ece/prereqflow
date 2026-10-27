/* PrereqFlow planning: completed courses → what can be taken now, and goal courses →
 * the courses still needed for them, in order. Pure functions, no DOM; shared by the
 * page and the tests.
 *
 * Two kinds of requirement in the program maps aren't lists of course codes, so they
 * are read from a course's notes:
 *   "54 credit hours"        a credit threshold; every course counts as 3 credit hours
 *   "all program-respective courses in years one through three"
 *                            every course of the student's program in years 1–3
 *
 * Requirement groups follow the rest of PrereqFlow: a course's prereqs are a list of
 * groups, every group is required, and a group with several codes is either/or.
 * A group naming only courses that aren't loaded can't be checked here, so it is
 * treated as met; a group with at least one loaded course needs one of those done.
 * A corequisite group is also met by a course that could be taken alongside.
 */
const PFPlan = (() => {
  "use strict";

  const CREDITS = 3; // credit hours per course
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const CREDIT_RE = /\b(\d{2,3})\s*(?:credit[\s-]*hours?|credits?)\b/i;
  const YEARS_RE = /\ball\b[^.;]*?\bcourses\b[^.;]*?\byears?\s+(?:one|1)\s*(?:through|to|thru|-|–)\s*(one|two|three|four|five|[1-5])\b/i;
  const cmpCode = (a, b) => a.localeCompare(b, "en", { numeric: true });
  // the semester a course is taken in, in a given program (see PF.semIn in parser.js)
  const semIn = (c, program) => (program && c.semesters && c.semesters[program]) || c.semester;

  // → { minCredits, yearsComplete } from a course's notes (0 when absent)
  function rules(c) {
    const r = { minCredits: 0, yearsComplete: 0 };
    for (const n of (c && c.notes) || []) {
      const m = String(n).match(CREDIT_RE);
      if (m) r.minCredits = Math.max(r.minCredits, +m[1]);
      const y = String(n).match(YEARS_RE);
      if (y) r.yearsComplete = Math.max(r.yearsComplete, NUM[y[1].toLowerCase()] || +y[1]);
    }
    return r;
  }

  function countDone(courses, completed) {
    let n = 0;
    for (const c of completed) if (courses.has(c)) n++;
    return n;
  }

  // The courses a "years one through N" requirement asks for. With a program in view
  // that the course belongs to, it's that program's courses; otherwise the course's
  // program with the fewest still to do (a student is only in one of them). A course
  // listed in no program (added by hand) counts every loaded course.
  function yearsPool(courses, completed, program, c, years) {
    const lim = years * 2;
    const progs = c.programs || [];
    const pools = program && progs.includes(program) ? [program] : progs.length ? progs : [null];
    let best = null;
    for (const p of pools) {
      const list = [];
      for (const o of courses.values()) {
        if (o.code === c.code || semIn(o, p) > lim || rules(o).yearsComplete) continue;
        if (p && !(o.programs || []).includes(p)) continue;
        list.push(o.code);
      }
      list.sort(cmpCode);
      const left = list.filter(x => !completed.has(x));
      if (!best || left.length < best.left.length) best = { program: p, years, list, left };
    }
    return best;
  }

  // courses: Map code → course (everything loaded); completed: Set of codes;
  // program: the program in view, or "" for all of them.
  // → { count, credits, status: Map code → { state: "done"|"ready"|"locked", prereqs,
  //     coreqs (unmet groups), minCredits, creditsShort, years (pool) } }
  function evaluate(courses, completed, program = "") {
    const count = countDone(courses, completed);
    const credits = count * CREDITS;
    const done = x => completed.has(x);
    const unmet = (groups, ok) => groups.filter(g => !g.some(done) && g.some(x => courses.has(x)) && !g.some(x => courses.has(x) && ok(x)));
    const preOK = x => unmet(courses.get(x).prereqs || [], done).length === 0;
    const status = new Map();
    for (const c of courses.values()) {
      const r = rules(c);
      const s = {
        state: "locked",
        prereqs: unmet(c.prereqs || [], done),
        coreqs: unmet(c.coreqs || [], x => done(x) || preOK(x)),
        minCredits: r.minCredits,
        creditsShort: Math.max(0, r.minCredits - credits),
        years: r.yearsComplete ? yearsPool(courses, completed, program, c, r.yearsComplete) : null,
      };
      if (done(c.code)) s.state = "done";
      else if (!s.prereqs.length && !s.coreqs.length && !s.creditsShort && !(s.years && s.years.left.length)) s.state = "ready";
      status.set(c.code, s);
    }
    return { count, credits, status };
  }

  // The courses still needed for the goals, grouped into steps: everything in step 1
  // can be taken now, and each later step only needs earlier steps (corequisites may
  // share a step). Where a requirement offers alternatives (either/or), a completed
  // option settles it; otherwise the pick prefers, in order:
  //   1. an option in the program shown
  //   2. an option that shares more programs with the course that needs it (in the
  //      all-programs view this picks the route most of that course's programs take)
  //   3. an option the plan already takes for something else
  //   4. the option with the fewest courses still to do, then the earlier semester
  // Credit thresholds push a course back until enough courses come before it; if the
  // plan alone can't reach the threshold, `short` says how many more courses
  // (electives, say) are needed.
  // → { steps: [[codes]], step: Map code → step, needed: Set, goals, doneGoals,
  //     short: Map code → courses, pools: Map code → years pool,
  //     picks: [{ course, picked, over: [codes] }] (each either/or choice made) }
  function plan(courses, completed, goals, program = "") {
    const done = x => completed.has(x);
    const loaded = x => courses.has(x);
    const pools = new Map();
    const poolOf = c => {
      if (!pools.has(c.code)) pools.set(c.code, yearsPool(courses, completed, program, c, rules(c).yearsComplete));
      return pools.get(c.code);
    };
    const open = g => !g.some(done) && g.some(loaded);

    // rough count of courses still to take for a course, its prerequisites included
    const memo = new Map(), onStack = new Set();
    function cost(code) {
      if (done(code)) return 0;
      if (!loaded(code) || onStack.has(code)) return 1e6;
      if (memo.has(code)) return memo.get(code);
      onStack.add(code);
      const c = courses.get(code);
      let n = 1;
      for (const g of [...(c.prereqs || []), ...(c.coreqs || [])]) if (open(g)) n += cost(choose(g, c));
      if (rules(c).yearsComplete) n += poolOf(c).left.length;
      onStack.delete(code);
      memo.set(code, n);
      return n;
    }
    const needed = new Set(), pre = new Map(), co = new Map(), picks = [];
    function choose(g, owner) {
      const opts = g.filter(loaded);
      if (opts.length < 2) return opts[0];
      const own = owner.programs || [];
      const rank = x => {
        const progs = courses.get(x).programs || [];
        return [program && progs.includes(program) ? 0 : 1, -own.filter(p => progs.includes(p)).length, needed.has(x) ? 0 : 1, cost(x), semIn(courses.get(x), program)];
      };
      const byRank = ([a, x], [b, y]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return cmpCode(x, y); };
      return opts.map(x => [rank(x), x]).sort(byRank)[0][1];
    }
    const pick = (g, owner) => {
      const x = choose(g, owner);
      const over = g.filter(y => y !== x && loaded(y));
      if (over.length) picks.push({ course: owner.code, picked: x, over });
      return x;
    };

    function collect(code) {
      if (done(code) || needed.has(code) || !loaded(code)) return;
      needed.add(code);
      const c = courses.get(code);
      const p = [], q = [];
      pre.set(code, p); co.set(code, q);
      for (const g of c.prereqs || []) if (open(g)) { const x = pick(g, c); p.push(x); collect(x); }
      for (const g of c.coreqs || []) if (open(g)) { const x = pick(g, c); q.push(x); collect(x); }
      if (rules(c).yearsComplete) for (const x of poolOf(c).left) { p.push(x); collect(x); }
    }
    const goalList = [...new Set(goals)].filter(loaded);
    for (const g of goalList) collect(g);

    // steps, with lower bounds from the credit thresholds
    const floor = new Map();
    let step = new Map();
    const compute = () => {
      step = new Map();
      const visiting = new Set();
      const s = code => {
        if (!needed.has(code)) return 0;
        if (step.has(code)) return step.get(code);
        if (visiting.has(code)) return 1; // a cycle in the data: break it here
        visiting.add(code);
        let v = Math.max(1, floor.get(code) || 0);
        for (const x of pre.get(code)) v = Math.max(v, s(x) + 1);
        for (const x of co.get(code)) v = Math.max(v, s(x));
        visiting.delete(code);
        step.set(code, v);
        return v;
      };
      for (const x of needed) s(x);
    };
    compute();
    // courses in the plan that need x (directly or not) can't count towards x's credits
    const dependents = new Map([...needed].map(x => [x, []]));
    for (const x of needed) for (const y of [...pre.get(x), ...co.get(x)]) if (dependents.has(y)) dependents.get(y).push(x);
    const after = x => {
      const seen = new Set(), stack = [x];
      while (stack.length) for (const y of dependents.get(stack.pop())) if (!seen.has(y)) { seen.add(y); stack.push(y); }
      return seen;
    };
    const doneCount = countDone(courses, completed);
    const gated = [...needed].filter(x => rules(courses.get(x)).minCredits);
    const short = new Map();
    for (let round = 0; round < 25 && gated.length; round++) {
      let changed = false;
      short.clear();
      for (const x of gated) {
        const want = Math.ceil(rules(courses.get(x)).minCredits / CREDITS) - doneCount; // courses to finish before x
        if (want <= 0) continue;
        const later = after(x);
        const before = [...needed].filter(y => y !== x && !later.has(y)).map(y => step.get(y)).sort((a, b) => a - b);
        let at;
        if (before.length >= want) at = before[want - 1] + 1;
        else { at = (before.length ? before[before.length - 1] : 0) + 1; short.set(x, want - before.length); }
        if (at > step.get(x)) { floor.set(x, at); changed = true; }
      }
      if (!changed) break;
      compute();
    }

    // compact the step numbers (cycles or thresholds can leave gaps)
    const used = [...new Set(step.values())].sort((a, b) => a - b);
    const renum = new Map(used.map((v, i) => [v, i + 1]));
    const steps = used.map(() => []);
    for (const x of needed) { const k = renum.get(step.get(x)); step.set(x, k); steps[k - 1].push(x); }
    for (const s of steps) s.sort((a, b) => semIn(courses.get(a), program) - semIn(courses.get(b), program) || cmpCode(a, b));
    const usedPools = new Map([...pools].filter(([code]) => needed.has(code)));
    return { steps, step, needed, goals: goalList, doneGoals: goalList.filter(done), short, pools: usedPools, picks };
  }

  return { CREDITS, rules, evaluate, plan, yearsPool, semIn };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PFPlan;
