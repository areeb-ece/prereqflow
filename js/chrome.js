/* PrereqFlow page chrome: behaviour that belongs to the layout, not to the chart. It reads and
 * writes no app state.
 *   - On a phone the bar's actions (Import, Export, Add course, Start screen) fold into a
 *     sheet under the ☰ button. It closes on Escape, on a click outside it, after an action
 *     and when the window grows back to desktop width.
 *   - An open dialog keeps keyboard focus: Tab and Shift+Tab cycle inside it. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const sheet = $("#menuSheet"), btn = $("#btnMenu");
const narrow = matchMedia("(max-width: 900px)");

function setSheet(open) {
  if (!open && !$("#exportMenu").hidden) $("#btnExport").click(); // its menu closes with it
  if (open) sheet.setAttribute("data-open", ""); else sheet.removeAttribute("data-open");
  btn.setAttribute("aria-expanded", String(open));
}
const isOpen = () => sheet.hasAttribute("data-open");
btn.addEventListener("click", () => {
  setSheet(!isOpen());
  if (isOpen()) { const f = sheet.querySelector("button:not(:disabled)"); if (f) f.focus(); }
});
// an action inside the sheet closes it; Export only opens its menu, which stays in the sheet
sheet.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && b.id !== "btnExport" && narrow.matches) setSheet(false);
});
document.addEventListener("pointerdown", e => {
  if (isOpen() && !sheet.contains(e.target) && !btn.contains(e.target)) setSheet(false);
});
window.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !isOpen()) return;
  if (!$("#exportMenu").hidden) return; // the export menu closes first (app.js)
  if ([...document.querySelectorAll(".overlay")].some(o => !o.hidden)) return; // so does a dialog
  e.stopImmediatePropagation();
  setSheet(false);
  btn.focus();
}, true);
narrow.addEventListener("change", () => { if (!narrow.matches) setSheet(false); });

// focus stays inside the topmost open dialog
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
document.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const overlay = [...document.querySelectorAll(".overlay")].reverse().find(o => !o.hidden);
  if (!overlay) return;
  const items = [...overlay.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length && !el.closest("[hidden]"));
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1], cur = document.activeElement;
  if (!overlay.contains(cur)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
});
})();
