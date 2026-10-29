# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: Ontario Tech engineering students** checking what a course needs and unlocks and planning
  their next terms: before registration, after failing or dropping a course, or when choosing a
  specialization. They arrive on a laptop or a phone, and the tool has to work well on both.
- Secondary: academic advisors, and hiring visitors who reach the tool from the portfolio
  (areeb-ece.github.io).

## Product Purpose

Program maps list courses by semester and hide the dependency structure. PrereqFlow draws it: every
course is a card and every prerequisite is a link. Students can see a course's full chain and
everything it unlocks, mark completed courses to see what they can take now, set goals to get the
courses still needed in order, check whether a missed course delays later terms, and export a
flowchart. Success: a student finds their program, understands a chain, and leaves with a plan or an
image of it.

## Positioning

- All 16 Ontario Tech engineering program maps (2026–2027) are built in: 158 courses, 266
  prerequisite links, including the rules that aren't course lists (Capstone's years 1–3, credit-hour
  thresholds).
- Free flow lays out the graph so every prerequisite is always left of the courses that need it, with
  a tested Sugiyama-style layout.
- Plan mode computes availability and a step-by-step goal path; completions count in every program.
- Each program's engineering electives fill the slots its map leaves, only from its own electives list and only with courses offered in that term; a chosen elective is an ordinary course from then on.
- A static page with no server, no account and no tracking; everything stays in the browser.

## Operating Context

- Served at areeb-ece.github.io/prereqflow/ from this repo's GitHub Pages; it also runs from disk.
- Part of a family with the portfolio, OTU Calendar and Satisfactory Tools. The shared design system
  (`/design/` in the portfolio repo: themes, scales, `sd-` components, settings panel, night sky) is
  the visual authority, and changing it restyles every site. A copy in `css/fallback.css` covers
  offline use and older deploys.
- Course data comes from the official program maps; students should always check the academic
  calendar.

## Capabilities and Constraints

- Plain HTML, CSS and JavaScript: no framework, no build step, no server, no new dependencies.
  `npm test` covers the parser, layout and planner.
- Built-in data, plus your own courses as typed lines, or JSON/CSV/text files exported from PrereqFlow.
  PDF import exists but is switched off.
- Storage: `localStorage` only (the session, the plan, and the shared design settings).
- Behaviour, data handling, storage keys and URLs are stable; design work restyles and reorganizes.

## Brand Commitments

- Name: PrereqFlow; wordmark PREREQ/FLOW; credit "made by areeb · areeb-ece.github.io/prereqflow" on
  the page and on every exported image. Written "areeb", lowercase.
- Libre Franklin for interface text; mononoki for the wordmark, course codes, chart cards and exports
  (confirmed 2026-10-20).
- Unofficial: "for planning, not official advising". It never suggests Ontario Tech endorses it.
- Voice: plain, short, says what a thing does.

## Evidence on Hand

- `data/ontario-tech-engineering-2026-2027.json`: the built-in program maps.
- The README documents every feature. There are no testimonials, user counts or endorsements; never
  invent any.

## Product Principles

1. The chart is the product: controls serve reading and planning the graph, and never crowd it.
2. Never lose a student's work: sessions and plans persist, and destructive actions can be undone.
3. One family: tokens and components come from the shared design system, not local copies of it.
4. Works on a phone and with a keyboard, as well as with a mouse.
5. Honest data: unofficial, with a pointer to the academic calendar.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast in every shared theme, full keyboard use with visible focus, focus kept
inside dialogs, touch targets from the shared control sizes, and `prefers-reduced-motion` or the
settings panel's Animations switch stops ambient motion.
