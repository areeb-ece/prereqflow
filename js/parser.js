/* PrereqFlow parser: turns program-map PDFs (pdf.js text items) and pasted text
 * into course records. Pure functions, no DOM; shared by the page and the tests. */
const PF = (() => {
  "use strict";

  // ── course codes ─────────────────────────────────────────────────────────
  // ELEE 3180U · MATH 1010U · PHY 1010U · CS101 · NUCL 2950 (missing suffix)
  const CODE_SRC = "\\b([A-Z]{2,5})[ \\u00a0]?(\\d{3,4})([A-Z]?)(?![A-Za-z0-9])";
  const codeRe = () => new RegExp(CODE_SRC, "g");
  const LEADING_CODE_RE = /^\s*([A-Za-z]{2,5})[  ]?(\d{3,4})([A-Za-z]?)(?![A-Za-z0-9])\s*[:\-–—]?\s*/;

  function canonCode(dept, num, suf) {
    return `${dept.toUpperCase()} ${num}${(suf || "").toUpperCase()}`;
  }
  function normCode(s) {
    const m = String(s || "").trim().match(/^([A-Za-z]{2,5})\s*(\d{3,4})([A-Za-z]?)$/);
    return m ? canonCode(m[1], m[2], m[3]) : String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
  }
  function findCodes(text) {
    const out = [];
    for (const m of String(text).matchAll(codeRe())) out.push(canonCode(m[1], m[2], m[3]));
    return out;
  }

  // ── semester labels ──────────────────────────────────────────────────────
  // "2-1" (year-term) · "Y2 S1" · "Year 2 Semester 1" · "Year 2 Fall" · "Semester 3" · "S3" · "Term 3"
  const TERM_WORD = { fall: 1, autumn: 1, winter: 2, spring: 2 };
  function semFromYearTerm(y, t) {
    y = +y; t = +t;
    if (!(y >= 1 && y <= 8 && t >= 1 && t <= 2)) return null;
    return (y - 1) * 2 + t;
  }
  const LABEL_PATTERNS = [
    [/^(\d)\s*[-–]\s*(\d)/, m => semFromYearTerm(m[1], m[2])],
    [/^y(?:ea)?r?\.?\s*(\d)\s*[-–,/]?\s*(?:s|sem|semester|t|term)\.?\s*(\d)\b/i, m => semFromYearTerm(m[1], m[2])],
    [/^year\s*(\d)\s*[-–,/]?\s*(fall|autumn|winter|spring)\b/i, m => semFromYearTerm(m[1], TERM_WORD[m[2].toLowerCase()])],
    [/^(fall|autumn|winter|spring)\s*[-–,/]?\s*(?:of\s+)?year\s*(\d)\b/i, m => semFromYearTerm(m[2], TERM_WORD[m[1].toLowerCase()])],
    [/^(?:semester|sem|term|s)\.?\s*(\d{1,2})\b/i, m => (+m[1] >= 1 && +m[1] <= 16 ? +m[1] : null)],
  ];
  // Whole string is a label → semester number, else null
  function parseSemesterLabel(s) {
    const t = String(s).trim().replace(/[:.]$/, "");
    for (const [re, fn] of LABEL_PATTERNS) {
      const m = t.match(re);
      if (m && m[0].length === t.length) return fn(m);
    }
    return null;
  }
  // Label at the start of a line followed by a course → { semester, rest }
  function splitLeadingLabel(line) {
    const s = String(line);
    const pre = [
      [/^\s*(\d)\s*[-–]\s*(\d)(?:\s*[:|.\-–—]\s*|\s+)(?=[A-Za-z]{2,5}\s?\d{3,4})/, m => semFromYearTerm(m[1], m[2])],
      [/^\s*\[\s*(\d{1,2})\s*\]\s*/, m => +m[1]],
      [/^\s*(\d{1,2})\s*(?:[|:\t]|\.\s)\s*(?=[A-Za-z]{2,5}\s?\d{3,4})/, m => +m[1]],
      [/^\s*(?:semester|sem|term|s)\.?\s*(\d{1,2})\s*[:|\-–—]?\s+(?=[A-Za-z]{2,5}\s?\d{3,4})/i, m => +m[1]],
      [/^\s*y(?:ea)?r?\.?\s*(\d)\s*[-–,/]?\s*(?:s|sem|semester|t|term)\.?\s*(\d)\s*[:|\-–—]?\s+(?=[A-Za-z]{2,5}\s?\d{3,4})/i, m => semFromYearTerm(m[1], m[2])],
    ];
    for (const [re, fn] of pre) {
      const m = s.match(re);
      if (m) {
        const sem = fn(m);
        if (sem && sem >= 1 && sem <= 16) return { semester: sem, rest: s.slice(m[0].length) };
      }
    }
    return { semester: null, rest: s };
  }

  // ── requirement text ─────────────────────────────────────────────────────
  // Keyword → segment kind. Restrictions/exclusions/recommendations are ignored;
  // coreqs are kept (and drawn like prereqs).
  const KEYWORDS = [
    { kind: "ignore", re: /\b(?:credit\s+)?restrictions?\b\s*:?/gi },
    { kind: "ignore", re: /\b(?:exclusions?|anti-?\s*requisites?|antireqs?)\b\s*:?/gi },
    { kind: "ignore", re: /\brecommended(?:\s+(?:preparation|background|prerequisites?))?\b\s*:?/gi },
    { kind: "ignore", re: /\b(?:not open to|cannot be taken for credit with|credit (?:will not be|cannot be) (?:given|granted|received))\b[^:]*:?/gi },
    { kind: "coreq", re: /\b(?:pre-?\s*(?:requisite)?\s*(?:or|\/)\s*)?co-?\s*req(?:uisite)?s?\b\s*:?/gi },
    { kind: "coreq", re: /\b(?:taken\s+)?concurrent(?:ly)?(?:\s+with)?\b\s*:?/gi },
    { kind: "prereq", re: /\bpre-?\s*req(?:uisite)?s?\b\s*:?/gi },
  ];
  const REQ_HINT_RE = /\b(?:pre-?\s*req|co-?\s*req|restrict|exclusion|anti-?\s*req|completion|credit\s+hours?|standing|permission|consent|enrol(?:l)?ment\s+in|recommended|concurrent)/i;

  function segmentRequirement(text) {
    const hits = [];
    for (const k of KEYWORDS) {
      k.re.lastIndex = 0;
      let m;
      while ((m = k.re.exec(text))) {
        hits.push({ kind: k.kind, start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) k.re.lastIndex++;
      }
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const clean = [];
    for (const h of hits) if (!clean.length || h.start >= clean[clean.length - 1].end) clean.push(h);
    const segs = [];
    let pos = 0, kind = "prereq", label = "";
    for (const h of clean) {
      segs.push({ kind, label, text: text.slice(pos, h.start) });
      kind = h.kind; label = text.slice(h.start, h.end).trim(); pos = h.end;
    }
    segs.push({ kind, label, text: text.slice(pos) });
    return segs.filter(s => s.text.trim() || s.label);
  }

  // Boolean grammar, "or" binds tighter than "," / ";" / "and":
  //   and := or ((","|";"|"and"|"&") or)*      or := atom (("or"|"/") atom)*
  //   atom := CODE | "(" and ")" | "one of" list | words(ignored)
  function tokenize(text) {
    const toks = [];
    // case-sensitive on purpose: course codes are upper-case ("May 2026" is not a course)
    const re = new RegExp(`${CODE_SRC}|\\(|\\)|\\[|\\]|,|;|\\/|&|[^\\s(),;/&\\[\\]]+`, "g");
    let m;
    while ((m = re.exec(text))) {
      const s = m[0];
      if (m[1]) toks.push({ t: "code", v: canonCode(m[1], m[2], m[3]) });
      else if (s === "(" || s === "[") toks.push({ t: "(" });
      else if (s === ")" || s === "]") toks.push({ t: ")" });
      else if (s === "," || s === ";" || s === "&" || /^and$/i.test(s)) toks.push({ t: "and" });
      else if (s === "/" || /^or$/i.test(s)) toks.push({ t: "or" });
      else if (/^of$/i.test(s) && toks.length && toks[toks.length - 1].t === "word" && /^(?:one|any)$/i.test(toks[toks.length - 1].v)) { toks.pop(); toks.push({ t: "oneof" }); }
      else if (/^either$/i.test(s)) { /* filler */ }
      else toks.push({ t: "word", v: s });
    }
    return toks;
  }

  function parseBool(text) {
    const toks = tokenize(text);
    let i = 0;
    const peek = () => toks[i];
    function parseAnd(stopAtClose) {
      const kids = [];
      while (i < toks.length) {
        if (peek().t === ")") { if (stopAtClose) break; i++; continue; }
        if (peek().t === "and") { i++; continue; }
        const n = parseOr(stopAtClose);
        if (n) kids.push(n);
        else if (i < toks.length && peek().t !== ")" && peek().t !== "and") i++;
      }
      return kids.length === 0 ? null : kids.length === 1 ? kids[0] : { op: "and", kids };
    }
    function parseOr(stopAtClose) {
      const kids = [];
      let a = parseAtom(stopAtClose);
      if (a) kids.push(a);
      while (i < toks.length && peek().t === "or") {
        i++;
        a = parseAtom(stopAtClose);
        if (a) kids.push(a);
      }
      return kids.length === 0 ? null : kids.length === 1 ? kids[0] : { op: "or", kids };
    }
    function parseAtom(stopAtClose) {
      // skip filler words until something meaningful
      while (i < toks.length && peek().t === "word") i++;
      if (i >= toks.length) return null;
      const t = peek();
      if (t.t === "code") { i++; return { code: t.v }; }
      if (t.t === "(") {
        i++;
        const inner = parseAnd(true);
        if (i < toks.length && peek().t === ")") i++;
        return inner;
      }
      if (t.t === "oneof") {
        i++;
        const kids = [];
        while (i < toks.length && peek().t !== ")") {
          const tk = toks[i++];
          if (tk.t === "code") kids.push({ code: tk.v });
          else if (tk.t === "(") { const inner = parseAnd(true); if (inner) kids.push(inner); if (i < toks.length && peek().t === ")") i++; }
        }
        return kids.length ? (kids.length === 1 ? kids[0] : { op: "or", kids }) : null;
      }
      return null;
    }
    return parseAnd(false);
  }

  // Tree → CNF: array of OR-groups that are all required
  function toCNF(node) {
    if (!node) return [];
    if (node.code) return [[node.code]];
    if (node.op === "and") return node.kids.flatMap(toCNF);
    // or: distribute
    let acc = [[]];
    for (const k of node.kids) {
      const cnf = toCNF(k);
      if (!cnf.length) continue;
      const next = [];
      for (const a of acc) for (const g of cnf) next.push([...a, ...g]);
      acc = next;
      if (acc.length > 24) { // pathological — collapse to one big alternative group
        const all = [...new Set(findCodesInTree(node))];
        return [all];
      }
    }
    return acc.filter(g => g.length).map(g => [...new Set(g)]);
  }
  function findCodesInTree(n) { return !n ? [] : n.code ? [n.code] : n.kids.flatMap(findCodesInTree); }

  function dedupeGroups(groups) {
    const seen = new Set(), out = [];
    for (const g of groups) {
      const uniq = [...new Set(g)];
      const key = [...uniq].sort().join("|");
      if (!uniq.length || seen.has(key)) continue;
      seen.add(key); out.push(uniq);
    }
    return out;
  }

  function cleanNote(s) {
    return s.replace(/\s+/g, " ").replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, "").trim();
  }

  // Parse the inside of a requirement parenthetical (or several, joined).
  function parseRequirementText(text) {
    const res = { prereqs: [], coreqs: [], notes: [], ignored: [] };
    for (const seg of segmentRequirement(String(text || ""))) {
      const body = seg.text;
      const codes = findCodes(body);
      if (seg.kind === "ignore") {
        const t = cleanNote(`${seg.label} ${body}`);
        if (t) res.ignored.push(t);
        continue;
      }
      if (!codes.length) {
        const t = cleanNote(body);
        if (t && /[A-Za-z]{3,}|\d/.test(t)) res.notes.push(seg.kind === "coreq" ? `Coreq: ${t}` : t);
        continue;
      }
      const groups = toCNF(parseBool(body));
      (seg.kind === "coreq" ? res.coreqs : res.prereqs).push(...groups);
    }
    res.prereqs = dedupeGroups(res.prereqs);
    res.coreqs = dedupeGroups(res.coreqs);
    return res;
  }

  // ── a single course cell / line ──────────────────────────────────────────
  function topLevelParens(s) {
    const groups = [];
    let depth = 0, start = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "(") { if (depth === 0) start = i; depth++; }
      else if (c === ")" && depth > 0) { depth--; if (depth === 0) groups.push({ start, end: i + 1, inner: s.slice(start + 1, i) }); }
    }
    if (depth > 0 && start >= 0) groups.push({ start, end: s.length, inner: s.slice(start + 1) }); // unclosed
    return groups;
  }
  function isRequirementish(t) { return findCodes(t).length > 0 || REQ_HINT_RE.test(t); }

  const ELECTIVE_RE = /\belectives?\b/i;

  // → { kind: "course", code, name, prereqs, coreqs, notes, ignored } | { kind: "elective"|"other", text }
  function parseCourseText(raw) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const m = text.match(LEADING_CODE_RE);
    if (!m) return { kind: ELECTIVE_RE.test(text) ? "elective" : "other", text };
    const code = canonCode(m[1], m[2], m[3]);
    let rest = text.slice(m[0].length);

    const reqParts = [];
    let name = "";
    let cursor = 0;
    for (const g of topLevelParens(rest)) {
      if (isRequirementish(g.inner)) {
        name += rest.slice(cursor, g.start);
        reqParts.push(g.inner);
        cursor = g.end;
      }
    }
    name += rest.slice(cursor);
    // calendar style: requirement keywords outside parentheses ("... Prerequisites: X")
    const kw = name.search(/\b(?:pre-?\s*req(?:uisite)?s?|co-?\s*req(?:uisite)?s?|(?:credit\s+)?restrictions?)\b\s*:/i);
    if (kw > 0) { reqParts.push(name.slice(kw)); name = name.slice(0, kw); }
    name = name.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "").trim();
    // neighbouring elective cell glued on by copy/paste: "Industrial Automation Engineering Elective"
    const trimmed = name.replace(/(?:\s+(?:Engineering|Liberal\s+Studies|Science|Natural\s+Science|Social\s+Science|Technical|Complementary(?:\s+Studies)?|Free|Open|General|Humanities|Program|Professional)\s+Electives?)+$/i, "").trim();
    if (trimmed && trimmed !== name) name = trimmed;

    if (!name && ELECTIVE_RE.test(rest)) return { kind: "elective", text };
    const req = parseRequirementText(reqParts.join("; "));
    // a course can't require itself
    const strip = gs => gs.map(g => g.filter(c => c !== code)).filter(g => g.length);
    return { kind: "course", code, name: name || code, prereqs: strip(req.prereqs), coreqs: strip(req.coreqs), notes: req.notes, ignored: req.ignored };
  }

  // ── pasted / typed text → entries (one per course) ──────────────────────
  function parenDelta(s) {
    let d = 0;
    for (const c of s) { if (c === "(") d++; else if (c === ")") d--; }
    return d;
  }
  const NOISE_LINE_RE = /^(?:year|course|courses|semester|term|(?:year\s+)?(?:course\s+){1,10}course|updated\b.*|revised\b.*|page\s+\d+.*|.*\b(?:19|20)\d{2}\s*[-–/]\s*(?:19|20)?\d{2})$/i;
  const CONTINUES_RE = /(?:[,(/:&]|\bor|\band)\s*$/i;
  const NEW_COURSE_IN_PARENS_RE = /^[A-Z]{2,5}\s?\d{3,4}[A-Z]?(?:\s+[A-Z][a-z].*)?$/;
  // a line made only of elective phrases: "Engineering Elective", "Liberal Studies Elective Science Elective"
  const ELECTIVE_LINE_RE = /^(?:(?:[A-Za-z&\-]+\s+){0,2}electives?\s*)+(?:\(.*\))?$/i;

  // → [{ text, semester|null, kind }] where text is one collapsed line per course.
  // Semester labels ("2-1", "Year 2 Semester 1", "S3", …) set the semester for what follows.
  function splitEntries(raw) {
    const lines0 = String(raw || "").replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/ /g, " ").trim()).filter(Boolean);
    // re-join elective phrases wrapped over two lines: "Liberal Studies" + "Elective"
    const lines = [];
    for (let i = 0; i < lines0.length; i++) {
      const next = lines0[i + 1];
      if (next && /^electives?$/i.test(next) && /^(?:[A-Z][A-Za-z&\-]*\s*){1,3}$/.test(lines0[i]) && !LEADING_CODE_RE.test(lines0[i])) {
        lines.push(`${lines0[i]} ${next}`); i++;
      } else lines.push(lines0[i]);
    }
    const out = [];
    let cur = null, curSem = null;
    const flush = () => {
      if (cur && cur.parts.length) {
        const text = joinLines(cur.parts);
        out.push({ text, semester: cur.semester, kind: LEADING_CODE_RE.test(text) ? "course" : (ELECTIVE_RE.test(text) ? "elective" : "other") });
      }
      cur = null;
    };
    for (let line of lines) {
      line = line.replace(/ /g, " ").trim();
      if (!line) continue;
      // safety valves for an unclosed "(" in the source: a semester label, or a fresh
      // course line right after a line that isn't mid-list, closes it
      if (cur && cur.depth > 0) {
        const prev = cur.parts[cur.parts.length - 1] || "";
        if (parseSemesterLabel(line) || (NEW_COURSE_IN_PARENS_RE.test(line) && !CONTINUES_RE.test(prev))) cur.depth = 0;
      }
      const depth = cur ? cur.depth : 0;
      if (depth <= 0) {
        if (line.startsWith("#")) continue; // comments in exported text files
        const asLabel = parseSemesterLabel(line);
        if (asLabel) { flush(); curSem = asLabel; continue; }
        const { semester: inlineSem, rest } = splitLeadingLabel(line);
        if (inlineSem) { flush(); curSem = inlineSem; line = rest.trim(); }
        const startsCourse = LEADING_CODE_RE.test(line) && /^[A-Za-z]{2,5}\s?\d{3,4}[A-Za-z]?(?![A-Za-z0-9])/.test(line) && !/^[a-z]/.test(line);
        const isNoise = NOISE_LINE_RE.test(line);
        const isElective = ELECTIVE_LINE_RE.test(line) && !startsCourse;
        const closedReq = cur && cur.closedReq;
        if (startsCourse || isNoise || isElective || (closedReq && !line.startsWith("("))) {
          flush();
          if (isNoise) continue;
          cur = { parts: [], depth: 0, semester: curSem, closedReq: false };
        }
      }
      if (!cur) cur = { parts: [], depth: 0, semester: curSem, closedReq: false };
      const before = cur.depth;
      cur.parts.push(line);
      cur.depth += parenDelta(line);
      if (cur.depth < 0) cur.depth = 0;
      if (before > 0 || line.includes("(")) {
        if (cur.depth === 0) {
          const groups = topLevelParens(joinLines(cur.parts));
          const last = groups[groups.length - 1];
          if (last && isRequirementish(last.inner)) cur.closedReq = true;
        }
      }
    }
    flush();
    return out;
  }

  // Join wrapped lines: "program-" + "respective" → "program-respective"
  function joinLines(parts) {
    let s = "";
    for (const p0 of parts) {
      const p = p0.trim();
      if (!p) continue;
      if (!s) s = p;
      else if (/[A-Za-z]-$/.test(s) && /^[a-z]/.test(p)) s += p;
      else if (/[(/]$/.test(s) || /^[),]/.test(p)) s += p;
      else s += " " + p;
    }
    return s.replace(/\s+/g, " ").trim();
  }

  // ── PDF table reconstruction from pdf.js text items ──────────────────────
  // items: [{ str, x, y, w, h }] in page coords with y growing DOWN, (x,y) = baseline-left,
  // in the PDF's drawing order. Only items drawn one after another may join into a line —
  // neighbouring cells can share a baseline and nearly touch when text overflows a cell.
  function itemsToLines(items) {
    const its = items.filter(it => it.str && it.str.trim() && it.h > 0)
      .map((it, seq) => ({ ...it, seq, str: it.str.replace(/ /g, " ") }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const it of its) {
      const row = rows.find(r => Math.abs(r.y - it.y) < 0.35 * Math.min(r.h, it.h) && Math.abs(r.h - it.h) < 0.3 * Math.max(r.h, it.h));
      if (row) row.items.push(it); else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    const lines = [];
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const it of r.items) {
        const gap = cur ? it.x - cur.x1 : Infinity;
        const consecutive = cur && Math.abs(it.seq - cur.lastSeq) === 1;
        if (cur && consecutive && gap < 0.6 * Math.max(cur.h, it.h)) {
          cur.str += (gap > 0.15 * it.h && !/\s$/.test(cur.str) && !/^\s/.test(it.str) ? " " : "") + it.str;
          cur.x1 = Math.max(cur.x1, it.x + it.w);
          cur.lastSeq = it.seq;
        } else {
          if (cur) lines.push(cur);
          cur = { str: it.str, x0: it.x, x1: it.x + it.w, y: it.y, h: it.h, lastSeq: it.seq };
        }
      }
      if (cur) lines.push(cur);
    }
    for (const l of lines) l.str = l.str.replace(/\s+/g, " ").trim();
    return lines.filter(l => l.str);
  }

  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }

  const HEADER_WORD_RE = /^(?:year|years|course|courses|semester|term|level)$/i;
  const FOOTER_RE = /^(?:updated|revised|last\s+updated|page\s+\d)/i;

  // → { title, cells: [{ semester, label, text }], tableFound }
  function extractTable(items) {
    const lines = itemsToLines(items);
    if (!lines.length) return { title: "", cells: [], tableFound: false, lines };

    // row labels in the leftmost column
    let labels = lines.map(l => ({ l, sem: parseSemesterLabel(l.str) })).filter(o => o.sem);
    if (labels.length >= 2) {
      const minX = Math.min(...labels.map(o => o.l.x0));
      labels = labels.filter(o => o.l.x0 < minX + 3 * o.l.h);
    }
    // title: biggest text, outside the table
    const maxH = Math.max(...lines.map(l => l.h));
    const titleLines = lines.filter(l => l.h >= maxH * 0.98 && l.h > median(lines.map(x => x.h)) * 1.25).sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const title = joinLines(titleLines.map(l => l.str));

    if (labels.length < 2) return { title, cells: [], tableFound: false, lines };

    labels.sort((a, b) => a.l.y - b.l.y);
    const labelRight = Math.max(...labels.map(o => o.l.x1));
    const labelSet = new Set(labels.map(o => o.l));
    const spacings = labels.slice(1).map((o, i) => o.l.y - labels[i].l.y).filter(d => d > 0);
    const maxSpacing = Math.max(...spacings, 10);

    let content = lines.filter(l => !labelSet.has(l) && l.x0 > labelRight - 0.5 && !HEADER_WORD_RE.test(l.str) && !FOOTER_RE.test(l.str));
    const bodyH = median(content.map(l => l.h));
    content = content.filter(l => l.h <= bodyH * 1.25 && !titleLines.includes(l));

    // typical baseline pitch between consecutive lines of one cell
    const sorted = [...content].sort((a, b) => a.y - b.y);
    const diffs = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].y - sorted[i].y < 3 * bodyH; j++) {
        const a = sorted[i], b = sorted[j];
        if (b.y - a.y > 0.5 * bodyH && Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0)) { diffs.push(b.y - a.y); break; }
      }
    }
    const pitch = median(diffs) || bodyH * 1.3;

    // connect vertically adjacent, horizontally overlapping lines → cell blocks
    const parent = content.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const idx = new Map(content.map((l, i) => [l, i]));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        const dy = b.y - a.y;
        if (dy > 1.55 * pitch) break;
        if (dy < 0.5 * pitch) continue;
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const narrower = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
        if (overlap >= 0.3 * narrower && Math.abs(a.h - b.h) <= 0.2 * Math.max(a.h, b.h)) parent[find(idx.get(a))] = find(idx.get(b));
      }
    }
    const blocks = new Map();
    content.forEach((l, i) => {
      const r = find(i);
      if (!blocks.has(r)) blocks.set(r, []);
      blocks.get(r).push(l);
    });

    // block → nearest row label by vertical centre (cells are vertically centred)
    const rowCells = labels.map(() => []);
    for (const ls of blocks.values()) {
      ls.sort((a, b) => a.y - b.y || a.x0 - b.x0);
      const cy = (ls[0].y + ls[ls.length - 1].y) / 2;
      let best = -1, bestD = Infinity;
      labels.forEach((o, k) => { const d = Math.abs(o.l.y - cy); if (d < bestD) { bestD = d; best = k; } });
      if (best < 0 || bestD > 0.75 * maxSpacing) continue; // outside the table (title, footer)
      rowCells[best].push({ lines: ls, x0: Math.min(...ls.map(l => l.x0)), x1: Math.max(...ls.map(l => l.x1)) });
    }

    const cells = [];
    rowCells.forEach((cs, k) => {
      cs.sort((a, b) => a.x0 - b.x0);
      // merge pieces of the same cell (e.g. split by a blank line)
      const merged = [];
      for (const c of cs) {
        const prev = merged[merged.length - 1];
        if (prev && Math.min(prev.x1, c.x1) - Math.max(prev.x0, c.x0) > 0) {
          prev.lines.push(...c.lines); prev.x1 = Math.max(prev.x1, c.x1);
        } else merged.push({ ...c, lines: [...c.lines] });
      }
      for (const c of merged) {
        c.lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
        cells.push({ semester: labels[k].sem, label: labels[k].l.str, text: joinLines(c.lines.map(l => l.str)), x: c.x0 });
      }
    });
    return { title, cells, tableFound: true, lines };
  }

  // Lines in reading order for non-table pages (fallback → text parser)
  function linesToText(lines) {
    return [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0).map(l => l.str).join("\n");
  }

  // ── programme name from a file name ──────────────────────────────────────
  function programFromFilename(name) {
    let s = String(name || "").replace(/\.[^.]+$/, "");
    s = s.replace(/^[0-9a-f]{6,}[-_]/i, "");            // upload hash prefix
    s = s.replace(/[-_ ]?(?:19|20)\d{2}[-_](?:19|20)?\d{2}$/, ""); // trailing year range
    s = s.replace(/[-_]+/g, " ").trim();
    return s.replace(/\b\w/g, c => c.toUpperCase()) || "Imported";
  }
  function cleanTitle(t) {
    return String(t || "").replace(/\s+/g, " ").trim();
  }

  // ── course records ───────────────────────────────────────────────────────
  // Level-based fallback when no semester is given: 1xxx → Y1S1, 2xxx → Y2S1, …
  function semesterFromCode(code) {
    const m = String(code).match(/\s(\d)(\d{2,3})/);
    if (!m) return 1;
    const lvl = +m[1];
    return lvl >= 1 && lvl <= 8 ? (lvl - 1) * 2 + 1 : 1;
  }

  // A course can sit in different semesters in different programs (Thermodynamics and
  // Heat Transfer is 2-1 in Automotive but 3-1 in Mechatronics). `semesters` holds each
  // program's own semester; `semester` is the fallback for programs without an entry,
  // for the all-programs view (the earliest) and for courses added by hand.
  function mkCourse(p, semester, program) {
    return {
      code: p.code, name: p.name, semester,
      semesters: program ? { [program]: semester } : {},
      prereqs: p.prereqs || [], coreqs: p.coreqs || [], notes: p.notes || [], ignored: p.ignored || [],
      programs: program ? [program] : [],
    };
  }
  // the semester a course is taken in, in a given program ("" or null: the fallback)
  function semIn(c, program) {
    return (program && c.semesters && c.semesters[program]) || c.semester;
  }
  // every listed program's semester, spelled out (a program without an entry takes the
  // fallback), so that changing the fallback later can't move the others
  function programSemesters(c) {
    const out = { ...(c.semesters || {}) };
    for (const p of c.programs || []) if (!out[p]) out[p] = c.semester;
    return out;
  }

  // Union of requirement groups from two sources. Program maps often list only the
  // alternative their students take ("CHEM 1800U") where another lists the full set
  // ("CHEM 1020U or CHEM 1800U") — keep the fuller group, drop its subsets.
  function unionGroups(a, b) {
    const all = dedupeGroups([...(a || []), ...(b || [])]);
    return all.filter(g => !all.some(h => h !== g && h.length > g.length && g.every(c => h.includes(c))));
  }

  // Merge incoming records into a Map(code → course). Each program keeps its own
  // semester; the fallback `semester` is the earliest seen. Only a program listing the
  // same course in two semesters is a real conflict, and there the earliest is kept.
  function mergeInto(map, incoming) {
    for (const c0 of incoming) {
      const c = { ...c0, code: normCode(c0.code) };
      const ex = map.get(c.code);
      if (!ex) { map.set(c.code, { ...c, semesters: { ...(c.semesters || {}) }, prereqs: dedupeGroups(c.prereqs || []), coreqs: dedupeGroups(c.coreqs || []), notes: [...new Set(c.notes || [])], ignored: [...new Set(c.ignored || [])], programs: [...new Set(c.programs || [])] }); continue; }
      ex.semesters = programSemesters(ex);
      for (const [prog, sem] of Object.entries(programSemesters(c))) ex.semesters[prog] = ex.semesters[prog] ? Math.min(ex.semesters[prog], sem) : sem;
      ex.semester = Math.min(ex.semester, c.semester, ...Object.values(ex.semesters));
      if ((!ex.name || ex.name === ex.code) && c.name) ex.name = c.name;
      ex.prereqs = unionGroups(ex.prereqs, c.prereqs);
      ex.coreqs = unionGroups(ex.coreqs, c.coreqs);
      ex.notes = [...new Set([...(ex.notes || []), ...(c.notes || [])])];
      ex.ignored = [...new Set([...(ex.ignored || []), ...(c.ignored || [])])];
      ex.programs = [...new Set([...(ex.programs || []), ...(c.programs || [])])];
    }
    return map;
  }

  // Map prereq codes that miss a suffix ("NUCL 2950") onto a unique known course ("NUCL 2950U")
  function resolveCodes(map) {
    const byBase = new Map();
    for (const code of map.keys()) {
      const base = code.replace(/[A-Z]$/, "");
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(code);
    }
    const fixes = [];
    const fix = c => {
      if (map.has(c)) return c;
      const cands = byBase.get(c.replace(/[A-Z]$/, "")) || [];
      if (cands.length === 1) { fixes.push([c, cands[0]]); return cands[0]; }
      return c;
    };
    for (const course of map.values()) {
      course.prereqs = dedupeGroups(course.prereqs.map(g => g.map(fix)));
      course.coreqs = dedupeGroups(course.coreqs.map(g => g.map(fix)));
    }
    return fixes;
  }

  // Requirement groups → readable text ("A, B or C, Coreq: D")
  function requirementText(c) {
    const fmt = gs => gs.map(g => g.join(" or ")).join(", ");
    const parts = [];
    if (c.prereqs && c.prereqs.length) parts.push(fmt(c.prereqs));
    if (c.coreqs && c.coreqs.length) parts.push(`Coreq: ${fmt(c.coreqs)}`);
    return parts.join(", ");
  }

  // One-line text form, re-importable through the bulk box
  function courseToLine(c) {
    const inner = [requirementText(c), ...(c.notes || []), ...(c.ignored || [])].filter(Boolean).join("; ");
    return `${c.code} ${c.name}${inner ? ` (${inner})` : ""}`;
  }
  function semesterLabel(sem) {
    const y = Math.ceil(sem / 2), t = sem - (y - 1) * 2;
    return `${y}-${t}`;
  }

  return {
    CODE_SRC, normCode, findCodes, canonCode,
    parseSemesterLabel, splitLeadingLabel, semFromYearTerm,
    parseRequirementText, parseBool, toCNF, dedupeGroups, unionGroups,
    parseCourseText, splitEntries, joinLines,
    itemsToLines, extractTable, linesToText,
    programFromFilename, cleanTitle, semesterFromCode,
    mkCourse, semIn, programSemesters, mergeInto, resolveCodes, requirementText, courseToLine, semesterLabel,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PF;
