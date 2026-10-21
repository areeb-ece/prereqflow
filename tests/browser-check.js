/* End-to-end check in a real browser (needs Playwright: `npm i --no-save playwright@1.56.1`).
 * Serves the site at /prereqflow/ as GitHub Pages does and drives every feature the README
 * lists, at desktop and phone width: the start screen, search, filter, layouts, tracing, pins,
 * tree highlights, editing, plan mode, line input, file import, every export, zoom and keys.
 * It also asserts: no script errors, no request leaves the page's own files, no sideways
 * scrolling, focus stays inside an open dialog, and every control shows a focus ring.
 * Screenshots go to test-results/screenshots/.
 *
 * The shared theme, settings panel and night sky live in the portfolio repo
 * (areeb-ece.github.io, public/design/). Without them the page must fall back to its own
 * light/dark switch, which is what runs by default. To check the real thing:
 *   DESIGN_DIR=../areeb-ece.github.io/public/design npm run test:browser
 * BROWSER=firefox runs it in Firefox; ONLY=phone or ONLY=desktop runs one width. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const pw = require("playwright");

const ROOT = path.join(__dirname, "..");
const BASE_PATH = "/prereqflow/";
const DESIGN = process.env.DESIGN_DIR && path.resolve(process.env.DESIGN_DIR);
const SHOTS = path.join(ROOT, "test-results", "screenshots");
const BROWSER = ["chromium", "firefox", "webkit"].includes(process.env.BROWSER) ? process.env.BROWSER : "chromium";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = null;
  if (url.startsWith("/fonts/") && DESIGN) file = path.join(DESIGN, "..", "fonts", path.basename(url)); // what /design/fonts.css points at
  else if (url.startsWith("/design/") && !DESIGN) { // as if the portfolio weren't there
    res.writeHead(404); res.end(); return;
  } else if (url.startsWith("/design/")) file = path.join(DESIGN, path.basename(url));
  else if (url.startsWith(BASE_PATH)) file = path.join(ROOT, url.slice(BASE_PATH.length) || "index.html");
  if (file && file.endsWith(path.sep)) file += "index.html";
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const results = [];
let current = "", cleanup = async () => {};
async function check(name, fn) {
  try { await fn(); results.push([current, name, "ok"]); }
  catch (e) {
    results.push([current, name, "FAIL", e.message.replace(/\s+/g, " ").slice(0, 300)]);
    await cleanup().catch(() => {}); // a failed check mustn't leave a dialog or menu over the next one
  }
}

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + BASE_PATH;
  const opts = process.env.CHROMIUM_PATH && BROWSER === "chromium" ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await pw[BROWSER].launch(opts);
  fs.mkdirSync(SHOTS, { recursive: true });
  const widths = [[1360, 900, "desktop"], [390, 844, "phone"]].filter(w => !process.env.ONLY || process.env.ONLY === w[2]);
  try {
    for (const [w, h, tag] of widths) {
      current = `${BROWSER} ${tag}${DESIGN ? " +design" : " offline"}`;
      const phone = tag === "phone";
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone && BROWSER === "chromium", acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [], outside = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on("request", r => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
      const shot = name => page.screenshot({ path: path.join(SHOTS, `${BROWSER}-${tag}${DESIGN ? "" : "-offline"}-${name}.png`) });
      const wait = ms => page.waitForTimeout(ms);
      const visible = sel => page.isVisible(sel);
      // On a phone the toolbar's controls sit in the menu sheet; open it when one is out of view.
      const sheetOpen = () => page.$eval("#menuSheet", e => e.hasAttribute("data-open")).catch(() => false);
      const tool = async sel => {
        await wait(60); // let a sheet that is closing after the last action finish closing
        if (!(await visible(sel)) && (await page.$("#btnMenu")) && (await visible("#btnMenu"))) { await page.click("#btnMenu"); await wait(120); }
        return sel;
      };
      const tap = async sel => page.click(await tool(sel));
      const toast = () => page.textContent("#toast");
      const toastAct = async () => { await page.click("#toastAct"); await wait(120); };
      const cardCount = () => page.$$eval("#cards .card", c => c.length);
      // On a phone the details sheet covers most of the chart, so a tap goes to the card itself.
      const clickCard = async (code, mods, type = "click") => {
        const el = await page.$(`.card[data-code="${code}"]`);
        if (phone) return el.evaluate((e, [shift, type]) => e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, shiftKey: shift })), [!!(mods && mods.includes("Shift")), type]);
        await el.scrollIntoViewIfNeeded();
        if (type === "dblclick") await el.dblclick({ force: true });
        else await el.click({ modifiers: mods, force: true });
      };
      const flyTo = code => page.evaluate(c => { const el = document.querySelector(`.card[data-code="${c}"]`); el.scrollIntoView({ block: "center", inline: "center" }); }, code);
      const download = async (trigger) => { const [d] = await Promise.all([page.waitForEvent("download"), trigger()]); const p = await d.path(); return { name: d.suggestedFilename(), data: fs.readFileSync(p) }; };

      // Floating cards never settle, which stalls Playwright's actionability checks; the
      // motion check turns motion back on by itself.
      await page.addInitScript(() => {
        if (sessionStorage.getItem("pf-check-init")) return;
        sessionStorage.setItem("pf-check-init", "1");
        localStorage.setItem("design.settings", JSON.stringify({ motion: false }));
        localStorage.setItem("prereqflow.motion", "off");
      });
      cleanup = async () => {
        for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
        if (await sheetOpen()) await page.click("#btnMenu");
        if (await visible("#welcomeDlg") && await visible("#wResumeBtn")) await page.click("#wResumeBtn");
        if (await visible("#treeClear")) await page.click("#treeClear");
      };
      await page.goto(base);
      await wait(400);

      await check("start screen opens with every program", async () => {
        assert.ok(await visible("#welcomeDlg"), "start screen visible");
        assert.equal(await page.$$eval("#wProgram option", o => o.length), 17);
        assert.ok(await page.isHidden("#wResume"), "no resume on a first visit");
      });
      await check("start screen can't be dismissed while empty", async () => {
        await page.keyboard.press("Escape");
        assert.ok(await visible("#welcomeDlg"));
      });
      await shot("1-start");

      if (DESIGN) await check("shared design loaded", async () => {
        assert.ok(await visible("#designSettings"), "settings button");
        assert.ok(await page.isHidden("#btnTheme"), "fallback switch hidden");
        assert.ok((await page.$$eval("#stage .sky circle", c => c.length)) > 0, "stars behind the sheet");
      });

      await check("open all program maps", async () => {
        await page.click("#wDefault");
        await wait(700);
        assert.ok(await page.isHidden("#welcomeDlg"));
        assert.equal(await cardCount(), 158);
        assert.match((await page.textContent("#sheetInfo")).toLowerCase(), /158 courses · 16 programs · 266 links/);
      });
      await shot("2-sheet");

      await check("no sideways page scroll", async () => {
        const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(sw <= iw + 1, `${sw} > ${iw}`);
      });

      await check("search: count, Enter pins, Esc clears, / focuses", async () => {
        await page.mouse.move(4, 4); // off the cards: a hovered card's trace wins over search
        await page.evaluate(() => document.querySelector("#cards").dispatchEvent(new PointerEvent("pointerleave")));
        await page.fill(await tool("#search"), "calculus");
        await wait(60);
        assert.ok(+(await page.textContent("#searchCount")) >= 2, "match count");
        assert.ok((await page.$$eval(".card.is-match", c => c.length)) >= 2, "matches lit");
        await page.press("#search", "Enter");
        await wait(500);
        assert.ok(await visible("#details"), "details open");
        assert.match(await page.textContent("#details .dname"), /Calculus/);
        await page.press("#search", "Escape");
        assert.equal(await page.inputValue("#search"), "");
        assert.equal(await page.textContent("#searchCount"), "");
        await page.keyboard.press("Escape"); // unpin
        if (!phone) {
          await page.click("#zFit");
          await page.keyboard.press("/");
          assert.equal(await page.evaluate(() => document.activeElement.id), "search");
          await page.keyboard.press("Escape");
          await page.evaluate(() => document.activeElement.blur());
        }
      });

      await check("program filter shows one program and back", async () => {
        const sel = await tool("#programFilter");
        const opt = await page.$$eval("#programFilter option", o => o.map(x => [x.value, x.textContent]).find(x => /Mechanical/.test(x[1])));
        await page.selectOption(sel, opt[0]);
        await wait(400);
        assert.equal(await cardCount(), +opt[1].match(/\((\d+)\)/)[1]);
        await page.selectOption(await tool("#programFilter"), "");
        await wait(400);
        assert.equal(await cardCount(), 158);
      });

      await check("layouts and semester count", async () => {
        await tap('#modeSeg [data-mode="free"]');
        await wait(800);
        await page.click("#zFit");
        await wait(700);
        assert.ok(await page.isHidden("#semCount"), "no semester count in free flow");
        assert.match(await page.textContent("#colhead"), /T1/);
        await tap('#modeSeg [data-mode="semester"]');
        await wait(800);
        await page.selectOption(await tool("#semCount"), "10");
        await wait(300);
        assert.match(await page.textContent("#colhead"), /5-2|Y5|Year 5/);
        await page.selectOption(await tool("#semCount"), "8");
        await wait(300);
        if (await sheetOpen()) await page.click("#btnMenu");
      });

      if (!phone) await check("hover traces a chain and shows the readout", async () => {
        await page.click("#zFit");
        await wait(600);
        await flyTo("ELEE 2250U");
        await page.hover('.card[data-code="ELEE 2250U"]', { force: true });
        await wait(150);
        assert.ok(await visible("#readout"), "readout");
        assert.match(await page.textContent("#readout"), /in prerequisite chain/);
        assert.ok((await page.$$eval(".card.is-needs", c => c.length)) > 0, "needs lit");
        await page.mouse.move(5, h - 5);
      });

      await check("click pins, again unpins", async () => {
        await clickCard("ELEE 2250U");
        await wait(500);
        assert.ok(await visible("#details"));
        assert.match(await page.textContent("#details .dcode"), /ELEE 2250U/);
        await shot("3-pinned");
        await check("details chips jump to a course", async () => {
          const chip = await page.$("#details .chip[data-goto]");
          const code = await chip.getAttribute("data-goto");
          await chip.click();
          await wait(500);
          assert.match(await page.textContent("#details .dcode"), new RegExp(code));
          await clickCard("ELEE 2250U");
          await wait(500);
        });
        await check("highlight tree from details, h key", async () => {
          await page.click('#details [data-hl="post"]');
          await wait(100);
          assert.match(await page.textContent("#trees"), /ELEE 2250U\s*unlocks/);
          await page.click('#details [data-hl="post"]');
          await wait(100);
          assert.ok(await page.isHidden("#trees"));
          await page.keyboard.press("h");
          await wait(100);
          assert.match(await page.textContent("#trees"), /ELEE 2250U\s*prereqs/);
          await page.keyboard.press("h");
        });
        await check("zoom to chain", async () => {
          const z0 = await page.textContent("#zPct");
          await page.click("#dZoom");
          await wait(700);
          assert.notEqual(await page.textContent("#zPct"), z0);
        });
        await page.click("#dClose");
        await wait(200);
        assert.ok(await page.isHidden("#details"), "closed with ×");
        await clickCard("ELEE 2250U");
        await wait(500);
        await clickCard("ELEE 2250U");
        await wait(200);
        assert.ok(await page.isHidden("#details"), "second click unpins");
      });

      await check("shift+click trees: chips, dim, zoom, clear and Undo", async () => {
        await clickCard("ELEE 2250U", ["Shift"]);
        await clickCard("MATH 1010U", ["Shift"]);
        await wait(100);
        assert.equal(await page.$$eval("#trees .tree-chip", c => c.length), 2);
        assert.ok((await page.$$eval(".card.is-hl", c => c.length)) > 2);
        const pressed = await page.getAttribute("#treeDim", "aria-pressed");
        await page.click("#treeDim");
        assert.notEqual(await page.getAttribute("#treeDim", "aria-pressed"), pressed);
        await page.click("#treeDim");
        const z0 = await page.textContent("#zPct");
        await page.click("#treeZoom");
        await wait(700);
        assert.notEqual(await page.textContent("#zPct"), z0, "zoomed to trees");
        await page.click('#trees [data-untree="MATH 1010U"]');
        assert.equal(await page.$$eval("#trees .tree-chip", c => c.length), 1);
        await page.click("#treeClear");
        assert.ok(await page.isHidden("#trees"));
        await toastAct();
        assert.equal(await page.$$eval("#trees .tree-chip", c => c.length), 1, "Undo restores");
        await page.click("#treeClear");
      });

      await check("double-click edits a course, with Undo", async () => {
        await clickCard("ELEE 2250U", null, "dblclick");
        await wait(300);
        assert.ok(await visible("#editDlg"));
        assert.match(await page.textContent("#editTitle"), /Edit ELEE 2250U/);
        assert.ok(await page.$eval("#fCode", e => e.readOnly), "code read-only");
        await page.fill("#fName", "Renamed for the check");
        await page.click("#fSave");
        await wait(400);
        assert.match(await page.textContent('.card[data-code="ELEE 2250U"] .name'), /Renamed/);
        await toastAct();
        assert.doesNotMatch(await page.textContent('.card[data-code="ELEE 2250U"] .name'), /Renamed/);
        await page.keyboard.press("Escape");
      });

      await check("add course: validation, add, duplicate, delete, Undo", async () => {
        await tap("#btnAdd");
        await wait(200);
        assert.ok(await visible("#editDlg"));
        await page.fill("#fCode", "not a code");
        await page.click("#fSave");
        assert.match(await page.textContent("#fErr"), /course code/);
        await page.fill("#fCode", "TEST 1234U");
        await page.fill("#fName", "");
        await page.click("#fSave");
        assert.match(await page.textContent("#fErr"), /course name/);
        await page.fill("#fName", "A check course");
        await page.fill("#fPre", "MATH 1010U");
        await page.press("#fName", "Enter");
        await wait(500);
        assert.equal(await cardCount(), 159);
        assert.match(await toast(), /Added TEST 1234U/);
        await tap("#btnAdd");
        await page.fill("#fCode", "TEST 1234U");
        await page.fill("#fName", "Again");
        await page.click("#fSave");
        assert.match(await page.textContent("#fErr"), /already loaded/);
        await page.keyboard.press("Escape");
        await clickCard("TEST 1234U", null, "dblclick");
        await wait(300);
        await page.click("#fDelete");
        assert.match(await page.textContent("#fDelete"), /again/i, "two-step delete");
        await page.click("#fDelete");
        await wait(400);
        assert.equal(await cardCount(), 158);
        await toastAct();
        assert.equal(await cardCount(), 159, "Undo restores");
        await clickCard("TEST 1234U");
        await wait(500);
        await page.click("#dDelete");
        await page.click("#dDelete");
        await wait(400);
        assert.equal(await cardCount(), 158, "deleted from the details panel");
      });

      await check("plan mode: brushes, stats, panel, path, clear and Undo", async () => {
        await tap('#planSeg [data-plan="1"]');
        await wait(400);
        assert.ok(await visible("#planbar"));
        assert.ok(await visible("#details"), "plan panel opens");
        assert.match(await page.textContent("#details .dcode"), /Plan/);
        assert.match(await page.textContent("#planStats"), /0\s*completed/);
        await clickCard("MATH 1010U");
        await wait(300);
        assert.match(await toast(), /MATH 1010U completed/);
        assert.ok(await page.$eval('.card[data-code="MATH 1010U"]', e => e.classList.contains("p-done")));
        assert.match(await page.textContent("#planStats"), /1\s*completed · 3\s*credit hours/);
        await page.click('#brushSeg [data-brush="goal"]');
        await clickCard("ELEE 2250U");
        await wait(300);
        assert.match(await toast(), /set as a goal/);
        assert.match(await page.textContent("#details"), /Path, in order/);
        assert.ok((await page.$$eval(".card.p-path", c => c.length)) > 0, "path courses marked");
        await shot("4-plan");
        await page.click('#brushSeg [data-brush="pin"]');
        await clickCard("MATH 1020U");
        await wait(500);
        assert.match(await page.textContent("#details .dcode"), /MATH 1020U/);
        await page.click("#dDone");
        assert.match(await page.textContent("#dDone"), /Completed/);
        await page.click("#dDone");
        await page.click("#dGoal");
        assert.match(await page.textContent("#dGoal"), /Goal/);
        await page.click("#dGoal");
        await page.click("#dBack");
        await wait(200);
        assert.match(await page.textContent("#details .dcode"), /Plan/);
        await page.click("#btnPlanPanel");
        assert.ok(await page.isHidden("#details"), "panel toggles off");
        await page.click("#btnPlanPanel");
        assert.ok(await visible("#details"));
        await page.click("#pClearGoals");
        assert.match(await page.textContent("#details"), /No goals yet/);
        await toastAct();
        assert.match(await page.textContent("#details"), /Path, in order/, "Undo restores goals");
        await page.click("#pClearDone");
        assert.match(await page.textContent("#pClearDone"), /Clear all 1\?/);
        await page.click("#pClearDone");
        assert.match(await page.textContent("#planStats"), /0\s*completed/);
        await toastAct();
        assert.match(await page.textContent("#planStats"), /1\s*completed/);
        await page.click('#brushSeg [data-brush="done"]');
      });

      await check("plan survives a reload, and Resume restores the session", async () => {
        await page.reload();
        await wait(500);
        assert.ok(await visible("#wResume"));
        assert.match(await page.textContent("#wResumeInfo"), /158 courses · 16 programs · saved/);
        await page.click("#wResumeBtn");
        await wait(600);
        assert.equal(await cardCount(), 158);
        assert.ok(await visible("#planbar"), "plan mode remembered");
        assert.match(await page.textContent("#planStats"), /1\s*completed/);
        await page.keyboard.press("p");
        await wait(300);
        if (phone) assert.ok(await page.isHidden("#planbar"), "p (via keyboard) leaves plan mode");
        else assert.ok(await page.isHidden("#planbar"));
      });

      await check("exports: JSON (with plan), CSV, text, filtered JSON", async () => {
        await tap("#btnExport");
        const j = await download(() => page.click('#exportMenu [data-dl="json"]:not([data-only])'));
        const o = JSON.parse(j.data);
        assert.equal(o.format, "prereqflow");
        assert.equal(o.courses.length, 158);
        assert.deepEqual(o.plan.completed, ["MATH 1010U"]);
        fs.writeFileSync(path.join(SHOTS, "..", "export.json"), j.data);
        await tap("#btnExport");
        const c = await download(() => page.click('#exportMenu [data-dl="csv"]'));
        assert.match(c.data.toString(), /^﻿?Code,Name,Semester/);
        await tap("#btnExport");
        const t = await download(() => page.click('#exportMenu [data-dl="txt"]'));
        assert.match(t.data.toString(), /^# PrereqFlow export/);
        const opt = await page.$$eval("#programFilter option", o => o.map(x => x.value).find(v => /Electrical/.test(v)));
        await page.selectOption(await tool("#programFilter"), opt);
        await wait(300);
        await tap("#btnExport");
        const f = await download(() => page.click('#exportMenu [data-only="1"]'));
        assert.ok(JSON.parse(f.data).courses.length < 158);
        assert.match(f.name, /electrical/);
        await page.selectOption(await tool("#programFilter"), "");
        await wait(300);
        if (await sheetOpen()) await page.click("#btnMenu");
      });

      await check("export menu closes with Escape", async () => {
        await tap("#btnExport");
        assert.ok(await visible("#exportMenu"));
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#exportMenu"));
        if (await sheetOpen()) await page.click("#btnMenu");
      });

      await check("image export: scopes, options, PNG and SVG", async () => {
        await clickCard("ELEE 2250U");
        await wait(500);
        await tap("#btnExport");
        await page.click('#exportMenu [data-img]');
        await wait(300);
        assert.ok(await visible("#imageDlg"));
        assert.equal(await page.$$eval("input[name=imgScope]", i => i.length), 5);
        assert.ok(await page.$eval('input[name=imgScope][value="chain"]', i => !i.disabled), "chain available while pinned");
        assert.ok(await page.$eval('input[name=imgScope][value="trees"]', i => i.disabled), "no trees yet");
        assert.match(await page.textContent("#imgDims"), /× .* px/);
        const png = await download(() => page.click("#imgGo"));
        assert.match(png.name, /\.png$/);
        assert.equal(png.data.subarray(1, 4).toString(), "PNG");
        assert.match(await toast(), /Downloaded .*png/);
        await tap("#btnExport");
        await page.click('#exportMenu [data-img]');
        await wait(200);
        await page.check('input[name=imgScope][value="chain"]', { force: true });
        await page.check('input[name=imgFormat][value="svg"]', { force: true });
        assert.match(await page.textContent("#imgDims"), /Vector/);
        if (await page.$("details.more:not([open]) > summary")) await page.click("details.more > summary"); // resolution and sheet are under More options
        await page.check('input[name=imgScale][value="2"]', { force: true });
        await page.check('input[name=imgTheme][value="light"]', { force: true });
        const svg = await download(() => page.click("#imgGo"));
        assert.match(svg.name, /elee-2250u.*\.svg$/);
        assert.match(svg.data.toString(), /<svg[\s\S]*mononoki/);
        await page.check('input[name=imgFormat][value="png"]', { force: true }).catch(() => {});
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      });

      await check("copy fallback when a download is blocked", async () => {
        await page.evaluate(() => { window.__cou = URL.createObjectURL; URL.createObjectURL = () => { throw new Error("blocked"); }; });
        await tap("#btnExport");
        await page.click('#exportMenu [data-dl="txt"]');
        await wait(200);
        assert.ok(await visible("#copyDlg"));
        assert.match(await page.inputValue("#copyText"), /# PrereqFlow export/);
        await page.click("#btnCopy");
        await wait(200);
        assert.match(await toast(), /Copied|Selected/);
        await page.evaluate(() => { URL.createObjectURL = window.__cou; });
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#copyDlg"));
      });

      await check("line input: rows, paste, keys, label, add and Undo", async () => {
        await tap("#btnImport");
        await wait(200);
        assert.ok(await visible("#importDlg"));
        const first = "#prows .prow:first-child .ptext";
        await page.fill(first, "ZZZ 1000U Check One");
        assert.match(await page.textContent("#prows .prow:first-child .pinfo"), /✓ ZZZ 1000U/);
        assert.match(await page.textContent("#btnAddRows"), /Add 1 course/);
        await page.press(first, "Enter");
        assert.equal(await page.$$eval("#prows .prow", r => r.length), 2);
        await page.keyboard.press("Backspace");
        assert.equal(await page.$$eval("#prows .prow", r => r.length), 1, "Backspace removes the empty row");
        await page.click("#addRow");
        await page.evaluate(() => {
          const el = document.querySelectorAll("#prows .ptext")[1];
          const dt = new DataTransfer();
          dt.setData("text/plain", "2-1\nZZZ 2000U Check Two (ZZZ 1000U)\nTechnical elective\nZZZ 2010U Check Three (ZZZ 2000U or ZZZ 1000U)");
          el.focus();
          const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
          Object.defineProperty(ev, "clipboardData", { value: dt }); // Firefox ignores clipboardData in the constructor
          el.dispatchEvent(ev);
        });
        await wait(100);
        assert.ok((await page.$$eval("#prows .prow.ok", r => r.length)) >= 3, "paste split into rows");
        assert.ok(await visible("#skipped"), "skipped lines listed");
        await page.focus("#prows .prow:nth-child(2) .ptext");
        await page.keyboard.press("ArrowUp");
        assert.equal(await page.evaluate(() => document.activeElement.closest(".prow") === document.querySelector("#prows .prow")), true, "↑ moves up");
        const last = "#prows .prow:last-child .ptext";
        await page.fill(last, "3-2 ZZZ 3000U Check Four");
        await page.focus(first);
        assert.equal(await page.inputValue("#prows .prow:nth-last-child(1) .psem").catch(() => page.$$eval("#prows .psem", s => s[s.length - 1].value)), "6");
        await page.click("#btnAddRows");
        await wait(500);
        assert.ok(await visible("#reportDlg"), "report");
        assert.match(await page.textContent("#reportBody"), /loaded/);
        assert.equal(await cardCount(), 162);
        await page.click("#btnUndoImport");
        await wait(400);
        assert.equal(await cardCount(), 158, "Undo import");
      });

      await check("file import: chooser and drop, report, errors", async () => {
        await tap("#btnImport");
        await page.click("#tabFiles");
        assert.ok(await visible("#paneFiles"));
        const json = { format: "prereqflow", courses: [{ code: "YYY 1000U", name: "From a file", semester: 1, prereqs: [], coreqs: [] }], plan: { completed: [], goals: ["YYY 1000U"] } };
        await page.setInputFiles("#fileInput", { name: "mine.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
        await wait(600);
        assert.ok(await visible("#reportDlg"));
        assert.equal(await cardCount(), 159);
        await page.click("#btnUndoImport");
        await wait(300);
        await page.evaluate(() => {
          const dt = new DataTransfer();
          dt.items.add(new File(["XXX 1000U Dropped course"], "dropped.txt", { type: "text/plain" }));
          for (const t of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await wait(600);
        assert.ok(await visible("#reportDlg"), "drop imports");
        assert.equal(await cardCount(), 159);
        await page.click("#btnUndoImport");
        await wait(300);
        await page.setInputFiles("#fileInput", { name: "map.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
        await wait(400);
        assert.match(await page.textContent("#reportTitle"), /Nothing imported/);
        assert.match(await page.textContent("#reportBody"), /PDFs aren't imported/);
        await page.keyboard.press("Escape");
      });

      await check("JSON export imports back, with its plan", async () => {
        await page.click(await tool("#btnHome"));
        await page.click("#wFile");
        await page.setInputFiles("#fileInput", path.join(SHOTS, "..", "export.json"));
        await wait(700);
        assert.equal(await cardCount(), 158);
        await page.keyboard.press("Escape");
      });

      await check("zoom: buttons, keys, wheel, motion switch", async () => {
        await page.click("#zFit");
        await wait(700);
        const z = async () => parseInt(await page.textContent("#zPct"), 10);
        const fit = await z();
        await page.click("#zIn");
        await wait(700);
        assert.ok((await z()) > fit, "zoom in");
        await page.click("#zOut");
        await wait(700);
        await page.click("#zPct");
        await wait(700);
        assert.equal(await z(), 100, "100%");
        await page.keyboard.press("0");
        await wait(700);
        assert.equal(await z(), fit, "0 fits");
        await page.keyboard.press("+");
        await wait(700);
        assert.ok((await z()) > fit, "+ zooms");
        await page.keyboard.press("1");
        await wait(700);
        assert.equal(await z(), 100, "1 is 100%");
        if (!phone) {
          const vp = await page.$("#viewport");
          const b = await vp.boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.wheel(0, 400);
          await wait(800);
          assert.ok((await z()) < 100, "wheel zooms out");
        }
        // the run starts with motion off; the switch turns it on and off again. Online that
        // switch is the gear's Animations setting; offline the zoom bar has its own.
        assert.equal(await page.getAttribute("html", "data-motion"), "off");
        assert.equal(await page.isVisible("#zMotion"), !DESIGN, DESIGN ? "no second motion switch beside the gear's" : "offline motion switch shown");
        const motion = on => DESIGN ? page.evaluate(m => SiteDesign.set({ motion: m }), on) : page.click("#zMotion");
        await motion(true);
        assert.equal(await page.getAttribute("html", "data-motion"), null);
        assert.equal(await page.getAttribute("#zMotion", "aria-pressed"), "true");
        await wait(300);
        assert.ok(await page.evaluate(() => document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList.contains("card"))), "cards float");
        await motion(false);
        assert.equal(await page.getAttribute("html", "data-motion"), "off");
        assert.equal(await page.getAttribute("#zMotion", "aria-pressed"), "false");
      });

      await check("theme switch", async () => {
        if (DESIGN) {
          await page.evaluate(() => SiteDesign.set({ theme: "console" }));
          assert.equal(await page.getAttribute("html", "data-theme"), "console");
          await shot("5-console");
          await page.evaluate(() => SiteDesign.set({ theme: "light" }));
          await wait(200);
          await shot("6-paper");
          await page.evaluate(() => { SiteDesign.reset(); SiteDesign.set({ motion: false }); });
        } else {
          await tap("#btnTheme");
          assert.equal(await page.getAttribute("html", "data-theme"), "light");
          await shot("6-paper");
          await tap("#btnTheme");
          assert.equal(await page.getAttribute("html", "data-theme"), "dark");
          if (await sheetOpen()) await page.click("#btnMenu");
        }
      });

      await check("dialogs keep focus inside", async () => {
        await tap("#btnAdd");
        await wait(200);
        for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(() => !!document.activeElement.closest("#editDlg")), "Tab stays in the dialog");
        for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
        assert.ok(await page.evaluate(() => !!document.activeElement.closest("#editDlg")), "Shift+Tab stays in the dialog");
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#editDlg"));
      });

      if (!phone) await check("every toolbar control is reachable by Tab with a visible ring", async () => {
        await page.focus(".bar a"); // the first thing in the bar
        const seen = new Set(), bad = [];
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          const info = await page.evaluate(() => {
            const a = document.activeElement;
            if (!a || a === document.body) return null;
            const cs = getComputedStyle(a);
            const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\d/.test(cs.boxShadow) && cs.boxShadow !== "none";
            return { id: a.id || a.textContent.trim().slice(0, 20), ring, inBar: !!a.closest(".bar, header") };
          });
          if (!info || !info.inBar) break;
          seen.add(info.id);
          if (!info.ring) bad.push(info.id);
        }
        assert.ok(seen.size >= 8, `reached ${[...seen].join(", ")}`);
        assert.deepEqual(bad, [], "no focus ring on " + bad.join(", "));
      });

      await check("Escape order: dialog, then pin", async () => {
        await clickCard("ELEE 2250U");
        await wait(500);
        await tap("#btnImport");
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#importDlg"));
        assert.ok(await visible("#details"));
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#details"));
      });

      await check("start screen button, empty state", async () => {
        await tap("#btnHome");
        assert.ok(await visible("#welcomeDlg"));
        await page.keyboard.press("Escape");
        assert.ok(await page.isHidden("#welcomeDlg"), "closes while a sheet is loaded");
      });

      await check("no sideways page scroll after use", async () => {
        const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(sw <= iw + 1, `${sw} > ${iw}`);
      });
      await check("no script errors", async () => assert.deepEqual(errors, []));
      await check("no requests leave the site", async () => assert.deepEqual(outside, []));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => r[2] !== "ok");
  for (const r of results) console.log(`${r[2] === "ok" ? "  ok  " : "  FAIL"}  ${r[0]} · ${r[1]}${r[3] ? `\n          ${r[3]}` : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
