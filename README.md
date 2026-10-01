# ADMIRALTY LEDGER

A browser-based naval admiralty idle/management simulation with a DEFCON-style CRT vector aesthetic.
Next.js (App Router) · TypeScript (strict) · Tailwind · Zustand · native Canvas 2D.

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck
npm run build
npm run verify:map     # determinism / connectivity / tier checks for all archetypes (add -- --ascii to draw them)
npx tsx scripts/verifySim.ts 730 [seed] [CHOKEPOINT|CORRIDOR|RIMLAND] [--surge]   # headless soak test of the sim
npm run verify:tutorial   # headless bot plays every briefing lesson and checks its gate
npm run verify:names      # fictional skin never shows a real vendor/product name (data, events, lessons, UI source)
npm run verify:preview    # every action preview agrees with its command (blocked iff refused), no NaN, no leaks
npm run verify:economy    # fiscal year, carryover, support: an idle navy cannot hoard and ends worse off than an active one
npm run verify:contacts   # every contact intent vs every SOP / ROE behaves as documented
npm run verify:relations  # vendor ladder, regimes, bloc affinity, open-architecture CMS
npm run verify:supply     # hidden sub-suppliers, due diligence, sanctions through components (always foreshadowed)
npm run verify:contracts  # build contracts: deposit, instalments, cancellation refunds by fault, resale
npm run verify:cold       # cold vendors: policy-shift vote, bloc introduction, JV export drive
npm run verify:combat     # raids cripple and send ships to repair instead of deleting them; only heavy overkill sinks
npm run verify:shipping   # civilian shipping: lanes, raiders vs cover, distress, escorts, war-risk, trade index, searches, exclusion orders
node scripts/e2e-tutorial.mjs   # same, through the real UI (Playwright; see the file header)
```

## Status & docs

Free play is complete; the guided tutorial is designed but not built. Start with [`docs/HANDOFF.md`](docs/HANDOFF.md) for the
current state and next task, then the plans: [tutorial](docs/PLAN-tutorial.md), [foreign contractors](docs/PLAN-foreign-contractors.md),
[asymmetric faction](docs/PLAN-asymmetric-faction.md), [submarines](docs/PLAN-submarines.md), [civilian shipping](docs/PLAN-shipping.md).

UI: Share Tech Mono font; use **A− / A+** in the top bar to scale the whole interface (saved in the browser).

## Playing

The title screen offers the **Admiral's Briefing** (a guided two-sector scenario, 17 lessons, ~20 minutes, replayable from the top bar) or **Free play**.

| Control | Action |
|---|---|
| Wheel / drag / double-click | Zoom, pan, refit the tactical plot |
| Left-click sector or task force | Select (sector panel / order of battle) |
| Right-click sector (TF selected) | Order the task force on station |
| ▶ / 1x 4x 16x | Sim clock — one tick is one day |
| Generate | New theatre from any seed string (deterministic), optionally forcing an archetype |

Loop: keep every sector covered without over-deploying. Ships rotate **Maintenance → Transit/Workup → Patrol**
(Rule of Thirds). *Surge* tempo, or *Hold station*, suspends rotation and buys presence at the price of
breakdowns. Broken modules need spares (rush-buy, stock, or cannibalising a **Parts Hulk** — any docked hull).
Foreign hardware is cheap and good but hostage to **export sanctions** (warning → freeze / parts embargo / licence
revocation): lobby ministries with Political Capital, research **domestic substitutes**, or re-kit stalled hulls.
Mixing protocols (`TACTICOS_ETHERNET`, `NATO_LINK16`, `EASTERN_ANALOG`, `DOMESTIC_OPEN`) incurs **integration
friction** (slower CMS reaction, sensor tracking lag) until R&D completes a **protocol bridge** — permanently, fleet-wide.

## Architecture

```
app/                page (client-only cockpit), layout, CRT theme
components/map/     TacticalMap (canvas loop, pan/zoom, picking), CRTOverlay
components/tutorial/ TutorialCard, TutorialSpotlight, Term (glossary tooltips); components/TitleScreen
components/ui/      CommandBar, SectorPanel, OrderOfBattle, ShipDesignerModal, RDBureauPanel, DiplomacyLedger, EventFeed
lib/generator/      prng, noise, distance (EDT), marchingSquares, seedMap (archetypes + bathymetry), sectors, nameGenerator, geo
lib/sim/            tutorialScenario, designEngine, fleetEngine, combatSim, researchEngine, diplomacyEngine, worldEngine, navigation, scenario, commands
lib/tutorial/       lessons (pure data + gates), glossary
lib/types/          map, equipment, hull, diplomacy, fleet, world
lib/data/catalog.ts vendors, hulls, modules, R&D projects, starter designs
store/              useFleetStore — clones the world, runs a pure engine/command, commits, logs events; useTutorialStore — lesson state machine + UI flags
scripts/            verifyMap.ts, verifySim.ts
```

### Procedural map (`lib/generator`)

1. `Rng` — xmur3-hashed string seed → Mulberry32, with `fork(label)` child streams so new consumers never perturb existing ones.
2. **Archetypes** build a signed land field (positive = land) plus "carves" that keep straits open:
   *Chokepoint* — radial funnel pinched to a 1–3 tile neck (noise fades out at the neck so its width is a parameter);
   *Corridor* — Catmull-Rom spline channel with a waist, barrier islets and shoals;
   *Rimland* — ellipse-ringed interior sea with 2–3 meandering island straits.
   Macro shape is combined with domain-warped fBm; stranded water is filled so navigable water is one body.
3. **Bathymetry** is a signed distance field (exact Euclidean transform) → depth curve, then trench noise, seabed shoals and a
   sign-preserving smooth. Tiers: littoral `[-0.15,0]`, shelf `[-0.60,-0.15]`, abyssal `< -0.60`.
4. **Marching squares** (`marchingSquares.ts`) traces exact-keyed contours, stitches polylines and Chaikin-smooths them:
   coastline (level 0) and bathymetric isolines (−0.15, −0.35, −0.6, −0.9).
5. **Sectors & chokepoints** (`sectors.ts`): a persistence-based watershed over the clearance (distance-to-land) field finds
   basins; saddles between *major* basins are bottlenecks. Narrow saddles become STRAIT sectors, oversize basins are bisected,
   slivers absorbed, connectivity repaired, sectors numbered west→east and named by geometry (`SECTOR 4: WESTERN REACH`).

Determinism is verified per seed (identical elevation fingerprint and sectors). The cockpit is client-only because the generator
uses `Math.*` transcendental functions whose last-bit results may differ between JS engines.

### Rendering (`TacticalMap.tsx`)

Vector layers are `Path2D`s built once per map. Grid, isolines, glowing coast (`shadowBlur`, additive `lighter` pass) and sector
borders are cached in an offscreen canvas and re-rendered only when the view changes, so the per-frame cost is a blit plus markers.
Threat and selection tint is a map-sized bitmap repainted only when its signature changes. The rAF loop reads the Zustand store
imperatively — React never re-renders per frame.

### Simulation

`worldEngine.advanceDay` = economy → diplomacy (tension walk, sanction state machine) → construction → R&D → sector threat →
fleet Rule of Thirds (A* routing over water, readiness decay, over-deployment failures, spares/cannibalisation) → contacts and
`combatSim` engagements (detection window − reaction − tracking lag, both inflated by unbridged friction). The RNG for day *n* is
`Rng(seed:day:n)`, so a run is reproducible.
