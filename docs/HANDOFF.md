# Handoff — where the project stands

Read this first in a new session. Last updated 2026-09-29 (tutorial implemented).

## State of the code

Working on branch `claude/dreamy-meitner-z28x7t`. `npm run typecheck`, `npx next build`, `npm run verify:map` and
`npx tsx scripts/verifySim.ts` all pass as of this commit. The game is playable in free-play mode (see `README.md`).

Done since the first cockpit commit:
- **Font:** Share Tech Mono via `next/font/google` (`app/layout.tsx`, `tailwind.config.ts`, `app/globals.css`). Single weight, so no bold.
- **UI scale:** all text sizes are rem-based (12px minimum). `uiScale` (0.85–1.6) lives in `useFleetStore`, is applied to the root
  `font-size` in `Cockpit.tsx`, persisted in `localStorage` (`al.uiScale`), changed with A−/A+ in `CommandBar.tsx`. Canvas labels in
  `TacticalMap.tsx` multiply by it and read the computed font family.
- **Plans** (in `docs/`): tutorial (now implemented, see below), foreign contractors and asymmetric "Movement" faction (design only).

Not committed on purpose: the `dev` script in `package.json` was locally changed to `--port 3009` by the user; leave it alone.

## Decisions already made by the user

| Topic | Decision |
|---|---|
| Vendor names | **Toggle**; default fictional aliases, real names are a skin. Sanction text stays generic. |
| Submarines | **Yes**, a new hull class (`SUBMARINE`). |
| Tutorial scenario | **Fixed scenario on a fixed 2-sector map**, teaching the game "A to Z". Launched from a **title-screen** choice (Begin briefing / Free play). |
| Order of work | **Tutorial first.** Contractors, submarines and the Movement faction are for later brainstorming/design, not to be built yet. |
| Contractors (2026-09-29) | Curated 8 vendors + 3 staged cold vendors (Japan-, China-, India-type); hazards fully avoidable via information (due diligence reveals `origins`); soft bloc affinity; rebalance economy so budget bites; fictional names by default with a real-name skin. Roster, aliases, phases: `docs/PLAN-foreign-contractors.md` §8-10. Alias set approved; no extra protocol tags in v1 (open to refinement later). |
| Command & economy (2026-09-30) | Action preview strip; domestic support with graduated effects; 360-day fiscal year in quarterly tranches with 15% carryover; contact SOP per sector with per-contact override. Runs before contractors phase 1. `docs/PLAN-command-and-economy.md`. |
| Movement faction | Fictional setting; invented geography recommended (still open); guardrails in its doc are mandatory. |

Defaults chosen by the assistant for things the user has not answered (change freely): **terse military-briefing voice**; **Codex deferred**.

## Tutorial: implemented ("Admiral's Briefing")

Title screen (`components/TitleScreen.tsx`, shown on every page load) offers **Begin briefing** (recommended on first run; shows
Completed/Skipped afterwards) or **Free play** (optional seed/archetype). A **Briefing** button in the top bar replays it (confirm,
replaces the current game). Progress status lives in `localStorage` (`al.tutorial`: done | skipped).

How it is built (spec/lesson table: `docs/PLAN-tutorial.md`):
- **Engine:** `WorldDraft.scripted` disables random events (contact spawns, sanction rolls, tension walk, standing decay, module failures,
  groundings, sector-threat drift); lessons inject their own events. `Contact.pursue` makes a scripted contact steer straight at a task force.
  `sectorsFromGrid()` in `lib/generator/sectors.ts` builds sectors/borders from a hand-made grid.
- **Scenario:** `lib/sim/tutorialScenario.ts` — `generateMap('BRIEFING-01','CHOKEPOINT')` split at the narrow strait into
  sector 0 HOME APPROACHES / sector 1 BEYOND THE STRAIT, one chokepoint THE NARROWS, 5 ships in TF 11 / TF 12. Throws if the split is
  not two connected, mutually reachable sectors.
- **Lessons:** `lib/tutorial/lessons.ts` (12 lessons, pure data; gates take a plain `TutorialView` so they also run in Node).
  `lib/tutorial/glossary.ts` + `components/tutorial/Term.tsx` give hover definitions for jargon.
- **State machine:** `store/useTutorialStore.ts` (imports the game store, never the reverse). `evaluate()` runs on every game-store change
  (subscription in `Cockpit.tsx`); a met gate shows "objective complete" for 1.4 s, pauses the clock, then advances. `run: {speed, when?}`
  starts the clock on entry or once a condition holds. `useUiFlag(flag)` / `useTutorialLocked()` gate the UI; lessons reveal flags
  cumulatively and the last lesson reveals `*`.
- **UI:** `TutorialCard` is a strip *between the map and the ticker* (never over the plot) and is repeated inside the designer modal
  (`compact`), which would otherwise cover it. `TutorialSpotlight` dims the page and pulses an outline on the lesson's `data-tutorial`
  anchor (hidden while the designer is open). `TacticalMap` draws a pulsing OBJECTIVE ring on the lesson's target sector. Store additions:
  `loadWorld`, `mutate`, `designerPreset` (the designer opens on it).
- **Verification:** `npm run verify:tutorial` (headless bot plays all 12 gates with the real commands; fails on soft-locks, gates open on
  entry, lost ships, disconnected sectors, presets that are not broken/fixable as taught). `scripts/e2e-tutorial.mjs` plays the same path
  through the real UI with Playwright (see its header). Both pass.

Review fixes (post first implementation):
- **Spotlight** dims at 35% and not at all when the lesson's action is on the plot (lessons with a `target`), so the map is never masked
  while it is the objective.
- **Reserve frigate `SHP-6`** (built last in `tutorialScenario.ts` so other names stay stable): laid up in dock with a failed power plant and
  no spare. The fleet is six hulls, so the Rule-of-Thirds lesson ends at 2/2/2 (its onEnter stages SHP-2/SHP-3 to relieve SHP-1; the bot asserts
  it), and the embargo lesson hulks this worn ship instead of a healthy sister. Expect periodic "DOCK STALLED" lines for it; they foreshadow
  the hulk lesson.
- **Resume:** a checkpoint (world minus map, ledger, flags) is saved to `localStorage` `al.tutorial.checkpoint` at the start of every lesson;
  the title screen then offers **Resume briefing** (restarts that lesson). Cleared on skip, finish and graduation; discarded if the lesson
  ids no longer match.
- Map: the fit reserves the measured height of the toolbar overlay; OBJECTIVE label moved upper-right of the ring; no latitude label in the
  top-left corner.

Lessons that need the player to do something with the clock (2 press play; 6 buy a spare) start it automatically once the action is done.

- **Lesson 6 is a decision now:** it opens the sector panel with two unidentified tracks inbound (a raider and a neutral merchant) and
  starts the clock only once the player sets an ROE (`setRoe` now logs `ROE SECTOR n: ...`; `Lesson.select` opens a sector on entry).
  WEAPONS FREE engages the merchant while unidentified: an incident (-8 PC, +5 tension). `verify:tutorial` plays the raid under all three
  ROEs and asserts no ship is lost and that only WEAPONS FREE causes the incident. Identified neutrals stop pursuing.
- **Hulk in one click:** docked rows show a skull button (`data-tutorial="hulk-<id>"`). Hulk controls are hidden behind a new `HULK` UI flag,
  revealed by the embargo lesson, so the corvette in the spares lesson cannot be hulked by mistake (that would soft-lock lesson 7).

Known limits / ideas (from the review, not yet done): the layout jumps as panels unlock (reserve space up front) — deliberately deferred
until after contractors phase 1 and the economy rebalance, which change the top bar and Diplomacy tab. Also: Codex tab deferred; advisor nudges and early-game pacing (docs/PLAN-tutorial.md §4) not done; engine detail: hostile
contacts are engaged at 12 tiles before the 10-tile identification, so hostiles are never seen turning red first.

## Contractors phase 0: display-name layer (done)

Vendors, countries, modules, R&D projects and protocols now have a fictional default and a real-name skin (top-bar **Names** button and the
title screen; persisted in `localStorage` `al.skin`).
- `lib/data/catalog.ts` carries the FICTIONAL names (Halberd Dynamics, Meridian Navale, Sarnic Defence, Arsenal Yards; Meridian TACTIS, VL-41,
  Alliance Link, ...). `lib/data/names.ts` holds the REAL overrides and `resolveText(text, skin)`. Internal ids (`RAYTHEON`, `CMS_NG_TACTICOS`,
  `NATO_LINK16`) are unchanged and never shown.
- **Name tokens** (`lib/data/tokens.ts`: `vt/vst/ct/mt/pt/xt/xst` produce `{v:ID}`, `{m:ID}`, `{p:ID}`, `{x:PROTO}`...) are what engine events,
  refusals, lesson copy and catalogue blurbs contain. Components resolve them at render time with `useNames()` (`store/useNames.ts`; `n.t(text)`,
  `n.v/vs/c/m/p/x/xs(id)`), so toggling the skin also relabels old ledger entries. **Rule: never write a vendor / module / project / protocol name
  into engine or lesson text; emit a token.**
- `npm run verify:names` proves it: tables complete, both skins resolve with no leftover tokens, and the fictional skin shows no real name in
  catalogue data, lesson copy, engine events from 3 archetypes x 700 high-tension days, or static UI source (comments excluded). A mutation test
  (planting a real name in a lesson, an event and a component) is caught by all three checks.
- Not yet aliased: the 4 vendors that do not exist yet (Nordvik, Seorak, Kessler-Brandt, cold vendors); add them to `catalog.ts` (fictional) and
  `names.ts` (real) when phase 1 lands. Tutorial anchors (`vendor-ASELSAN`) still use internal ids on purpose.

## Action preview strip (done, 2026-09-30)

A one-line strip under the tactical ticker (and at the bottom of the designer modal) shows the **predicted effect** of whatever action is
hovered or keyboard-focused: costs, before -> after values, time to effect, risks, and the reason when blocked.
- `lib/sim/preview.ts`: pure preview functions over a world snapshot; several dry-run the real command on a copy, so a preview cannot
  disagree with its command. Text uses name tokens.
- `Btn` takes `preview={(w) => ...}` (kit.tsx). Buttons with a preview use `aria-disabled` instead of `disabled`, because browsers fire no
  hover events on disabled buttons and the blocked reason is exactly what the strip should show. `store/usePreviewStore.ts` holds the
  preview *function*, so the strip recomputes live while the pointer rests on an action. The map previews the right-click order when a task
  force is selected.
- **Rule: every new player action gets a `preview`.**
- `npm run verify:preview`: ~2,900 previews across every tutorial lesson and three free-play theatres; a preview says BLOCKED exactly when the
  command refuses, never shows NaN/undefined, resolves tokens, and leaks no real names. Banned-name matching in `verify:names` and
  `verify:preview` is whole-word ("DOM" no longer matches "DOMESTIC").

## Domestic support & fiscal year (done, 2026-09-30)

`lib/sim/politicsEngine.ts` replaces the flat 8M/day income (all constants at the top of the file):
- **Money in:** an annual appropriation (fiscal year = 360 days) paid in 4 quarterly tranches. **Money out:** running costs every day —
  crew wages for every commissioned hull (even docked), fuel/yard fees by state, base overhead, +3%/year ageing — plus purchases.
- **Year end:** up to 15% of the appropriation carries over, the rest returns to the Treasury (deficits carry as debt, support −5).
  "Spent this year" is derived from balances (opening + tranches − budget), so no spend site needs a hook.
- **Forecast** for next year = 3000 × support factor × tension factor × underspend factor (pace < 70%) × hearing boost × inquiry cut;
  ±10% range that narrows and **locks on day 330**.
- **Domestic support** 0–100: reverts to 50, rallies with tension, falls with deficits, frozen builds, exposed high-threat sectors,
  incidents (−6), losses (−8), unopposed probes (−1.5), revoked licences (−3), export freezes (−1.5); kills +2, averted sanctions +1.5.
  Elections every 720 days halve the distance to 50 ± 10 (disabled in scripted worlds). Graduated effects at 40 / 25 / 10 exactly as in
  the plan; PC regen follows support.
- **Budget hearing** command (10 PC, ×1.5 when strained; 60-day cooldown; chance 25% + 0.6 × support; success +6% next year up to +20%,
  failure −4 support). Preview shows the odds, never the roll.
- UI: top-bar **Support** meter (hidden in the tutorial until graduation via `READOUT_SUPPORT`); **Home front** section at the top of the
  Diplomacy tab (support bands, fiscal year, costs, carryover cap, projected return to Treasury, forecast bar and factors, hearing button);
  lobby buttons show the support-adjusted price.
- `npm run verify:economy`: an idle "duck" vs a prudent active navy, 3 years × 3 theatres: tranches and year closes on schedule, hoarding
  bounded, no NaN, and the active navy ends with more hulls, higher support and a larger appropriation than the duck.
  A reckless bot that buys whenever it has 400M goes bankrupt into inquiries (the system working as intended).
- Tuning note: with 6 sectors and 2 task forces, a player covering only 2 sectors settles near support ~40.

## Contact SOP ladder (done, 2026-09-30)

`lib/sim/contactEngine.ts` owns contacts (moved out of `worldEngine.ts`, which re-exports `IDENTIFY_RANGE` / `ENGAGE_RANGE`).
- Hidden **intent** per contact: MERCHANT, FISHING, SMUGGLER, SHADOWER, WARSHIP, RAIDER (`hostile` = RAIDER). Spawn mix shifts with
  sector threat. Raiders hunt task forces within 24 tiles; shadowers keep station 14–18 tiles out; warned smugglers run.
- **Ladder** (one step per contact per day, by the nearest task force with ships at sea): HAIL (26) · WARN (20) · BOARD (16) · ENGAGE (12);
  SHADOW as an order = hold. Outcomes per intent live in `execute()` and are summarised for previews in `OUTCOMES`.
- **Sector SOP** (`SectorState.sop`): OBSERVE (visual ID only) · CHALLENGE (hail 20, warn silent at 14, board runners at 16; free-play default) ·
  ASSERTIVE (hail 26, board silent contacts at 16 without warning, warn warships off). ROE is the ceiling: HOLD FIRE never engages first,
  RETURN FIRE engages identified hostiles only, WEAPONS FREE also auto-engages unidentified contacts inside 12.
- **Per-contact orders** (`Contact.order`, command `orderContact`): click a contact on the plot or in the sector's contact list; the Contact
  panel shows status, nearest task force, ROE ceiling and the ladder with previews. Surprise: a raider attacking under HOLD FIRE keeps
  surprise unless warned or already identified; boarding a disguised raider is an ambush (always surprised).
- Support/tension hooks: incidents (scaled by intent; warships worst), seizures (+25M, support +2, `stats.seizures`), escaped smugglers,
  completed surveillance runs.
- Tutorial: both tutorial sectors use OBSERVE (so lesson 6 behaves exactly as taught); graduation switches all sectors to CHALLENGE. The
  graduation lesson now asks for *a* task force in BEYOND THE STRAIT and warns the FACs cannot defend themselves (hunting raiders sank them
  in the soak). The Assign preview warns "AIR DEFENCE WEAK" when interceptors at sea < 3 × expected raid missiles.
- `npm run verify:contacts`: every intent vs every SOP/ROE, rates over 30 seeds (e.g. ASSERTIVE seizes >85% of smugglers and more than
  CHALLENGE; boarding a raider is an ambush >90%; a warned raider never keeps surprise). `verify:preview` covers contact and SOP previews.
- In a 2-year free-play soak with 2 task forces the ladder fires ~7–15 hails per theatre; most contacts appear in uncovered sectors.

## What to build next

Per `docs/PLAN-command-and-economy.md`: steps 1–3 are done. Next: **contractors phase 1** (`PLAN-foreign-contractors.md` §10), then the tutorial
pass (teach the fiscal year, support and the SOP ladder; fix the layout jump). Confirm with the user first. (sector SOP + per-contact override), then contractors phase 1. The layout-jump fix waits for the tutorial pass
after those.

## Design backlog (do not build yet)
- `docs/PLAN-foreign-contractors.md` — relationship ladder, regime profiles, new vendors, submarines, alias toggle.
- `docs/PLAN-asymmetric-faction.md` — the second playable faction and its coalition AI.

## Gotchas learned
- The cockpit is client-only (`dynamic(..., { ssr:false })`) because the generator's float results can differ across engines.
- On this Windows setup use `python -` or PowerShell for scripted edits; `pkill -f` from the Bash tool can kill its own shell.
- Two local sessions may run in this folder; check `git status` for unexpected changes before large edits.
