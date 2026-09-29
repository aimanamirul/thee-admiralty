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

Lessons that need the player to do something with the clock (2 press play; 6 buy a spare) start it automatically once the action is done.

Known limits / ideas: Codex tab deferred; advisor nudges and early-game pacing (docs/PLAN-tutorial.md §4) not done; engine detail: hostile
contacts are engaged at 12 tiles before the 10-tile identification, so hostiles are never seen turning red first.

## What to build next

Per the user's decisions: contractors, submarines and the Movement faction are for design discussion first (see backlog). No code task is
queued; ask the user what to pick up.

## Design backlog (do not build yet)
- `docs/PLAN-foreign-contractors.md` — relationship ladder, regime profiles, new vendors, submarines, alias toggle.
- `docs/PLAN-asymmetric-faction.md` — the second playable faction and its coalition AI.

## Gotchas learned
- The cockpit is client-only (`dynamic(..., { ssr:false })`) because the generator's float results can differ across engines.
- On this Windows setup use `python -` or PowerShell for scripted edits; `pkill -f` from the Bash tool can kill its own shell.
- Two local sessions may run in this folder; check `git status` for unexpected changes before large edits.
