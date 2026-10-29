/* PrereqFlow layout: course records → positioned cards and routed links.
 * Pure functions, no DOM; shared by the page, the image export and the tests.
 *
 * Two column schemes share one layered-graph pipeline:
 *   semester  column = the course's semester (as listed in the program map)
 *   free      column = computed from the prerequisite graph, so every prerequisite
 *             sits strictly left of the courses that need it
 *
 * Pipeline (a Sugiyama-style layered drawing):
 *   1. columns   semester, or longest-path layering + "pull right" compaction
 *   2. lanes     links spanning several columns pass through lane slots, bundled
 *                per source course, so they run in the gaps between cards
 *   3. order     barycentre sweeps + adjacent swaps, keeping the fewest crossings
 *   4. place     vertical positions by isotonic regression towards neighbours,
 *                so links run as straight as the stacking allows
 *   5. route     ports spread along card edges; cubic links through the lanes
 *
 * A course with `yearsComplete: N` (Capstone: "all program courses in years one
 * through three") needs every shown course of semesters 1…2N. Those links are "bus"
 * links: they take no part in ordering or placement, and run from each card's right
 * edge down a riser in the gutter, along a bus under the whole sheet, and up into
 * the course, so they stay clear of the ordinary links.
 *
 * In the semester layout, `opts.slots` ([{ id, semester }]) adds placeholder cards with
 * no links (a program's engineering electives still to choose). They sit at the foot of
 * their semester's column, above any bus-fed course, and come back in `slots`.
 */
const PFLayout = (() => {
  "use strict";

  const DIMS = { colW: 196, cardH: 64, laneH: 4, gapY: 12, gapLane: 5, gutter: 76, padL: 24, padR: 40, padT: 20, padB: 56, busGap: 30 };
  const COMPACT = 0.6; // pull towards the tight stack, relative to one linked neighbour
  const cmpCode = (a, b) => a.localeCompare(b, "en", { numeric: true });

  // ── graph ────────────────────────────────────────────────────────────────
  // Links between visible courses. A link is "alt" when every group naming the
  // prerequisite offers an alternative (either/or), "co" when it is a corequisite,
  // "bus" when it comes from a yearsComplete requirement.
  function buildGraph(courses) {
    const vis = new Map(courses.map(c => [c.code, c]));
    const preds = new Map(), succs = new Map(), edgeMap = new Map();
    for (const c of courses) { preds.set(c.code, []); succs.set(c.code, []); }
    for (const c of courses) {
      for (const [kind, groups] of [["pre", c.prereqs || []], ["co", c.coreqs || []]]) {
        for (const g of groups) for (const p of g) {
          if (!vis.has(p) || p === c.code) continue;
          const key = p + "→" + c.code;
          const alt = g.length > 1;
          const prev = edgeMap.get(key);
          if (prev) { prev.alt = prev.alt && alt; prev.co = prev.co && kind === "co"; continue; }
          edgeMap.set(key, { from: p, to: c.code, alt, co: kind === "co" });
          preds.get(c.code).push(p);
          succs.get(p).push(c.code);
        }
      }
    }
    for (const c of courses) {
      if (!(c.yearsComplete > 0)) continue;
      const lim = c.yearsComplete * 2;
      for (const o of courses) {
        if (o.code === c.code || o.yearsComplete > 0 || (o.semester || 1) > lim) continue;
        const key = o.code + "→" + c.code;
        if (edgeMap.has(key)) continue;
        edgeMap.set(key, { from: o.code, to: c.code, alt: false, co: false, bus: true });
        preds.get(c.code).push(o.code);
        succs.get(o.code).push(c.code);
      }
    }
    return { vis, preds, succs, edges: [...edgeMap.values()] };
  }

  // Edges that close a cycle (bad data, or mutual corequisites), found by DFS.
  function backEdges(codes, succs) {
    const state = new Map(), back = new Set();
    for (const root of codes) {
      if (state.has(root)) continue;
      const stack = [[root, 0]];
      state.set(root, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const out = succs.get(top[0]) || [];
        if (top[1] < out.length) {
          const v = out[top[1]++];
          const s = state.get(v);
          if (s === 1) back.add(top[0] + "→" + v);
          else if (!s) { state.set(v, 1); stack.push([v, 0]); }
        } else { state.set(top[0], 2); stack.pop(); }
      }
    }
    return back;
  }

  // ── 1. free columns ──────────────────────────────────────────────────────
  // Longest-path layering puts each course one column right of its latest
  // prerequisite. Then courses that unlock more than they need are pulled right,
  // next to their earliest dependent, which shortens links without ever moving
  // a course left of (or level with) one of its prerequisites. Bus links count for
  // the ordering but not for that pull: their length doesn't matter.
  function freeColumns(codes, preds, succs, bus = new Set()) {
    const sorted = [...codes].sort(cmpCode);
    const back = backEdges(sorted, succs);
    const P = new Map(), S = new Map();
    for (const c of sorted) { P.set(c, []); S.set(c, []); }
    for (const c of sorted) for (const s of succs.get(c) || []) {
      if (back.has(c + "→" + s)) continue;
      S.get(c).push(s); P.get(s).push(c);
    }
    // Kahn topological order
    const indeg = new Map(sorted.map(c => [c, P.get(c).length]));
    const queue = sorted.filter(c => !indeg.get(c));
    const topo = [];
    while (queue.length) {
      const c = queue.shift();
      topo.push(c);
      for (const s of S.get(c)) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) queue.push(s); }
    }
    const layer = new Map();
    for (const c of topo) layer.set(c, P.get(c).reduce((m, p) => Math.max(m, layer.get(p) + 1), 0));
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = topo.length - 1; i >= 0; i--) {
        const c = topo[i], out = S.get(c), inn = P.get(c);
        const own = out.filter(s => !bus.has(c + "→" + s)).length;
        if (!own || own <= inn.filter(p => !bus.has(p + "→" + c)).length) continue;
        const lim = Math.min(...out.map(s => layer.get(s))) - 1;
        if (lim > layer.get(c)) { layer.set(c, lim); moved = true; }
      }
      if (!moved) break;
    }
    const min = Math.min(0, ...layer.values());
    if (min) for (const c of topo) layer.set(c, layer.get(c) - min);
    return { layer, back };
  }

  // ── 3. ordering helpers ──────────────────────────────────────────────────
  function countCrossings(segs, posA, posB) {
    // segs between two adjacent columns as [upperPos, lowerPos]; O(m log m) would be
    // nicer, but columns here hold at most a few dozen links
    let n = 0;
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i];
      for (let j = i + 1; j < segs.length; j++) {
        const b = segs[j];
        if ((posA(a[0]) - posA(b[0])) * (posB(a[1]) - posB(b[1])) < 0) n++;
      }
    }
    return n;
  }

  // Isotonic regression (pool adjacent violators): centres y_i as close as possible
  // to desired d_i (weighted), keeping order and the minimum separation sep_i.
  function placeColumn(desired, weights, seps) {
    const n = desired.length;
    const off = new Array(n).fill(0);
    for (let i = 1; i < n; i++) off[i] = off[i - 1] + seps[i - 1];
    const blocks = [];
    for (let i = 0; i < n; i++) {
      blocks.push({ sw: weights[i], swz: weights[i] * (desired[i] - off[i]), n: 1 });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.swz / a.sw <= b.swz / b.sw) break;
        a.sw += b.sw; a.swz += b.swz; a.n += b.n;
        blocks.pop();
      }
    }
    const out = [];
    for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.swz / b.sw + off[out.length]);
    return out;
  }

  // ── main ─────────────────────────────────────────────────────────────────
  // courses: course records; opts: { mode: "semester"|"free", semCount, dims, slots }
  function compute(courses, opts = {}) {
    const D = { ...DIMS, ...(opts.dims || {}) };
    const mode = opts.mode === "free" ? "free" : "semester";
    const slotList = mode === "semester" ? (opts.slots || []).filter(s => s && s.id && s.semester >= 1) : [];
    const slotIds = new Set(slotList.map(s => s.id));
    const g = buildGraph(courses);
    const codes = courses.map(c => c.code);

    let col, back = new Set();
    if (mode === "free") {
      const f = freeColumns(codes, g.preds, g.succs, new Set(g.edges.filter(e => e.bus).map(e => e.from + "→" + e.to)));
      col = f.layer; back = f.back;
    } else {
      col = new Map(courses.map(c => [c.code, Math.max(0, (c.semester || 1) - 1)]));
    }
    const maxCol = Math.max(0, ...col.values(), ...slotList.map(s => s.semester - 1));
    const nCols = mode === "free" ? (courses.length ? maxCol + 1 : 1) : Math.max(opts.semCount || 1, maxCol + 1);

    // items: cards and lane slots (dummies). Each item: { id, col, h, card, w8 }
    const items = new Map();
    for (const c of codes) items.set(c, { id: c, col: col.get(c), h: D.cardH, card: true });
    for (const s of slotList) items.set(s.id, { id: s.id, col: s.semester - 1, h: D.cardH, card: true });
    const segs = new Map(); // "a|b" → [a, b] between adjacent columns, a left of b
    const addSeg = (a, b) => { const k = a + "|" + b; if (!segs.has(k)) segs.set(k, [a, b]); };
    const routes = [];
    for (const e of g.edges) {
      const ca = col.get(e.from), cb = col.get(e.to);
      const r = { ...e, kind: cb > ca ? "fwd" : cb === ca ? "same" : "back", hops: [] };
      if (e.bus) r.kind = "bus";
      if (back.has(e.from + "→" + e.to)) r.kind = "back";
      if (r.kind === "fwd") {
        let prev = e.from;
        for (let k = ca + 1; k < cb; k++) {
          const id = `~${e.from}@${k}`;
          if (!items.has(id)) items.set(id, { id, col: k, h: D.laneH, card: false, owner: e.from });
          addSeg(prev, id);
          r.hops.push(id);
          prev = id;
        }
        addSeg(prev, e.to);
      }
      routes.push(r);
    }
    const segList = [...segs.values()];
    const up = new Map(), down = new Map(); // item → neighbours in the column left / right
    for (const id of items.keys()) { up.set(id, []); down.set(id, []); }
    for (const [a, b] of segList) { down.get(a).push(b); up.get(b).push(a); }
    const segsBetween = Array.from({ length: Math.max(0, nCols - 1) }, () => []);
    for (const s of segList) segsBetween[items.get(s[0]).col].push(s);

    // ── 3. order within columns
    // courses fed by the bus sit at the bottom of their column, next to the bus, and
    // placeholder slots just above them
    const sink = new Set(routes.filter(r => r.kind === "bus").map(r => r.to));
    const rank = id => (sink.has(id) ? 2 : slotIds.has(id) ? 1 : 0);
    const sunk = (a, b) => rank(a) - rank(b);
    const cols = Array.from({ length: nCols }, () => []);
    for (const it of items.values()) cols[it.col].push(it.id);
    const idx = new Map();
    const reindex = c => cols[c].forEach((id, i) => idx.set(id, i));
    // initial: column 0 by code, then each column by the mean position of what feeds it
    cols[0].sort((a, b) => sunk(a, b) || cmpCode(a, b));
    reindex(0);
    for (let k = 1; k < nCols; k++) {
      const bc = id => { const u = up.get(id); return u.length ? u.reduce((s, x) => s + idx.get(x), 0) / u.length : Infinity; };
      cols[k].sort((a, b) => sunk(a, b) || (bc(a) - bc(b)) || cmpCode(a, b));
      reindex(k);
    }
    const crossingsAt = k => countCrossings(segsBetween[k], a => idx.get(a), b => idx.get(b));
    const totalCrossings = () => { let n = 0; for (let k = 0; k < nCols - 1; k++) n += crossingsAt(k); return n; };
    const sweep = (k, nbrs) => {
      const bc = new Map();
      cols[k].forEach((id, i) => {
        const ns = nbrs.get(id);
        bc.set(id, ns.length ? ns.reduce((s, x) => s + idx.get(x), 0) / ns.length : i);
      });
      cols[k].sort((a, b) => sunk(a, b) || bc.get(a) - bc.get(b) || idx.get(a) - idx.get(b));
      reindex(k);
    };
    // swap neighbours in a column while that removes crossings with both sides
    const localCross = (a, b) => {
      let n = 0;
      for (const nb of [up, down]) {
        for (const x of nb.get(a)) for (const y of nb.get(b)) if (idx.get(x) > idx.get(y)) n++;
      }
      return n;
    };
    const transpose = () => {
      let improved = true, rounds = 0;
      while (improved && rounds++ < 6) {
        improved = false;
        for (let k = 0; k < nCols; k++) {
          const c = cols[k];
          for (let i = 0; i + 1 < c.length; i++) {
            const a = c[i], b = c[i + 1];
            if (rank(a) !== rank(b)) continue;
            if (localCross(b, a) < localCross(a, b)) {
              c[i] = b; c[i + 1] = a; idx.set(b, i); idx.set(a, i + 1); improved = true;
            }
          }
        }
      }
    };
    let best = totalCrossings(), bestCols = cols.map(c => c.slice());
    for (let it = 0; it < 10 && best > 0; it++) {
      if (it % 2 === 0) for (let k = 1; k < nCols; k++) sweep(k, up);
      else for (let k = nCols - 2; k >= 0; k--) sweep(k, down);
      transpose();
      const n = totalCrossings();
      if (n < best) { best = n; bestCols = cols.map(c => c.slice()); }
    }
    bestCols.forEach((c, k) => { cols[k] = c; reindex(k); });

    // ── 4. vertical placement
    // Start from each column stacked tightly and centred on y = 0; that stack is
    // also an anchor every relaxation step pulls towards, so following links
    // never lets the sheet drift much taller than its tallest column.
    const cy = new Map(), anchor = new Map();
    const sepOf = (a, b) => (a.h + b.h) / 2 + (a.card && b.card ? D.gapY : D.gapLane);
    for (const c of cols) {
      let y = 0;
      c.forEach((id, i) => {
        if (i) y += sepOf(items.get(c[i - 1]), items.get(id));
        anchor.set(id, y);
      });
      for (const id of c) { anchor.set(id, anchor.get(id) - y / 2); cy.set(id, anchor.get(id)); }
    }
    const pull = opts.compact == null ? COMPACT : opts.compact;
    const relax = (k, dirs) => {
      const c = cols[k];
      if (!c.length) return;
      const desired = [], weights = [], seps = [];
      c.forEach((id, i) => {
        const ns = dirs.flatMap(m => m.get(id));
        desired.push(ns.length + pull > 0 ? (ns.reduce((s, x) => s + cy.get(x), 0) + pull * anchor.get(id)) / (ns.length + pull) : cy.get(id));
        weights.push(ns.length ? (items.get(id).card ? 1 : 2.5) : 0.25);
        if (i) seps.push(sepOf(items.get(c[i - 1]), items.get(id)));
      });
      placeColumn(desired, weights, seps).forEach((y, i) => cy.set(c[i], y));
    };
    for (let it = 0; it < 6; it++) {
      for (let k = 1; k < nCols; k++) relax(k, [up]);
      for (let k = nCols - 2; k >= 0; k--) relax(k, [down]);
    }
    for (let k = 0; k < nCols; k++) relax(k, [up, down]);
    let top = Infinity, bottom = -Infinity;
    for (const [id, y] of cy) { const h = items.get(id).h; top = Math.min(top, y - h / 2); bottom = Math.max(bottom, y + h / 2); }
    if (!isFinite(top)) { top = 0; bottom = 0; }
    const shift = D.padT - top;

    const colX = k => D.padL + k * (D.colW + D.gutter);
    const nodes = new Map();
    for (const c of codes) {
      const k = col.get(c);
      nodes.set(c, { code: c, col: k, x: colX(k), y: Math.round(cy.get(c) + shift - D.cardH / 2), w: D.colW, h: D.cardH });
    }
    const slots = new Map();
    for (const s of slotList) {
      const k = s.semester - 1;
      slots.set(s.id, { id: s.id, semester: s.semester, col: k, x: colX(k), y: Math.round(cy.get(s.id) + shift - D.cardH / 2), w: D.colW, h: D.cardH });
    }
    const lanes = [];
    for (const it of items.values()) if (!it.card) lanes.push({ id: it.id, owner: it.owner, col: it.col, x: colX(it.col), y: cy.get(it.id) + shift });

    // ── 5. ports + routes
    const yOf = id => cy.get(id) + shift;
    const portIn = new Map(), portOut = new Map(); // "a|b" → y on the card's edge
    const spread = (id, list, keyOf, map) => {
      const n = list.length;
      if (!n) return;
      const ys = list.map(x => [x, yOf(x)]).sort((a, b) => a[1] - b[1]);
      const span = Math.min(D.cardH * 0.62, (n - 1) * 9);
      ys.forEach(([x], i) => map.set(keyOf(x), yOf(id) + (n > 1 ? -span / 2 + (span * i) / (n - 1) : 0)));
    };
    for (const c of codes) {
      spread(c, up.get(c), x => x + "|" + c, portIn);
      spread(c, down.get(c), x => c + "|" + x, portOut);
    }
    // bus links: one riser per source column, one bus per target, one rise per target
    const busTargets = [...new Set(routes.filter(r => r.kind === "bus").map(r => r.to))].sort(cmpCode);
    const busY = new Map(busTargets.map((t, i) => [t, Math.round(bottom + shift + D.busGap + i * 10)]));
    const R = 6;
    const busPath = (a, b) => {
      const y0 = a.y + D.cardH - 8, x0 = a.x + D.colW;
      const rx = x0 + Math.round(D.gutter * 0.32);
      const tx = b.x - 1, ux = b.x - Math.round(D.gutter * 0.3);
      const ty = up.get(b.code).length ? b.y + D.cardH - 10 : b.y + D.cardH / 2;
      const by = busY.get(b.code), sg = ux >= rx ? 1 : -1;
      // first two points ride with the source card and the last two with the target (see the float in app.js)
      return `M${f(x0)},${f(y0)} L${f(x0 + 6)},${f(y0)} L${f(rx - R)},${f(y0)} Q${f(rx)},${f(y0)} ${f(rx)},${f(y0 + R)}`
        + ` L${f(rx)},${f(by - R)} Q${f(rx)},${f(by)} ${f(rx + sg * R)},${f(by)} L${f(ux - sg * R)},${f(by)} Q${f(ux)},${f(by)} ${f(ux)},${f(by - R)}`
        + ` L${f(ux)},${f(ty + R)} Q${f(ux)},${f(ty)} ${f(ux + R)},${f(ty)} L${f(tx - 6)},${f(ty)} L${f(tx)},${f(ty)}`;
    };
    const curve = (x1, y1, x2, y2) => {
      const dx = Math.max(24, (x2 - x1) * 0.5);
      return `C${f(x1 + dx)},${f(y1)} ${f(x2 - dx)},${f(y2)} ${f(x2)},${f(y2)}`;
    };
    const edges = routes.map(r => {
      const a = nodes.get(r.from), b = nodes.get(r.to);
      let d, arrow;
      if (r.kind === "bus") {
        d = busPath(a, b);
        arrow = { x: b.x - 1, y: up.get(b.code).length ? b.y + D.cardH - 10 : b.y + D.cardH / 2, dir: 1 };
      } else if (r.kind === "fwd") {
        const ids = [r.from, ...r.hops, r.to];
        let x = a.x + D.colW, y = portOut.get(ids[0] + "|" + ids[1]);
        d = `M${f(x)},${f(y)}`;
        for (const h of r.hops) {
          const hx = colX(items.get(h).col), hy = yOf(h);
          d += ` ${curve(x, y, hx, hy)} L${f(hx + D.colW)},${f(hy)}`;
          x = hx + D.colW; y = hy;
        }
        const ey = portIn.get(ids[ids.length - 2] + "|" + r.to);
        d += ` ${curve(x, y, b.x - 1, ey)}`;
        arrow = { x: b.x - 1, y: ey, dir: 1 };
      } else if (r.kind === "same") { // same column (corequisite): a bracket on the right
        const ay = a.y + D.cardH / 2, by = b.y + D.cardH / 2, x = a.x + D.colW;
        const bulge = 18 + Math.min(28, Math.abs(by - ay) * 0.06);
        d = `M${f(x)},${f(ay)} C${f(x + bulge)},${f(ay)} ${f(x + bulge)},${f(by)} ${f(x + 1)},${f(by)}`;
        arrow = { x: x + 1, y: by, dir: -1 };
      } else { // out of order: flows right-to-left
        const ay = a.y + D.cardH / 2, by = b.y + D.cardH / 2;
        const x1 = a.x, x2 = b.x + D.colW + 1;
        const dx = Math.max(30, Math.abs(x1 - x2) * 0.5);
        d = `M${f(x1)},${f(ay)} C${f(x1 - dx)},${f(ay)} ${f(x2 + dx)},${f(by)} ${f(x2)},${f(by)}`;
        arrow = { x: x2, y: by, dir: -1 };
      }
      return { from: r.from, to: r.to, alt: r.alt, co: r.co, bus: !!r.bus, kind: r.kind, d, arrow };
    });

    const colsOut = Array.from({ length: nCols }, () => []);
    for (const n of nodes.values()) colsOut[n.col].push(n.code);
    const width = D.padL + nCols * D.colW + (nCols - 1) * D.gutter + D.padR;
    const lastBus = busTargets.length ? busY.get(busTargets[busTargets.length - 1]) : -Infinity;
    const height = Math.max(D.padT + D.cardH + D.padB, Math.round(bottom + shift + D.padB), lastBus + D.padB);
    return {
      mode, dims: D, nCols, cols: colsOut, colX, nodes, slots, lanes, edges,
      preds: g.preds, succs: g.succs, width, height, crossings: best,
    };
  }
  const f = v => Math.round(v * 10) / 10;

  return { DIMS, compute, buildGraph, freeColumns, placeColumn, backEdges };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PFLayout;
