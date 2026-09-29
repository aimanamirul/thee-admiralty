# Handoff — where the project stands

Read this first in a new session. Last updated 2026-09-29.

## State of the code

Working on branch `claude/dreamy-meitner-z28x7t`. `npm run typecheck`, `npx next build`, `npm run verify:map` and
`npx tsx scripts/verifySim.ts` all pass as of this commit. The game is playable in free-play mode (see `README.md`).

Done since the first cockpit commit:
- **Font:** Share Tech Mono via `next/font/google` (`app/layout.tsx`, `tailwind.config.ts`, `app/globals.css`). Single weight, so no bold.
- **UI scale:** all text sizes are rem-based (12px minimum). `uiScale` (0.85–1.6) lives in `useFleetStore`, is applied to the root
  `font-size` in `Cockpit.tsx`, persisted in `localStorage` (`al.uiScale`), changed with A−/A+ in `CommandBar.tsx`. Canvas labels in
  `TacticalMap.tsx` multiply by it and read the computed font family.
- **Plans** (all in `docs/`, none implemented): tutorial, foreign contractors, asymmetric "Movement" faction.

Not committed on purpose: the `dev` script in `package.json` was locally changed to `--port 3009` by the user; leave it alone.

## Decisions already made by the user

| Topic | Decision |
|---|---|
| Vendor names | **Toggle**; default fictional aliases, real names are a skin. Sanction text stays generic. |
| Submarines | **Yes**, a new hull class (`SUBMARINE`). |
| Tutorial scenario | **Fixed scenario on a fixed 2-sector map**, teaching the game "A to Z". |
| Order of work | **Tutorial first.** Contractors, submarines and the Movement faction are for later brainstorming/design, not to be built yet. |
| Movement faction | Fictional setting; invented geography recommended (still open); guardrails in its doc are mandatory. |

Defaults chosen by the assistant for things the user has not answered (change freely): tutorial is **offered on first launch**
(launcher card: Begin briefing / Free play); **terse military-briefing voice**; **Codex deferred**.

## Next task: implement the tutorial (nothing written yet)

Spec and lesson table: `docs/PLAN-tutorial.md`. The concrete engineering design below was worked out but **not coded**.

### Engine changes
1. `WorldDraft.scripted: boolean` (`lib/types/world.ts`, set `false` in `lib/sim/scenario.ts`, carried through `pickWorld`/`worldPatch`
   in the store). When `true`, disable *random* events so lessons are deterministic:
   random contact spawns (`worldEngine.tickContacts`), random sanction rolls and tension walk/spikes (`diplomacyEngine.tickDiplomacy`;
   keep WARNING→FROZEN→lift state transitions), random module failures and grounding (`fleetEngine.advanceFleets`).
2. Export a helper from `lib/generator/sectors.ts` that builds `Sector[]` and border polylines from a caller-supplied `Int16Array`
   sector grid (wraps the existing internal `describeSectors` + `traceBorders`).
3. `lib/sim/tutorialScenario.ts`: `generateMap('BRIEFING-01','CHOKEPOINT')`, then split water at the narrow chokepoint's x into
   **Sector 0 "HOME APPROACHES"** and **Sector 1 "BEYOND THE STRAIT"**, rebuild sectors/borders, keep the single chokepoint
   (`links [0,1]`, name "THE NARROWS"), recompute `homePort` inside sector 0. Assert both sectors are 4-connected and a route exists
   from port to sector 1.
   Starting world: budget ~2500, industrial capacity 2, RP 150, PC 20, `policy.autoSpares=false`, sector 0 ROE `HOLD_FIRE` threat ~20,
   sector 1 threat ~55. Fleet: TF-1 (frigates SHP-1 on patrol 20d, SHP-2 workup; corvette SHP-3), TF-2 (two FACs), all in port.
   Vendors: Naval Group 50, Aselsan 55 (so the preset designer sensor is purchasable), others default.
4. Store additions (`store/useFleetStore.ts`): `loadWorld(w)`, `mutate(fn)` (runs an arbitrary `WorldDraft` edit through the existing
   `run` path), `designerPreset: ShipDesign | null` + setter, consumed by `ShipDesignerModal` as its initial state.

### Tutorial layer
- `store/useTutorialStore.ts` (imports the game store, never the reverse): `active`, `lessonIndex`, `flags: string[]` (`'*'` = all),
  `startSeq`, `targetSectorId`, `completing`; actions `begin/skip/replay/evaluate/advance/finish`; `useUiFlag(flag)` returns
  `!active || flags.includes('*') || flags.includes(flag)`. `evaluate` runs on every game-store change; a satisfied gate shows
  "objective complete" for ~1.4 s, then advances. Persist done/skipped in `localStorage` (`al.tutorial`).
- `lib/tutorial/lessons.ts` (pure, no store import): `Lesson { id, title, body, anchor?, reveals[], tab?, pause?, preset?, target?(w),
  onEnter?(w: WorldDraft), gate?(v: TutorialView) }`. `TutorialView` is a plain subset of game state plus `startSeq`, so gates can
  also run headlessly.
- UI: `TutorialCard` (bottom-left of the map, non-modal: title, body, objective checkbox, Skip), `TutorialSpotlight` (polls
  `[data-tutorial="…"]`, dim mask with pulsing outline, `pointer-events:none`, honours `prefers-reduced-motion`), launcher overlay,
  a "Briefing" replay button in `CommandBar`, pulsing objective ring on the target sector in `TacticalMap`.
- Gating (only the top bar, tabs, aside, ticker, thirds gauge, spares yard, organise form, layer toggles, design button need
  `useUiFlag`). Flags: `PANEL, TAB_SECTOR, TAB_FLEET, TAB_RND, TAB_DIPLO, DATE, CLOCK, TICKER, READOUT_BUDGET|INDUSTRY|RP|PC|TENSION,
  THIRDS, SPARES, ORGANISE, DESIGN_BTN, LAYERS`. The A−/A+ UI-scale control is always visible.
- Add a small `<Term>` glossary tooltip component (ROE, littoral, friction index, parts hulk, tempo) and use it on the key labels.

### Lesson script (11 lessons; all events are scripted via `onEnter`)
| # | Lesson | Setup on enter | Gate |
|---|---|---|---|
| 0 | Reading the plot (legend) | reveal panel + Sector tab | any sector selected |
| 1 | Sectors, threat, ROE | — | sector 0 ROE becomes `RETURN_FIRE` |
| 2 | Put ships on station | reveal Fleet tab, clock, ticker, budget | TF-1 assigned to sector 0 and within 3 tiles of its anchor |
| 3 | Chain of command | reveal organise form | TF-1 renamed |
| 4 | Rule of Thirds | SHP-1 `stateDays=26`; reveal gauge; 16x, auto-pause | log shows "rotating to MAINTENANCE" |
| 5 | Contact & engagement | spawn one hostile contact ~15 tiles from TF-1 inside sector 0, strength ~20 | log shows `ENGAGEMENT` |
| 6 | Breakdown & spares | SHP-3 → dock with failed `SEN_DOM_DSR2`, stock 0; reveal spares | SHP-3 has no failed module |
| 7 | Design bureau | preset **corvette that overloads the grid** (`PP_DOM_D6, CMS_NG_TACTICOS, SEN_ASEL_SPEAR, ARM_NG_SYLVER8, ARM_NG_MM40, ARM_DOM_GUN76`; fix = swap plant to `PP_DOM_D12`); reveal designer + industry | a ship is `CONSTRUCTING` |
| 8 | Integration friction & R&D | the SPEAR/TACTICOS mismatch gives friction; reveal R&D tab + RP | `BR_L16_TAC` completed (16x, auto-pause) |
| 9 | Sanctions & lobbying | Aselsan → `WARNING` (export freeze in 12 d), standing 52; reveal Diplomacy, PC, tension | Aselsan standing ≥ 65 |
| 10 | Parts embargo & hulk | Naval Group → `FROZEN` + `PARTS_EMBARGO` 60 d; SHP-1 in dock with failed `CMS_NG_TACTICOS`; SHP-2 in dock, healthy; stock 0 | SHP-1 repaired and a ship `isPartsHulk` |
| 11 | Graduation | reveal all; `scripted=false`, `autoSpares=true`; raise sector 1 threat | TF-2 assigned to sector 1; then card: keep scenario / new theatre |

Purchases and orders should feel real, not scripted; only *events* are injected.

### Verification to write with it
- `scripts/verifyTutorial.ts`: headless bot that applies each lesson's `onEnter`, performs the intended action with the existing
  `commands.ts` functions, advances days until the gate is true, and fails on soft-locks, lost ships, or gates that never open
  (mirrors `verifySim.ts`). Also assert the sector connectivity/route checks above.
- A Playwright walk-through later, once the UI exists.

## Design backlog (do not build yet)
- `docs/PLAN-foreign-contractors.md` — relationship ladder, regime profiles, new vendors, submarines, alias toggle.
- `docs/PLAN-asymmetric-faction.md` — the second playable faction and its coalition AI.

## Gotchas learned
- The cockpit is client-only (`dynamic(..., { ssr:false })`) because the generator's float results can differ across engines.
- On this Windows setup use `python -` or PowerShell for scripted edits; `pkill -f` from the Bash tool can kill its own shell.
- Two local sessions may run in this folder; check `git status` for unexpected changes before large edits.
