/* PrereqFlow engineering electives: each program map's elective slots, and the courses
 * a program may fill them with. Pure functions, no DOM; shared by the page and the tests.
 *
 *   electives = { slots: { program: [semester, …] }, courses: Map code → option }
 *   option    = { code, name, prereqs, coreqs, notes, programs, permission, offered }
 *     programs    the programs that list it as an engineering elective
 *     permission  the programs where it counts only with special permission
 *     offered     "fall", "winter" or "both", or { program: term } where programs differ
 *
 * A slot is filled only from its own program's list, and only with a course offered in
 * the slot's term (semester 1 of a year is fall, semester 2 winter), so a chosen
 * elective always sits where the program map places its elective.
 *
 * A chosen elective becomes an ordinary course of that program on the sheet: the program
 * joins its `programs`, its semester there is the slot's, and `electiveIn` lists the
 * programs that take it as an elective. Completed courses, goals, layouts and exports
 * then treat it like any other course.
 */
const PFElectives = (() => {
  "use strict";

  const TERMS = ["fall", "winter", "both"];
  const cmpCode = (a, b) => a.localeCompare(b, "en", { numeric: true });
  const semIn = (c, program) => (program && c.semesters && c.semesters[program]) || c.semester;
  const termOf = sem => (sem % 2 ? "fall" : "winter");
  const strList = v => (Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : []);
  const codeOf = v => String(v || "").trim().toUpperCase().replace(/\s+/g, " ");
  const groups = v => (Array.isArray(v) ? v.filter(Array.isArray).map(g => g.map(codeOf).filter(Boolean)).filter(g => g.length) : []);

  const empty = () => ({ slots: {}, courses: new Map() });

  // the data file / export form → the in-memory form; anything malformed is dropped
  function fromData(o) {
    const out = empty();
    if (!o || typeof o !== "object") return out;
    if (o.slots && typeof o.slots === "object") {
      for (const [p, list] of Object.entries(o.slots)) {
        const sems = (Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 16).sort((a, b) => a - b);
        if (sems.length) out.slots[p] = sems;
      }
    }
    for (const c of Array.isArray(o.courses) ? o.courses : []) {
      const code = codeOf(c && c.code);
      if (!code) continue;
      let offered = "both";
      if (TERMS.includes(c.offered)) offered = c.offered;
      else if (c.offered && typeof c.offered === "object") {
        offered = {};
        for (const [p, t] of Object.entries(c.offered)) if (TERMS.includes(t)) offered[p] = t;
      }
      out.courses.set(code, {
        code, name: String(c.name || "").trim() || code,
        prereqs: groups(c.prereqs), coreqs: groups(c.coreqs),
        notes: strList(c.notes), programs: strList(c.programs), permission: strList(c.permission), offered,
      });
    }
    return out;
  }
  // → the data file / export form, optionally only for some programs
  function toData(E, programs = null) {
    const keep = p => !programs || programs.includes(p);
    const slots = Object.fromEntries(Object.entries(E.slots).filter(([p]) => keep(p)));
    const courses = [];
    for (const c of [...E.courses.values()].sort((a, b) => cmpCode(a.code, b.code))) {
      const progs = c.programs.filter(keep), perm = c.permission.filter(keep);
      if (!progs.length && !perm.length) continue;
      let offered = c.offered;
      if (typeof offered === "object") {
        offered = Object.fromEntries(Object.entries(offered).filter(([p]) => keep(p)));
        const terms = new Set(Object.values(offered));
        if (terms.size === 1) offered = [...terms][0];
      }
      courses.push({ code: c.code, name: c.name, prereqs: c.prereqs, coreqs: c.coreqs, notes: c.notes, programs: progs, permission: perm, offered });
    }
    return { slots, courses };
  }
  // add another sheet's electives (an import): for the programs it covers, it wins
  function merge(E, incoming) {
    for (const [p, s] of Object.entries(incoming.slots)) E.slots[p] = s.slice();
    for (const [code, c] of incoming.courses) {
      const ex = E.courses.get(code);
      if (!ex) { E.courses.set(code, { ...c }); continue; }
      const mine = p => c.programs.includes(p) || c.permission.includes(p);
      const programs = [...new Set([...ex.programs.filter(p => !mine(p)), ...c.programs])];
      const permission = [...new Set([...ex.permission.filter(p => !mine(p)), ...c.permission])];
      const offered = Object.fromEntries([...programs, ...permission].map(p => [p, offeredIn(mine(p) ? c : ex, p)]).filter(([, t]) => t));
      const terms = new Set(Object.values(offered));
      E.courses.set(code, { ...ex, ...c, programs, permission, offered: terms.size === 1 ? [...terms][0] : offered });
    }
    return E;
  }

  const slotsIn = (E, program) => (program && E.slots[program]) || [];
  const allowed = (o, program) => o.programs.includes(program) || o.permission.includes(program);
  // "fall", "winter", "both", or "" when the program doesn't offer it
  function offeredIn(o, program) {
    if (typeof o.offered === "string") return o.offered;
    return (o.offered && o.offered[program]) || "";
  }
  const fitsTerm = (o, program, sem) => { const t = offeredIn(o, program); return t === "both" || t === termOf(sem); };
  // courses on the sheet taken as an elective in the program
  const chosenIn = (courses, program) => [...courses.values()].filter(c => (c.electiveIn || []).includes(program));
  // a course the program already requires (not as an elective)
  const requiredIn = (c, program) => !!c && (c.programs || []).includes(program) && !(c.electiveIn || []).includes(program);

  // → [{ sem, total, chosen: [codes], open }] for each semester with elective slots
  function slotTable(E, courses, program) {
    const by = new Map();
    for (const s of slotsIn(E, program)) by.set(s, (by.get(s) || 0) + 1);
    const chosen = chosenIn(courses, program);
    return [...by].map(([sem, total]) => {
      const here = chosen.filter(c => semIn(c, program) === sem).map(c => c.code).sort(cmpCode);
      return { sem, total, chosen: here, open: Math.max(0, total - here.length) };
    });
  }
  // the slots still to fill: [{ sem, i }] (i counts within the semester)
  function openSlots(E, courses, program) {
    const out = [];
    for (const row of slotTable(E, courses, program)) for (let i = 0; i < row.open; i++) out.push({ sem: row.sem, i: row.total - row.open + i });
    return out;
  }

  // Requirement groups an option can't meet by the slot's semester: none of the group's
  // courses is taken earlier in the program (or alongside, for a corequisite), and none
  // is completed.
  function unmetFor(courses, program, sem, groupsOf, completed = new Set(), same = false) {
    const taken = x => {
      const c = courses.get(x);
      if (!c || !(c.programs || []).includes(program)) return false;
      const s = semIn(c, program);
      return same ? s <= sem : s < sem;
    };
    return groupsOf.filter(g => !g.some(x => completed.has(x) || taken(x)));
  }

  // The choices for one semester's slots.
  // → { list: [{ code, name, permission, chosen, chosenAt, prereqs, coreqs }],
  //     other: [codes] (the program's electives that aren't offered this term) }
  function options(E, courses, program, sem, completed = new Set()) {
    const list = [], other = [];
    for (const o of E.courses.values()) {
      if (!allowed(o, program)) continue;
      const c = courses.get(o.code);
      if (requiredIn(c, program)) continue; // the program takes it anyway
      const chosenAt = c && (c.electiveIn || []).includes(program) ? semIn(c, program) : 0;
      if (!fitsTerm(o, program, sem) && chosenAt !== sem) { other.push(o.code); continue; }
      const rec = c || o;
      list.push({
        code: o.code, name: rec.name, permission: !o.programs.includes(program),
        chosen: chosenAt === sem, chosenAt,
        prereqs: unmetFor(courses, program, sem, rec.prereqs || [], completed),
        coreqs: unmetFor(courses, program, sem, rec.coreqs || [], completed, true),
      });
    }
    const ok = x => (x.prereqs.length || x.coreqs.length ? 1 : 0) + (x.permission ? 1 : 0);
    list.sort((a, b) => ok(a) - ok(b) || cmpCode(a.code, b.code));
    return { list, other: other.sort(cmpCode) };
  }

  // Put an option on the sheet as the program's elective in that semester. A course
  // already loaded for other programs gains this one; otherwise it's added.
  // → the course record, or null if it can't go there
  function choose(courses, E, program, sem, code) {
    const o = E.courses.get(code);
    if (!o || !allowed(o, program) || !fitsTerm(o, program, sem)) return null;
    let c = courses.get(code);
    if (requiredIn(c, program)) return null;
    if (!c) {
      c = { code, name: o.name, semester: sem, semesters: {}, prereqs: o.prereqs.map(g => g.slice()), coreqs: o.coreqs.map(g => g.slice()), notes: o.notes.slice(), ignored: [], programs: [], electiveIn: [] };
      courses.set(code, c);
    }
    const sems = { ...(c.semesters || {}) };
    for (const p of c.programs) if (!sems[p]) sems[p] = c.semester;
    sems[program] = sem;
    c.semesters = sems;
    if (!c.programs.includes(program)) c.programs = [...c.programs, program];
    if (!(c.electiveIn || []).includes(program)) c.electiveIn = [...(c.electiveIn || []), program];
    c.semester = Math.min(...c.programs.map(p => sems[p] || c.semester));
    return c;
  }
  // Take an elective back off the program. A course nothing else lists leaves the sheet.
  // → true if the course was removed from the sheet altogether
  function unchoose(courses, program, code) {
    const c = courses.get(code);
    if (!c || !(c.electiveIn || []).includes(program)) return false;
    c.electiveIn = c.electiveIn.filter(p => p !== program);
    if (!c.electiveIn.length) delete c.electiveIn;
    c.programs = c.programs.filter(p => p !== program);
    const sems = { ...(c.semesters || {}) };
    delete sems[program];
    c.semesters = sems;
    if (!c.programs.length) { courses.delete(code); return true; }
    c.semester = Math.min(...c.programs.map(p => sems[p] || c.semester));
    return false;
  }

  return { TERMS, termOf, empty, fromData, toData, merge, slotsIn, allowed, offeredIn, fitsTerm, chosenIn, requiredIn, slotTable, openSlots, unmetFor, options, choose, unchoose };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PFElectives;
