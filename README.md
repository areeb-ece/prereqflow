# PrereqFlow

**Live: [areeb-ece.github.io/prereqflow](https://areeb-ece.github.io/prereqflow/)** · made by areeb

Course prerequisite flowcharts in the browser. Every course is a card and every
prerequisite is a link, so you can see what a course needs and what it unlocks.

All **16 Ontario Tech University engineering program maps (2026–2027)** are built in:
158 courses and 266 prerequisite links. **Plan mode** lets you tick off the courses
you've finished, see what you can take now, and set goal courses to get the courses
still needed for them, in order. You can also bring your own courses as typed lines or
as a JSON/CSV/text file exported from PrereqFlow earlier.

It's a static site with no build step, no framework and no server. Open `index.html`
and it runs.

---

## Purpose

University program maps list courses by semester, but they hide the dependency
structure. You can't see at a glance that a fourth-year course sits at the end of a
five-course chain that starts in first year. PrereqFlow draws that structure so
students and advisors can:

- see the full prerequisite chain behind a course, and everything it unlocks
- mark completed courses and see what is available next, or plan a route to a goal
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
- **[B] Your own courses**: open **Line input**, or load a `.json` / `.csv` / `.txt`
  (for example one you exported from PrereqFlow earlier).

Every Ontario Tech engineering program map is built in, so PDFs aren't imported.
For other course lists, paste the text into Line input.

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
| `p` | switch between Explore and Plan |

Three requirements aren't plain course lists, and are shown on the card as a small tag:

- **Capstone Systems Design I** (`Y1–3`) needs every program course in years 1–3.
  Every year 1–3 course shown (all of them in the all-programs view) links to it. So
  that those links don't tangle with the rest, they leave each card into the gap on
  its right, drop to a bus that runs under the whole sheet, and rise into Capstone,
  which sits at the bottom of its column.
- **Engineering Economics** (`54 cr`) needs at least 54 credit hours and **Ethics, Law
  and Professionalism** (`84 cr`) at least 84. These have no links, since no fixed set of
  courses makes up the credits; every course counts as 3 credit hours. (Computer
  Networks' "54 credit hours" note is read the same way.)

### Plan mode

**Explore / Plan** in the toolbar switches between analysing the program maps and
planning. Turning plan mode off only hides the plan; nothing is cleared.

- **✓ completed** (the default): click a course to mark it completed, and again to
  unmark it. Courses you can take now get a blue ring and an **available** tag;
  locked courses fade back. A course is available when every prerequisite group has a
  completed course (one is enough for either/or), each corequisite is completed or
  available, the credit threshold is met (completed courses × 3) and, for Capstone,
  every year 1–3 course is done.
- **◎ goal**: click a course to make it a goal. The courses still needed for all goals
  are marked **step 1, step 2, …** and their links light up. Step 1 is what you can take
  now; each later step only needs earlier ones (corequisites can share a step). For an
  either/or requirement the option with the fewest courses left is used, and a course
  with a credit threshold moves back until enough courses come before it.
- **pin**: click to open a course's details, which also have **Mark completed** and
  **Set as goal** buttons.

The **plan panel** lists your goals, the path to them step by step, and every course
available now. Completions count everywhere: a course marked in Mechanical is also
completed in Electrical and the all-programs view. For Capstone, the program shown
decides which year 1–3 courses count; in the all-programs view it's the program with
the fewest left. The plan is saved in the browser, separately from the sheet, so it
survives reloads, **Start over** and program switches, and a JSON export carries it
too.

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
  chain, the **goal path** (goals, the courses still needed and the completed courses
  leading in), or exactly the visible area. Trees, chains and the goal path get a fresh compact layout of
  their own.
- **Show the plan**: draws the sheet as plan mode does: completed courses in green,
  available ones ringed, goals and path courses with their step numbers, the path's
  links lit, and credit/Capstone progress on locked courses. A band under the chart
  lists the goal path step by step, the title line adds completed / credit hours /
  available counts, and the legend explains the marks. It's on by default in plan mode
  and works with every course choice, PNG or SVG.
- **Resolution**: 2×, 3×, 4× or 6× PNG. The scale steps down automatically if it
  would exceed the browser's canvas limits. **SVG** gives a vector copy with the font
  embedded.
- **Current theme**, **dark** or **light / print** sheet, with an optional title block
  and legend.
- Every image carries a credit (`made by areeb · areeb-ece.github.io/prereqflow`),
  shown as a badge in the title block and in the footer.

**Export → JSON / CSV / Text lines** saves the course data. All three import back
into PrereqFlow. A JSON export also carries your plan (completed and goal courses),
which is added to the current plan on import, so it's how you move a plan to another
browser.

## How it works

```
index.html                    page shell: toolbar, chart stage, dialogs
css/style.css                 soft drafting-sheet theme (night + paper fallback), motion
js/theme.js                   offline fallback: remembered light/dark sheet and motion
js/parser.js        PF        course text / PDF table → course records
js/layout.js        PFLayout  course records → card positions + routed links
js/plan.js          PFPlan    completed + goal courses → availability and goal path
js/image.js         PFImage   drawing ops → high-res PNG canvas or SVG
js/app.js                     state, import, rendering, zoom, highlights, plan, export
data/*.json                   built-in Ontario Tech data (PrereqFlow export format)
data/*.js                     the same data wrapped for <script> loading (generated)
assets/fonts/                 mononoki (SIL Open Font License)
scripts/build-data.js         regenerates data/*.js from data/*.json
tests/                        node:test suites for the parser, layout and planner
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

Capstone's years 1–3 links are **bus links**: they count for free-flow columns (so
Capstone stays right of everything it needs) but take no part in lanes, ordering,
crossings or placement. They're routed last as right angles with rounded corners:
a riser in the gutter right of each source column, one bus below the lowest card, and
a rise into the target from the gutter on its left.

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
in your browser only, and so is the plan (completed and goal courses, under its own
key so starting over never clears it) and the display settings (shared with the other
sites on areeb-ece.github.io). Nothing is uploaded anywhere.

## Development

```sh
npm test               # parser, layout + planner tests (node:test, no dependencies)
npm run build:data     # regenerate data/*.js after editing data/*.json
npm run check:data     # verify data/*.js matches data/*.json (run in CI)
```

To update the built-in programs: set `PDF_IMPORT = true` in `js/app.js` (the PDF
reader is kept but switched off), load the new program-map PDFs in the app, export
JSON, replace `data/ontario-tech-engineering-2026-2027.json` and run
`npm run build:data`. Then add back the credit-hour notes on ENGR 3360U and ENGR 4760U
if the maps still leave them out, and switch `PDF_IMPORT` off again.

## Credits

- Made by **areeb**: [areeb-ece.github.io/prereqflow](https://areeb-ece.github.io/prereqflow/).
- Typeface: [mononoki](https://github.com/madmalik/mononoki) by Matthias Tellen,
  SIL Open Font License 1.1 (`assets/fonts/OFL-mononoki.txt`).
- PDF reading (switched off; used to build the data): [pdf.js](https://mozilla.github.io/pdf.js/),
  loaded from a CDN only when a PDF is imported.
- Course data: Ontario Tech University program maps, 2026–2027. Always check the
  official academic calendar before you plan.

## License

MIT. See [LICENSE](LICENSE).
