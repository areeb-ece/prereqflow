# PrereqFlow

**Live: [areeb-ece.github.io/prereqflow](https://areeb-ece.github.io/prereqflow/)** · made by areeb

Course prerequisite flowcharts in the browser. Every course is a card and every
prerequisite is a link, so you can see what a course needs and what it unlocks.

All **16 Ontario Tech University engineering program maps (2026–2027)** are built in:
158 courses and 266 prerequisite links. You can also bring your own courses as typed
lines or as a JSON/CSV file exported from PrereqFlow earlier.

It's a static site with no build step, no framework and no server. Open `index.html`
and it runs.

---

## Purpose

University program maps list courses by semester, but they hide the dependency
structure. You can't see at a glance that a fourth-year course sits at the end of a
five-course chain that starts in first year. PrereqFlow draws that structure so
students and advisors can:

- see the full prerequisite chain behind a course, and everything it unlocks
- check whether a missed or failed course delays later semesters
- compare programs and specializations that share courses
- export a clean, high-resolution flowchart for planning or presentation

## Getting started

```sh
git clone https://github.com/areeb-ece/prereqflow.git
cd prereqflow
python3 -m http.server 8080      # or: npm run serve
# open http://localhost:8080
```

You can also open `index.html` directly from disk. Everything works that way except
embedding the font into SVG exports, because browsers block `fetch()` on `file://`
(the SVG then falls back to the viewer's monospace font).

## Using it

### Start screen

Each visit opens on a start screen with two choices:

- **[A] Ontario Tech Engineering**: load the 16 built-in program maps. You can
  start with all of them or pick a single program.
- **[B] Your own courses**: open **Line input**, or load a `.json` / `.csv` that you
  exported from PrereqFlow earlier.

Direct parsing of program-map PDFs only supports the Ontario Tech program-map
layout, and all of those maps are already built in. For anything else, paste the
course text into Line input.

If a previous session is saved in the browser, a **Resume last session** button
appears as well.

### Line input format

One course per line:

```
1-1
MATH 1010U Calculus I
PHY 1010U Physics I
1-2
MATH 1020U Calculus II (MATH 1010U)
PHY 1020U Physics II (PHY 1010U; Coreq: MATH 1020U)
2-2
MECE 2430U Dynamics (MECE 2230U, MATH 2860U or MATH 2050U)
```

| Text | Meaning |
| --- | --- |
| `A, B` / `A and B` | both required |
| `A or B` / `A/B` | either one is enough (drawn dashed) |
| `Coreq: C` | corequisite, drawn like a prerequisite |
| `Credit restrictions: …`, `Exclusions: …` | kept as a note, not drawn |
| `2-1`, `Year 2 Semester 1`, `S3` | sets the semester for the lines below it |
| no semester given | placed by course level (2000-level → 2-1) |

You can paste many lines at once, including text that wraps across lines when copied
out of a PDF. Each course ends up on its own row and is checked as you type.

### Layouts

- **Semesters**: columns are the semesters listed in the program map (1-1 … 4-2).
- **Free flow**: semesters are ignored, and the columns come from the prerequisite
  graph. **Every prerequisite is always placed left of the courses that need it.**
  This shows how deep each chain really is, independent of when the program
  schedules the course.

### Reading the chart

| Action | Result |
| --- | --- |
| hover a course | trace its prerequisite chain (needs) and what it unlocks |
| click | pin it and open the detail panel |
| **shift + click** | highlight that course's prerequisite **tree** |
| double-click | edit the course |
| `/` | search by code or name |

### Zoom and navigation

- **scroll**: zoom in and out around the pointer, with eased motion
- **drag**: pan (a sideways trackpad swipe or **shift + scroll** also pans)
- **pinch** (trackpad or touch screen): zoom
- **shift + drag**: draw a box and zoom into that part of the chart
- `+` / `-` / `0` (fit) / `1` (100%), or the zoom bar at the bottom right
- **Zoom to chain** (detail panel) and **Zoom to trees** (highlight bar) frame
  just the courses involved

### Motion

The sheet is never still:

- Every course card floats on a slow wave that ripples across the sheet, plus a small
  wobble of its own. Links stay attached to the cards as they move.
- A soft sheen sweeps across each card from time to time, and a faint light and a
  field of stars drift slowly behind the sheet.
- Traced and highlighted links carry small particles that flow towards the course
  they unlock.
- Cards fade in when a sheet loads and glide to their new places when you switch
  layouts or programs.

The **motion** button in the zoom bar turns all of this off (it's the same switch as
**Animations** in the settings menu, so it applies to all three sites). If your system
asks for reduced motion, cards still float, at half the distance.

### Themes and settings

The gear icon at the top right opens the settings shared by
[areeb-ece.github.io](https://areeb-ece.github.io/), PrereqFlow and
[OTU Calendar](https://areeb-ece.github.io/otucalendar/): a theme (Night, Paper, Void,
Console, Amber and more, or follow the system), an accent colour, corner style, motion,
and the night sky behind the sheet (number of stars, size, brightness, blur, colour,
drift speed and direction, glow). Choices are saved in your browser and apply on all
three sites.

### Tree highlights

You can highlight any number of trees, each in its own muted colour. Use the detail
panel to choose **prereqs**, **unlocks** or **both**, or shift-click a card for its
prerequisite tree. The highlight bar lists the active trees and lets you dim
everything else, zoom to the trees, or clear them. Highlights are saved with the
session.

### Export

**Export → Image** draws a high-resolution flowchart:

- **Courses**: everything shown, only the highlighted trees, the pinned course's
  chain, or exactly the visible area. Trees and chains get a fresh compact layout of
  their own.
- **Resolution**: 2×, 3×, 4× or 6× PNG. The scale steps down automatically if it
  would exceed the browser's canvas limits. **SVG** gives a vector copy with the font
  embedded.
- **Current theme**, **dark** or **light / print** sheet, with an optional title block
  and legend.
- Every image carries a credit (`made by areeb · areeb-ece.github.io/prereqflow`),
  shown as a badge in the title block and in the footer.

**Export → JSON / CSV / Text lines** saves the course data. All three import back
into PrereqFlow, so a JSON export is also how you save and share a plan.

## How it works

```
index.html                    page shell: toolbar, chart stage, dialogs
css/style.css                 soft drafting-sheet theme (night + paper fallback), motion
js/theme.js                   offline fallback: remembered light/dark sheet and motion
js/parser.js        PF        course text / PDF table → course records
js/layout.js        PFLayout  course records → card positions + routed links
js/image.js         PFImage   drawing ops → high-res PNG canvas or SVG
js/app.js                     state, import, rendering, zoom, highlights, export
data/*.json                   built-in Ontario Tech data (PrereqFlow export format)
data/*.js                     the same data wrapped for <script> loading (generated)
assets/fonts/                 mononoki (SIL Open Font License)
scripts/build-data.js         regenerates data/*.js from data/*.json
tests/                        node:test suites for the parser and layout
```

### Parsing (`js/parser.js`)

Requirement text is split into prerequisite, corequisite and ignored segments
(restrictions, exclusions, recommendations). Each segment is parsed with a small
boolean grammar in which `or` binds tighter than `,` / `and`, and the result is
converted to **CNF**: a list of groups that are all required, where each group is a
set of alternatives. Program-map PDFs are rebuilt from pdf.js text items by
clustering lines into table cells and matching each cell to its semester row label.
When the same course appears in several programs, the records are merged. The
earliest semester is kept, and when one map lists only a subset of alternatives,
the fuller either/or group wins.

### Layout (`js/layout.js`)

Both views use a Sugiyama-style layered graph drawing:

1. **Columns.** In semester view, the column is the semester. In free flow,
   **longest-path layering** puts each course one column right of its latest
   prerequisite. Courses that unlock more than they require are then **pulled
   right**, next to their earliest dependent, which shortens links without ever
   moving a course left of a prerequisite. Cycles in user data (for example mutual
   corequisites) are broken by DFS back-edge removal and drawn as dashed backward
   links.
2. **Lanes.** A link that spans several columns passes through thin lane slots in
   the columns between its ends. Lanes are **bundled per source course**, so a course
   with many dependents sends a single trunk across the sheet that branches where
   needed, and links run through the gaps between cards instead of behind them.
3. **Ordering.** Barycentre sweeps alternate left-to-right and right-to-left, and
   adjacent swaps refine the order. The ordering with the fewest crossings is kept.
4. **Vertical placement.** Each column is placed by weighted **isotonic regression**
   (pool-adjacent-violators). Cards move as close as possible to the mean height of
   their linked neighbours while keeping their order and minimum spacing. A pull
   towards a tight, centred stack stops the sheet from drifting taller than needed.
5. **Routing.** Link ends are spread along card edges in the order of the other
   end, and links are drawn as horizontal-tangent cubic curves through their lanes.

The tests check the free-flow guarantee (prerequisites strictly left) against all 16
programs, the combined view, and data containing corequisites and cycles.

### Look

The default sheets, night (dark) and paper (light), use warm neutrals instead of pure
black and white, one periwinkle/apricot pair for tracing needs/unlocks, and six pastel
hues for tree highlights. All text is set in mononoki.

The colours and themes come from the master palette shared with
[areeb-ece.github.io](https://areeb-ece.github.io/) and OTU Calendar:
`/design/tokens.css`, kept in the portfolio repo under `public/design/` along with the
settings panel and night sky (`ui.js`, `ui.css`) and the script that applies saved
settings before the page paints (`theme.js`). The page loads them after `css/style.css`,
so changing them there restyles all three sites. For themes other than night and paper,
the chart's own colours (links, needs/unlocks) are derived from the theme's in
`css/style.css`. Offline or from disk, those files can't load: the page falls back to
the night/paper values in `css/style.css` and a light/dark button. Image export reads
the current theme, or the master palette's night or paper sheet.

### Ambient motion

Each card runs a Web Animations float (a sum of whole-number harmonics of one 11 s
cycle, sampled into keyframes) pinned to the document clock, so the browser's
compositor moves the cards without layout work. A light timer reads the same clock
and shifts only the end points of each link, which keeps links attached to their
cards; the lanes between columns stay put. To keep it cheap, only cards in or near
the visible area float, and when zoomed far out (where the float is about a pixel on
screen) link ends stop following.

### Zoom

The chart is scaled with a single CSS transform. Wheel input sets a target zoom, and
each animation frame closes part of the gap, so a burst of wheel notches becomes one
smooth glide anchored at the pointer. Moves such as "fit", "zoom to chain" and search
results tween the zoom (in log space) and the camera centre together.

### Rendering and export

The chart is HTML cards over one SVG link layer, scaled with a single CSS transform
for zoom. Column headers sit outside the scaled layer and are repositioned on every
scroll and zoom, so they stay readable at any zoom level. Image export builds a flat
list of drawing operations from a layout (re-running the layout for subsets) and
renders it either to a `<canvas>` at the chosen scale or to SVG.

### Storage

The session (courses, layout mode, filter and highlights) is saved in `localStorage`
in your browser only, and so are the display settings (shared with the other sites on
areeb-ece.github.io). Nothing is uploaded anywhere.

## Development

```sh
npm test               # parser + layout tests (node:test, no dependencies)
npm run build:data     # regenerate data/*.js after editing data/*.json
npm run check:data     # verify data/*.js matches data/*.json (run in CI)
```

To update the built-in programs, load the new program-map PDFs in the app, export
JSON, replace `data/ontario-tech-engineering-2026-2027.json` and run
`npm run build:data`.

## Credits

- Made by **areeb**: [areeb-ece.github.io/prereqflow](https://areeb-ece.github.io/prereqflow/).
- Typeface: [mononoki](https://github.com/madmalik/mononoki) by Matthias Tellen,
  SIL Open Font License 1.1 (`assets/fonts/OFL-mononoki.txt`).
- PDF reading: [pdf.js](https://mozilla.github.io/pdf.js/), loaded from a CDN only
  when a PDF is imported.
- Course data: Ontario Tech University program maps, 2026–2027. Always check the
  official academic calendar before you plan.

## License

MIT. See [LICENSE](LICENSE).
