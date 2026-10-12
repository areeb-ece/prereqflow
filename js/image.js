/* PrereqFlow image export: draws a flat list of drawing operations to a
 * high-resolution canvas (PNG) or to a standalone SVG document.
 *
 * spec = { width, height, bg, ops: [...] } in CSS pixels, where each op is one of
 *   { t: "rect",  x, y, w, h, fill?, stroke?, sw?, dash? }
 *   { t: "path",  d, stroke, sw?, dash?, fill? }          d is SVG path data
 *   { t: "arrow", x, y, dir, color, size? }               tip at (x, y), dir ±1
 *   { t: "text",  x, y, text, size, weight?, color, anchor?, ls? }   y = baseline
 * and may carry `a` (opacity, 0–1).
 */
const PFImage = (() => {
  "use strict";

  const FONT = '"mononoki", ui-monospace, Menlo, Consolas, monospace';
  // Browsers refuse canvases past ~16k px per side; Safari also caps total area.
  const MAX_SIDE = 16000, MAX_AREA = 120e6;

  let measureCtx = null;
  function measure(text, size, weight = 400) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = `${weight} ${size}px ${FONT}`;
    return measureCtx.measureText(text).width;
  }

  // Word-wrap to at most maxLines lines of maxW px; the last line gets an ellipsis.
  function wrap(text, maxW, size, weight = 400, maxLines = 2) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const tryLine = cur ? cur + " " + words[i] : words[i];
      if (measure(tryLine, size, weight) <= maxW || !cur) { cur = tryLine; continue; }
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines) { cur = words.slice(i).join(" "); break; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const rest = lines.slice(maxLines - 1).join(" ");
      lines.length = maxLines - 1;
      lines.push(rest);
    }
    const last = lines.length - 1;
    if (last >= 0 && measure(lines[last], size, weight) > maxW) {
      let s = lines[last];
      while (s.length > 1 && measure(s + "…", size, weight) > maxW) s = s.slice(0, -1);
      lines[last] = s.trimEnd() + "…";
    }
    return lines;
  }

  // Largest scale ≤ wanted that keeps the canvas inside browser limits.
  function fitScale(w, h, wanted) {
    let s = wanted;
    s = Math.min(s, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
    return Math.max(0.25, Math.floor(s * 100) / 100);
  }

  function arrowPts(op) {
    const s = op.size || 7, d = op.dir || 1;
    return [[op.x, op.y], [op.x - d * s, op.y - s * 0.46], [op.x - d * s, op.y + s * 0.46]];
  }

  async function toCanvas(spec, scale) {
    if (document.fonts && document.fonts.load) {
      try { await Promise.all([document.fonts.load(`400 12px ${FONT}`), document.fonts.load(`700 12px ${FONT}`)]); } catch (e) { /* fall back to system mono */ }
    }
    const cv = document.createElement("canvas");
    cv.width = Math.round(spec.width * scale);
    cv.height = Math.round(spec.height * scale);
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("This browser could not create a canvas that large.");
    ctx.scale(scale, scale);
    ctx.fillStyle = spec.bg;
    ctx.fillRect(0, 0, spec.width, spec.height);
    ctx.lineCap = "butt";
    for (const op of spec.ops) {
      ctx.setLineDash(op.dash || []);
      ctx.globalAlpha = op.a == null ? 1 : op.a;
      if (op.t === "rect") {
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fillRect(op.x, op.y, op.w, op.h); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw || 1; const o = (op.sw || 1) / 2; ctx.strokeRect(op.x + o, op.y + o, op.w - 2 * o, op.h - 2 * o); }
      } else if (op.t === "path") {
        const p = new Path2D(op.d);
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(p); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw || 1; ctx.stroke(p); }
      } else if (op.t === "arrow") {
        const pts = arrowPts(op);
        ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.closePath();
        ctx.fillStyle = op.color; ctx.fill();
      } else if (op.t === "text") {
        ctx.font = `${op.weight || 400} ${op.size}px ${FONT}`;
        ctx.fillStyle = op.color;
        ctx.textAlign = op.anchor === "end" ? "right" : op.anchor === "middle" ? "center" : "left";
        ctx.textBaseline = "alphabetic";
        if ("letterSpacing" in ctx) ctx.letterSpacing = (op.ls || 0) + "px";
        ctx.fillText(op.text, op.x, op.y);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return cv;
  }

  function canvasToBlob(cv) {
    return new Promise(res => cv.toBlob(b => res(b), "image/png"));
  }

  // PNG with automatic step-down if the browser rejects the canvas size.
  async function toPNG(spec, wantedScale) {
    let scale = fitScale(spec.width, spec.height, wantedScale);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const cv = await toCanvas(spec, scale);
        const blob = await canvasToBlob(cv);
        cv.width = cv.height = 0;
        if (blob && blob.size > 1000) return { blob, scale, w: Math.round(spec.width * scale), h: Math.round(spec.height * scale) };
      } catch (e) { /* try smaller */ }
      scale = Math.max(0.5, Math.floor(scale * 0.7 * 100) / 100);
    }
    throw new Error("The image is too large for this browser. Try a lower resolution or fewer courses.");
  }

  const x = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = v => Math.round(v * 100) / 100;

  // fonts: [{ weight, base64 }] embedded so the SVG renders the same anywhere
  function toSVG(spec, fonts = []) {
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(spec.width)}" height="${n(spec.height)}" viewBox="0 0 ${n(spec.width)} ${n(spec.height)}">`);
    const faces = fonts.map(f => `@font-face{font-family:"mononoki";font-weight:${f.weight};src:url(data:font/woff2;base64,${f.base64}) format("woff2");}`).join("");
    out.push(`<style>${faces}text{font-family:${FONT.replace(/"/g, "'")};}</style>`);
    out.push(`<rect width="100%" height="100%" fill="${spec.bg}"/>`);
    for (const op of spec.ops) {
      const dash = (op.dash && op.dash.length ? ` stroke-dasharray="${op.dash.join(" ")}"` : "") + (op.a != null && op.a < 1 ? ` opacity="${op.a}"` : "");
      if (op.t === "rect") {
        const o = op.stroke ? (op.sw || 1) / 2 : 0;
        out.push(`<rect x="${n(op.x + o)}" y="${n(op.y + o)}" width="${n(op.w - 2 * o)}" height="${n(op.h - 2 * o)}" fill="${op.fill || "none"}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${op.sw || 1}"` : ""}${dash}/>`);
      } else if (op.t === "path") {
        out.push(`<path d="${op.d}" fill="${op.fill || "none"}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${op.sw || 1}"` : ""}${dash}/>`);
      } else if (op.t === "arrow") {
        out.push(`<path d="M${arrowPts(op).map(p => p.map(n).join(",")).join(" L")} Z" fill="${op.color}"${op.a != null && op.a < 1 ? ` opacity="${op.a}"` : ""}/>`);
      } else if (op.t === "text") {
        const anchor = op.anchor && op.anchor !== "start" ? ` text-anchor="${op.anchor}"` : "";
        const ls = op.ls ? ` letter-spacing="${op.ls}"` : "";
        out.push(`<text x="${n(op.x)}" y="${n(op.y)}" font-size="${op.size}"${op.weight && op.weight !== 400 ? ` font-weight="${op.weight}"` : ""} fill="${op.color}"${anchor}${ls}>${x(op.text)}</text>`);
      }
    }
    out.push("</svg>");
    return out.join("\n");
  }

  return { FONT, measure, wrap, fitScale, toCanvas, toPNG, toSVG };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PFImage;
