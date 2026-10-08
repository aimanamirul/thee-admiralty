# Handoff — where the project stands

Read this first in a new session. Last updated 2026-09-30 (tutorial: 17 lessons, now also covering shipping, escorts and searches).

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
- **Lessons:** `lib/tutorial/lessons.ts` (17 lessons, pure data; gates take a plain `TutorialView` so they also run in Node).
  `lib/tutorial/glossary.ts` + `components/tutorial/Term.tsx` give hover definitions for jargon.
- **State machine:** `store/useTutorialStore.ts` (imports the game store, never the reverse). `evaluate()` runs on every game-store change
  (subscription in `Cockpit.tsx`); a met gate shows "objective complete" for 1.4 s, pauses the clock, then advances. `run: {speed, when?}`
  starts the clock on entry or once a condition holds. `useUiFlag(flag)` / `useTutorialLocked()` gate the UI; lessons reveal flags
  cumulatively and the last lesson reveals `*`.
- **UI:** `TutorialCard` is a strip *between the map and the ticker* (never over the plot) and is repeated inside the designer modal
  (`compact`), which would otherwise cover it. `TutorialSpotlight` dims the page and pulses an outline on the lesson's `data-tutorial`
  anchor (hidden while the designer is open). `TacticalMap` draws a pulsing OBJECTIVE ring on the lesson's target sector. Store additions:
  `loadWorld`, `mutate`, `designerPreset` (the designer opens on it).
- **Verification:** `npm run verify:tutorial` (headless bot plays all 15 gates with the real commands; fails on soft-locks, gates open on
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

Known limits / ideas (from the review, not yet done): Codex tab deferred; advisor nudges and early-game pacing (docs/PLAN-tutorial.md §4) not done; engine detail: hostile
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

## Contractors phase 1 (done, 2026-09-30)

`lib/sim/relationsEngine.ts`:
- **Relationship ladder** (`Vendor.rung`, `rungProgress`): UNKNOWN (hidden: not in the designer or ledger lists) → CONTACT → TRADE MISSION
  (8 PC, 15 d) → FRAMEWORK (10 PC + 40M, 25 d, standing ≥ 30; **tier-0 lines only**) → SIGNED (15 PC + 60M, 30 d, standing ≥ 50; tiers by
  standing) → STRATEGIC (20 PC + 120M, 45 d, standing ≥ 80; sanction risk ×0.5, lobbying +25%). PC costs follow the support multiplier;
  ministries refuse below support 25. A step stalls while the vendor state has sanctions in force. **Scout for suppliers** (6 PC) reveals the
  next UNKNOWN vendor. `procurability` now gates on `sellableTier(v)`.
- **Regime profiles** (`REGIMES`) replace the old per-vendor `volatility`: hazard, notice days, freeze length, sanction-kind mix, lobbying
  responsiveness and an incident penalty (Vinterland −6, Rheinmark −2, Halcyon −1 standing per incident). Only vendors at FRAMEWORK+ can
  sanction. Diplomacy risk figures use `sanctionRiskPerDay`.
- **Soft bloc affinity:** concluding a step with an EASTERN vendor costs WEST/EURO/NORDIC vendors 4 standing; a western step costs the
  East 2. Shown in the Advance preview.
- **Vendors 6-8:** Nordvik Systems (Vinterland, CONTACT; NV-9 **open-architecture CMS** — `CmsStats.integration` 0.5 halves friction —
  SKY-4 AESA, RB-15 SSM), Seorak Consortium (Seoryeong, CONTACT; ST-30 turbine, Naval Shield open-bus CMS, SV-16 launcher), Kessler-Brandt
  Antriebe (Rheinmark, UNKNOWN; KB-20V diesel, TRS-4 AESA). Halberd Dynamics now starts at FRAMEWORK (its catalogue is tier 2-3, so it
  needs signing). Real-name skins added.
- **Diplomacy tab v2:** Home front, climate, then *Contracted* and *Prospective* supplier groups; each card has rung / regime / bloc chips,
  regime blurb, standing, collapsible catalogue with per-line availability, relationship progress, Advance button and lobbying; an
  *Unknown suppliers* card with Scout.
- `npm run verify:relations`: gating, costs and timings of every rung, scouting, bloc fallout, Vinterland incident penalty, regime sanction
  mixes, strategic risk halving, no sanctions from non-contract vendors over 1,500 high-tension days, open-architecture friction.
- Not yet (phases 2-5): hidden sub-suppliers / due diligence, contracts (deposits, cancel/resale), cold vendors, licensed production.

## Tutorial pass after the new systems (done, 2026-09-30)

The briefing teaches everything added since it was written. 17 lessons (the two shipping lessons were added after the shipping work; see below):

| # | id | Teaches | Gate |
|---|---|---|---|
| 1 | plot | Reading the plot | select a sector |
| 2 | sectors | Threat, ROE, **the preview strip** (hover any action) | set ROE |
| 3 | station | Assign TF 11, run the clock | TF on station |
| 4 | command | Renaming / command | rename TF |
| 5 | thirds | Rule of Thirds | a hull rotates to dock |
| 6 | contact | Raid under ROE (weapons free = incident on the merchant) | ROE decision + raid resolved |
| 7 | **challenge** | SOP ladder: a silent smuggler (`CT-TUT-SMUG`) closes on TF 11; its Contact panel opens; hail, then board | contact gone (seized, escaped or sunk) |
| 8 | spares | Breakdowns, buying spares | corvette repaired |
| 9 | design | Power grid in the designer | corvette laid down |
| 10 | friction | Protocol friction, R&D bridge | bridge started |
| 11 | sanctions | Sanction warning, lobbying | sanction averted |
| 12 | **suppliers** | Supplier ladder, regimes, blocs: open a trade mission with Nordvik | Nordvik advancing past CONTACT |
| 13 | **homefront** | Appropriation, tranches, 15% carryover, support thresholds; reveals the Support readout | budget hearing held |
| 14 | **escort** | Shipping lanes, cover, war-risk and the trade index: escort a tanker past a raider lying in wait at the strait mouth | the tanker leaves the plot (arrived, or lost when unescorted) |
| 15 | **search** | Tip-offs, contraband, the price of a clean search: search a tipped container ship | ship searched (seized or released) |
| 16 | embargo | Parts embargo, one-click hulk | SHP-6 hulked, frigate repaired |
| 17 | graduation | All sectors to SOP CHALLENGE; every lane opens; send a task force beyond the strait; warns that search and exclusion orders are heavy levers | any TF assigned there |

- `Lesson.selectContact` opens a contact's panel on entry; `TutorialView.contacts` lets gates see contacts.
- Worst-case political capital (weapons free incident, every lobby, the hearing) stays positive: `verify:tutorial` logs PC per lesson
  under all three lesson-6 ROE choices (`TUTORIAL_ROE`).
- **Layout no longer jumps:** locked top-bar readouts, the design button, the ticker and the map's layer toolbar keep their space
  (`invisible` / a placeholder) instead of being removed.
- `TutorialSpotlight` scrolls the lesson's anchor into view once per lesson (vendor cards sit far down the Diplomacy tab).
- The lobby preview no longer promises a catalogue tier for a vendor with no contract (tiers need FRAMEWORK+).
- `scripts/e2e-tutorial.mjs` plays all 17 lessons through the UI (hail/board, advance Nordvik, budget hearing, escort, search).
- **Shipping lessons (14-15):** `Lesson.selectMerchant` opens a ship's panel on entry; `TutorialView.shipping`; new UI flags `SHIPPING`
  (lanes section), `INSPECT` (Search buttons, standing search order) and `FORCE` (use of force, exclusion orders) so nothing appears
  before its lesson (graduation reveals all). The briefing world has no lanes until lesson 14 adds one (`tutorialLane`: east to west, the
  first 88 tiles beyond the strait); graduation restores all three lanes. **Scripted worlds now tick shipping** for hand-placed ships
  (movement, raider attacks, rescue, escort, searches) but spawn nothing, drift no war-risk and keep the trade index at 100.
  `verify:tutorial` plays both branches of each lesson on a cloned world (unescorted tanker is lost; a clean search still ends the
  lesson at the cost the preview promised) and the real one (escort arrives, no warship lost). The design lesson now mentions that a
  hull is a contract (30% deposit, cancel or sell). Checkpoint version bumped to 2. Exclusion orders are deliberately not a lesson:
  graduation names them and points at the preview strip.

## Contractors phase 2: supply chains (done, 2026-09-30)

- **Hidden sub-suppliers:** `EquipmentModule.origins` (set in the `ORIGINS` table in `lib/data/catalog.ts`, never mentioned in blurbs):
  `PP_NG_GT25` and `SEN_ASEL_SPEAR` carry Halberd (RAYTHEON) parts, `PP_SK_ST30` Kessler-Brandt gear, `ARM_NV_RB15` a Meridian turbojet.
  Domestic kit has none (checked). Starting fleets carry none of these; the tutorial corvette's SPEAR radar does (a free-play surprise that
  due diligence reveals).
- **Engine:** `lib/sim/supplyChain.ts`. `exposure(m)` = prime + origins. A sanction by any of them hits the module: `procurability`
  ("COMPONENT FREEZE"), `syncConstructionFreezes` (`frozenBy` = the sub-supplier), `moduleOrdersBlocked` / `moduleSpareUseBlocked`
  (spares purchase, fitting, rush orders).
- **Who can sanction:** vendors at FRAMEWORK+ as before, **plus any vendor whose components sit in a hull we operate**, even if UNKNOWN.
- **Fairness (decided: fully avoidable with information):**
  - *Due diligence* (`dueDiligenceCmd`, 12M, 10 days, Diplomacy vendor card): reveals every sub-supplier in that vendor's catalogue;
    an unknown sub-supplier becomes a CONTACT (a second discovery path besides scouting).
  - When a state signals a sanction, `exposeChain` makes its reach public during the warning (and identifies it, so it can be lobbied).
    `tickSupplyChain` also exposes any non-ACTIVE vendor, covering scripted sanctions.
  - No leak by absence: `originView` returns the same "unverified" for a module whether or not it hides anything.
- **UI:** Diplomacy "Supply-chain exposure" section (hulls per vendor, direct vs via components, unverified count); catalogue lines show
  "contains X / no sub-suppliers / unverified"; vendor cards get Due diligence (button, progress, "Supply chain verified"); designer
  options and chips show "+X parts" / "N UNVERIFIED"; Order of Battle module rows show "+X" chips; the lay-down preview lists
  sub-suppliers and unverified modules. Glossary term `DILIGENCE`. The suppliers lesson mentions due diligence (text only).
- `npm run verify:supply`: data rules, no leak, audit timing/cost/reveal, freeze/embargo through components, substitution un-stalls, an
  embedded unknown sub-supplier warns at high tension in 12/12 theatres and every warning exposed the link with the full notice period;
  a non-embedded unknown vendor never acts. `verify:preview` now also sweeps diligence, advance and scout previews.

## Contractors phase 3: build contracts (done, 2026-09-30)

- `lib/sim/contracts.ts`; `Ship.contract` (`BuildContract`: price, paid, paidByVendor, awaitingFunds). Absent = fully paid (scenario
  ships and old checkpoints).
- **Payment:** `orderShip` charges a 30% deposit (the lay-down budget check is the deposit, not the price). `progressConstruction` pays
  the remaining balance evenly over the remaining build days (`instalment`); a hull that cannot pay waits on its slipway ("AWAITING
  FUNDS", logged once); a frozen hull pays nothing. Payments are split by vendor share (modules by prime vendor, the hull to the
  domestic yards) and accumulate in `paidByVendor`. The contract closes on commissioning.
- **Cancel** (any hull under construction): per vendor share paid —
  - domestic yards: 50% salvage;
  - vendor that **cannot deliver** (a product of theirs on the hull is hit by a sanction, theirs or a sub-supplier's; or they revoked):
    `Regime.refundRate` (Aurelle 85% "refunds owed", Vinterland 80%, Seoryeong 75%, Sarnia/Rheinmark 70%, Halcyon 60%, Eastern 30%);
  - vendor that could still deliver: **breach**, 40% refund and −6 standing;
  - a voluntary cancellation (no vendor at fault) costs support −1; a forced one costs nothing.
- **Sell hull** (Mistral case): from 40% built, a third-party navy takes over for 70% of what has been paid; no standing/support cost;
  blocked while any state in the hull's supply chain has revoked (re-export not approved).
- UI: Order of Battle construction panel shows contract paid/price, instalment, awaiting funds, and Cancel contract / Sell hull buttons
  with previews (refund breakdown per vendor). The lay-down preview quotes deposit and daily balance. Glossary term `CONTRACT`.
- "Incident-driven standing loss for restrictive regimes" (the other half of plan phase 3) already shipped in phase 1 (`incidentPenalty`).
- `npm run verify:contracts`: deposit, deposit + instalments = price, on-schedule commissioning, awaiting funds, frozen hulls pay nothing,
  refunds by basis (breach / fault via sub-supplier / yard salvage), standing and support effects, resale threshold and re-export block.
  `verify:preview` now sweeps hulls under construction (cancel, resell).

## Contractors phase 5: cold vendors (done, 2026-09-30)

- Three vendors start `closed` (UNKNOWN and not scoutable; `scoutable()` in relationsEngine; not counted in "Unknown suppliers"):
  `MITSURUGI` (Akitsu Federation; skin Mitsubishi Heavy Industries / JAPAN), `DAHAI` (Dahai Republic; skin CSSC / NORINCO / CHINA),
  `VAYU_SARATH` (Bharatvar / Eastern bloc JV; skin BrahMos Aerospace). New regimes AKITSU (cautious, 30-day notice, refunds 90%,
  incidents −4), DAHAI (volume exporter, refunds 40%), BHARATVAR (joint venture); new bloc NON_ALIGNED. Nine new modules.
- Gates (`lib/sim/coldVendors.ts`, `tickColdVendors`, skipped in scripted worlds):
  - **C1 policy shift:** daily chance `policyDebateChance` (×1.5 support ≥ 50, ×1.5 tension ≥ 60, ×0.25 if an incident in the last 180
    days; `stats.lastIncidentTick` is new). A debate is announced with a vote 30 days out; an incident before the vote sinks it (it can
    come round again); otherwise Mitsurugi becomes a CONTACT. Its VLS hides Halberd parts (due diligence reveals).
  - **C2 introduction:** Zvezda-Nord at standing ≥ 70 on SIGNED+ introduces Dahai as a CONTACT (player lever: lobby Zvezda). Dahai is
    EAST bloc, so each rung costs western standing (existing `blocFallout`). Cheap, low-reliability kit on the Eastern protocol.
  - **C3 export drive:** `exportDriveDay(seed)` in days 200–399, announced 30 days ahead; then Vayu-Sarath is scoutable. Its Seawind
    missiles carry `origins: ['ZVEZDA_NORD']`, and `Vendor.jvPartners` makes that link public (no due diligence), so a Zvezda sanction
    stops them through the phase-2 component rules.
- UI: "Market watch" under Unknown suppliers lists the pending vote, the Zvezda introduction threshold (never naming the hidden vendor)
  and the export drive date.
- Old checkpoints: `loadWorld` backfills vendors missing from a saved world.
- `npm run verify:cold`: hidden at start, scouting ignores closed vendors, the vote is foreshadowed and an incident sinks it, a clean
  record passes it, introduction thresholds (standing and rung) and the lobbying path, western fallout, export drive announcement and
  scouting, JV exposure, skins, scripted worlds stay closed; soak: in 10 theatres × 900 days the reform passed 10/10, drive open 10/10.

## Civilian shipping T1-T3 (done, 2026-09-30; plan in `docs/PLAN-shipping.md`)

- **State:** `WorldDraft.shipping` (`ShippingState`: `lanes`, `ships`, `seq`, `index`, `stats`), types and pure helpers (`tradeFactor`,
  `TRADE_*`) in `lib/types/shipping.ts`; engine `lib/sim/shipping.ts`; `TaskForce.escort?`. The tutorial world is scripted and has no
  lanes (nothing spawns, no UI). `loadWorld` backfills `shipping` on old checkpoints.
- **T1 lanes and traffic:** `generateLanes(map, seed)`: up to 3 routes between distant map-edge gates over water (A* with deep-water
  preference), never clipping land (checked at half-tile steps), the first crossing a chokepoint when the map has one. Ships (tanker,
  container, bulk, ferry; fictional names; flags = home, open registry or a state the player already knows, shown via `{c:ID}`) enter at
  a lane end at `base × traffic` per day (cap 20), sail 4 tiles/day and leave at the other end.
- **T2 threats and protection:** raiders steer at lane ships within 22 tiles when no task force is near, and 60% spawn lying in wait
  on a lane (own Rng stream, so existing spawn rolls are untouched). A raider within 5 tiles of an **unprotected** ship attacks and is
  expended: 30% sunk, 20% seized, 50% damaged (distress). Protected = a task force at sea within 14 tiles (`COVER_RADIUS`) **or** one
  holding the ship's sector (`sectorHeld`: assigned, within 8 tiles of the anchor, a ship at sea). A distressed ship stops; a task force
  in range rescues it (support +1) else it founders after 6 days. `orderEscort` (store `escortMerchant` / `cancelEscort`) makes a task
  force follow a ship at 9 tiles/day (fleetEngine goal override; released if the ship is lost or all hulls dock); arrival under escort
  is "SAFE PASSAGE" (+0.5 support). Losses: support −1 (−2 for the home flag), tension +1, lane risk up, everything logged.
- **T3 war-risk and trade:** each lane's risk drifts (4%/day) to 0.35 × the mean threat of its sectors, +30 sunk / +25 seized / +15
  damaged / +10 foundered, −5 rescue. Traffic = 1 − max(0, risk − 15)/70 (the premium shown is risk × 0.8 %). Risk ≥ 70 reroutes the
  lane for ≥ 30 days (returns when risk < 40); the index (smoothed) = base-weighted traffic. Index → forecast factor `trade`
  (0.85–1.00) and support drift (−0.002 per point below 100). Home Front shows the index and the factor; the Sector overview lists lanes
  with risk meters; **only losses and threat lower the index, never above 100**, so normal trade leaves the economy as it was.
- **UI:** plot layer toggle `shipping` (lanes dotted, red when rerouted, amber when risky; grey ships, amber SOS, cyan escort line),
  click a ship for `MerchantPanel` (status, cover, escort/aid buttons with previews); "Merchant ships in sector" list in the sector
  panel; `ShippingLanes` section; glossary terms `SHIPPING`, `ESCORT`.
- **Verification:** `npm run verify:shipping` (lane validity/determinism, traffic cap, ships stay on lanes, accounting, attack outcome
  shares, cover radius and sector presence, distress, escort, war-risk, reroute, forecast and support effects, name tokens; soak: losses
  98 with no fleet at sea, 87 with the starting fleet, 62 with two task forces on the busiest lane sectors). `verify:preview` sweeps
  escort previews. **`verify:economy` now compares strategies over three seeds per theatre on the totals:** adding shipping shifted the
  random streams and one seed flipped the duck-vs-active comparison (over 24 seeds the active navy still wins 22/24, mean support +8).
- **Not built:** T4 inspections, T5 interdiction and exclusion zones (with polarization and civilian toll), T6 polish; no tutorial lesson
  on shipping yet (candidate: escort the first tanker, read the trade line on the Home Front).

## Civilian shipping T4-T6: inspections, exclusion orders, polarization (done, 2026-09-30)

- **Engine:** `lib/sim/interdiction.ts` (`tickInterdiction`, run right after `tickShipping` and before `tickRelations`, so strikes count as
  incidents for restrictive regimes and the Akitsu vote). Types in `lib/types/shipping.ts` (`ExclusionZone`, `InterdictionPolicy`,
  `normalizeShipping` backfills old saves); `SectorState.inspect`, `TaskForce.escortMode`, `PoliticsState.polarization`.
- **T4 inspections:** every ship hides `contraband` (12% open registry / Eastern flag, 5% other foreign, 2% home, ferries never) and gets a
  `tip` (35% of contraband ships, 2% of clean ones: mostly right, sometimes wrong). Two ways to search: **order a task force** (Search
  button; it goes to the ship, `escortMode: 'INSPECT'`, starts within 6 tiles) or a **sector standing order** for one flag (a task force
  at sea within 10 tiles of a matching ship; select in the sector panel). A search holds the ship 2 days, then: contraband found (90%
  tipped, 55% untipped) is seized (+15% of cargo, support +2); otherwise a clean search costs support −1 (−0.5 home / open registry),
  tension +1, polarization +0.5 and flag-state standing −3.
- **T5 exclusion orders** (`declareZone`, 10 PC, max 2, sectors must lie on a lane): **14-day notice** during which no force is used
  (verified); at once shipping of the flag starts to avoid the zone (80% of its ships reroute, so the trade index, forecast and support
  fall: an order against all foreign flags over a hub can drop the index to ~40), flag state −4 standing (its bloc −2), tension +4,
  lane war-risk +8, polarization +6, support +1.5 (rally). After notice task forces within 10 tiles of a matching ship act by policy:
  *search and release*; *search, seize contraband, turn the rest back* (turned-back ships sail home, counted as `returned`, not a
  passage); *unrestricted* strikes on sight **only in sectors at WEAPONS FREE** (else it turns back). Passenger ferries and the home
  flag are never targets. A strike: ship lost, crew casualties (20-24) added to the **civilian toll**, tension +4, PC −3, flag-state
  standing −10 (bloc −3), polarization +3.x, support +1.5, counted as an incident. **Engage** (merchant panel, two clicks): lawful under
  an unrestricted order in force; otherwise the **gravest incident** (tension +20, PC −15, support −12, flag −20, polarization +10+).
- **Polarization** (`politicsEngine`): eases 0.08/day only while no order is in force; above 20 it drains support
  (`polarizationDrift` = 0.0015 per point above 20 per day) and widens election swings (±(10 + 0.3 × polarization)).
- **T6:** fiscal-year **shipping report** (ledger line + `ShippingState.lastReport`, year counters reset at year end); Home Front shows
  polarization and the toll; `ShippingLanes` shows searches, seizures, turned back, struck, toll and the last report; plot rings on
  ordered sectors (amber notice, red in force); `InterdictionPanel` (orders, policies, lift, new order) in the sector overview;
  glossary terms `INSPECTION`, `INTERDICTION`, `POLARIZATION`.
- **Verification:** `verify:shipping` now also covers contraband odds and tip rates (2,000-ship sample), search hold / costs by flag /
  find rates / seizure pay, standing orders, declaration refusals and costs, no force before notice (unit and a 260-day soak), each
  policy, ROE gating, exemptions, engage lawful vs gravest, polarization drain and decay, self-harm (traffic, index, forecast, recovery
  on lifting), year report, name tokens. `verify:preview` sweeps 7,900 previews including every new order.
- **Not built:** a tutorial lesson on exclusion orders (shipping, escorts and searches have lessons 14-15); movement-faction reuse of the strike layer (design only).

## Raid damage: crippled, not deleted (done, 2026-10-01)

- **Problem (measured):** every leaker's damage was divided by the hull's structural HP and summed with no cap, and integrity ≤ 0 meant the
  ship was removed on the spot. Two FACs (120 HP, no air defence) lost a hull 68% of the time to even a *weak* raid (strength 20) and were
  annihilated by strength 45+ (mean damage 210-351% of integrity). The forced-dock rule (integrity < 25) never fired for ships on workup.
- **Rule now** (`combatSim.ts`, applied in `contactEngine.engagement`): a hit that would take a ship to zero leaves it **crippled at 5%
  integrity** unless it is lost to **overkill**: `sinkChance(integrity, damage) = (damage / integrity − 1) / 3.5`, capped at 90% (1.1x = 3%,
  1.5x = 14%, 2.5x = 43%, 3.5x = 71%). A ship below **35% integrity** (`WITHDRAW_BELOW`) **breaks off at once** (`sendToRepair`, ledger
  line "…breaks off and returns to dock for repair") and uses the existing dock cycle: +1.8% integrity/day, back in service at 90% and the
  minimum dock time (about 48 days from 5%). A ship already crippled and still at sea is lost far more readily (it is the overkill ratio
  against what is left). The combat log caps displayed damage at 100% and marks "(overwhelmed)".
- **Measured after** (FAC pair, no air defence): strength 20 → 7% lose a hull (was 68%); strength 45 → 0.59 hulls/raid (was 1.89); strength
  70 → 1.34 (was 1.99); frigate group at strength 70 → 0 lost, some sent to repair. The graduation lesson and the Assign preview now say
  "crippled and sent back for weeks of repair (sunk outright if the raid is heavy)".
- **Tunables:** `CRIPPLED_FLOOR`, `WITHDRAW_BELOW`, the `3.5` slope in `sinkChance`. No repair bill is charged (an option: a share of hull cost per
  % of damage, which would add a money sink for fighting navies).
- `npm run verify:combat`: the curve, FAC/frigate raids through the real contact engine, the withdrawal and the ledger line, no hull at or
  below 0 integrity or left badly damaged at sea, repair completing in 30-90 days, a pre-crippled hull being lost.

## Presence-scaled deterrence (done, 2026-10-02)

- **Problem:** presence was a yes/no (any ship on patrol = threat −0.5/day; any task force near a merchant = full cover), so a FAC pair
  deterred exactly as much as a carrier group.
- **`lib/sim/presence.ts`:** `shipPower` in *frigate-equivalents* (structure×0.5 + interceptors×12 + firepower×0.12 + air group×3, over 430,
  scaled by readiness and integrity): FAC 0.4, corvette 0.6, frigate 1.0, destroyer ~2.2, carrier ~4.9 (the designer's combat rating was
  not used: it ranks a FAC above a corvette). `presenceFrom(power)` has diminishing returns: 1 → 1.0, 2 → 1.6, 4 → 2.2, capped 2.5.
  Sector presence counts ships on **active patrol** of the forces **holding** the sector (`holdersOf`: assigned, on station, not escorting);
  labels token / light / solid / strong / dominant.
- **Effects:** (1) sector threat falls **0.5 × presence per day** (one frigate = the old 0.5); (2) **raider spawns** are converted to
  ordinary contacts with probability min(0.6, 0.25 × presence) (own rng stream `deter:`); (3) a raider within 24 tiles of a task force
  **turns away** if presence × 30 > its strength (`Contact.deterred`; it never closes, and if it expires it is logged "RAIDER DETERRED":
  threat −2, support +0.3, instead of the unopposed-probe penalty) — a single FAC deters nothing, a frigate group strength ≤ ~28, a carrier
  group up to ~70; (4) **shipping cover is a probability** (`coverChance`: 0.25 + 0.6 × presence of every task force within 14 tiles or
  holding the sector, counted once each, max 0.97; an escort alongside = 0.97): FAC pair 0.75, frigate 0.85, carrier group 0.97.
- **UI:** "Naval presence" row in the sector panel (value, label, threat reduction per day); the Assign preview states the presence the
  move would give together with the forces already there and the raid strength that would turn away; merchant status shows the cover
  percentage; glossary term `PRESENCE`.
- **Measured** (one force holding a sector, threat 60, tension 55, 150 days): mean threat none 44 · FAC pair 31 · frigate 27 · destroyer 17 ·
  carrier group 7; raiders per 200 days at pinned threat none 2.6 · FAC 1.8 · frigate 1.4 · destroyer 1.0 · carrier group 0.8.
- **Not done:** the carrier's air group still adds only to presence (no strike in a raid); deterrence ignores task-force count beyond
  summed power; no presence display per task force in the order of battle.
- `npm run verify:presence`: power ordering and condition effects, the curve, station rules, threat and raider ordering across five force
  types, raider behaviour by strength, deterred-expiry handling, graded shipping cover (counted once, escort 0.97), preview text.
  `verify:shipping`'s absolute "never attacked" cover checks became rate checks.
- Also: `npm run dev` now serves on port 3009 (`next dev --port 3009`; README updated).

## Action preview strip: no more flicker (2026-10-02)

- **Causes:** the strip's height followed its text (every longer prediction resized the ticker and the map canvas), and moving between two
  actions cleared the preview for a frame (placeholder flash). It also re-rendered and deep-cloned the world every tick even when idle.
- **Fix:** the strip is a fixed two lines tall (`h-[2.75rem]`); a longer prediction grows *upward* as a pointer-transparent overlay over
  the ticker, so nothing else moves. `usePreviewStore.clear` waits 140 ms (cancelled by the next `show`). The strip subscribes to the
  clock only while an action is hovered, and the text is memoised on (preview fn, tick, log, budget). Measured in the browser: canvas,
  ticker and strip boxes are identical with a 391-character preview, and 40 samples while hopping between two buttons showed 0 placeholder flashes.

## Evaluation round 1: save/load and catch-up (done, 2026-10-07)

Source: a self-evaluation against an immersion / QoL / loop rubric (see the conversation); priorities taken in order: (1) save and load,
(2) battle reports, (3) refit and bulk fleet ops, (4) sound, (5) hull diversity. Each is its own section below.

- **Saves** (`lib/save.ts`, key `al.save.v1`, ~15 KB): the world minus its map (regenerated from seed and archetype; the briefing's two-sector map
  is rebuilt by `createTutorialMap`), the ledger and saved designs. Written by `useAutosave` in `Cockpit` (4 s after a change while the clock
  runs, 0.6 s when paused, on tab hide and `pagehide`); never during the briefing and never while the title screen is up. Old saves get
  missing fields filled (`normalizeShipping`); corrupt or other-version saves are ignored.
- **Continue** on the title screen (day, fiscal year, hulls, support, saved time) plus **Discard save**.
- **Catch-up** (opt-in): "Continue and catch up N days" simulates N days under standing orders (ROE, SOP, tempo; nothing new is ordered). N = one day
  per two minutes away, 3 minimum, 30 maximum (`catchUpDaysFor`). It ends in `DigestModal` ("While you were away"): summary numbers (budget, support,
  tension, kills, seizures, incidents, shipping, biggest threat rise), ships lost by name, up to ten dated ledger highlights, and **what is holding the
  navy back now** (`bottlenecksOf`: low budget, hulls awaiting funds or stalled by sanctions, docks waiting for spares, uncovered high threat,
  vendors under sanction, low support, many hulls in dock).
- `npm run verify:save`: a restored world equals the saved one and, after 120 further days, equals the game that never stopped (3 theatres); the briefing map
  restores; corrupt, wrong-version and broken saves are rejected; a full storage fails quietly; catch-up allowance; the digest names a lost ship and
  states budget, support and shipping; bottlenecks come from the world.

## Battle reports and the weight of a loss (evaluation phase 2)
- `lib/sim/narrative.ts`: `battleStory` turns an `EngagementResult` (now carrying `shooters`, `hits`, `warningKm`) into 3–9 ticker lines prefixed `  » `
  (detection, who led the defence, what leaked, ending, "the ledger records her name"). Sea state and time of day are colour only.
- Losses cost by hull (`LOSS_SUPPORT` FAC 3 … carrier 22; capital ships also `LOSS_PC`), carry crew/service text, and go on a capped
  roll of honour (`stats.fallen`, `ROLL_CAP` 30, shown in Order of battle). `Ship.engagements` counts actions.
- Sector panel shows Conditions (sea state). `npm run verify:narrative`.
- Still to come from the evaluation list: refit and bulk fleet operations, sound cues, hull diversity analysis.

## Refit and bulk fleet operations (evaluation phase 3)
- `lib/sim/fleetOps.ts`: `refitShip` swaps one module of a *docked, commissioned* ship (cost = 0.8× new − 0.25× old + 8 M yard fee, `REFIT_DAYS` 12,
  `Ship.refitDaysLeft` keeps it in dock; `advanceFleets` counts it down before repair/exit logic). Same checks as ordering a module
  (procurability, sanction blocks, valid loadout, budget). `refitMany` applies it to every selected ship carrying a module.
- Bulk: `moveShips`, `assignTaskForces`, `setTempoMany`, `splitTaskForce` (detach selected ships into a new task force with the parent's station,
  route and tempo), `mergeTaskForces` (same station within 3 tiles; empty shell disbanded). Previews: `previewRefit`, `previewRefitMany`,
  `previewSplit`, `previewMerge` (covered by `verify:preview`).
- UI: checkboxes on ships and task forces (`store/useSelectionStore.ts`, UI-only, not saved), a "Bulk orders" panel in the Fleet tab, and a
  per-module "Refit…" select in the ship detail when docked. `Btn` now clears its preview when it unmounts.
- `npm run verify:fleetops`. Not done: refit is not visible to the tutorial; no refit queue / yard capacity limit.

## Sound and diegetic cues (evaluation phase 4)
- `lib/audio/cues.ts` (`cueOf`, `cuesFor`): pure mapping from ledger events to LOSS / ALARM / BATTLE / ALERT / SONAR / TELETYPE; INFO and the
  indented lines of a battle report are silent; a batch yields at most two cues, most urgent first.
- `lib/audio/synth.ts`: WebAudio oscillators and filtered noise, no sample files; every call is a no-op without audio support.
- `store/useSoundStore.ts`: off by default, preference in `localStorage` (`al.sound`); `Cockpit.useSoundCues` plays cues for newly appended
  log entries (silent for loaded games, catch-up digests and batches over 40 lines). Toggle is "Sound" in the command bar.
- `npm run verify:audio`. Not done: volume slider, separate music bed, per-cue mute.

## Hull diversity (evaluation phase 5)
- `npm run verify:hulls` (`scripts/analyzeHulls.ts`) builds the best legal open-catalogue loadout per hull and compares cost, upkeep and presence.
  It found two problems, both in `lib/sim/presence.ts`, not in hull costs:
  1. Interceptor stacking: a three-SAM corvette (178 M) scored 2.3 frigate-equivalents, more than a frigate. Usable interceptors are now capped at
     `structuralHP / 13` (`INTERCEPTORS_PER_HP`); the starter designs are below the cap, so they are unchanged.
  2. Swarm spam: cost per frigate-equivalent was flat, so nine FACs bought what one destroyer did. `CLASS_WEIGHT` (FAC 0.7, corvette 0.85, frigate 1,
     destroyer 1.15, carrier 1.3) scales a ship's power: cost per frigate-equivalent now runs FAC 295 → corvette 243 → frigate 217 → destroyer 206 →
     carrier 181 M, upkeep per frigate-equivalent 1.3 → 0.9 → 1.0. Big hulls are better value but lumpy and their loss costs more (see the loss weights).
  Hull purchase costs were left alone. The same interceptor stacking exists in `combatSim` (real defence uses the raw count, limited by CMS channels);
  that was not changed. Submarines (S1–S5) remain unbuilt; they would need rows in this analysis.

## Submarines S1: data and designer (docs/PLAN-submarines.md)
- Hulls `SUB_SEORAK` (3,000 t, large battery, 130 d) and `SUB_KB` (1,800 t, quiet, 200 d); `HullBase` gained `platform`, `vendorId`, `origins`, `requiredTier`,
  `stealth`, `enduranceDays`. `HullClassId` now has the two boat ids; every `Record<HullClassId, …>` table has provisional entries (presence weight 0.5,
  loss weights from the plan) until S2.
- Modules have a `platform` (SURFACE / SUBSURFACE / ANY; CMS default ANY, everything else SURFACE). `evaluateLoadout` refuses mismatches, reports `stealth`,
  `submergedDays`, `sonarKm`, and never lets sonar count as radar detection or track capacity. New kit: six submarine plants (diesel, AIP, Li-ion), five sonars
  (two also fit surface ships: hull sonar, towed array), three torpedo / tube-missile modules. Warnings: no sonar, no diesel, surface ship with no radar.
- A hull is a vendor product: contract shares, `cannotDeliver`, construction freezes and resale checks use the hull's builder (and `origins`), and
  `hullBlocked` applies the builder's standing tier. **`SUBMARINE_SERVICE = false` in `designEngine.ts`: boats can be designed but not laid down** until S2
  (stance, depth, indiscretion) exists; flip it there. Designer shows builder, hull-sale status, stealth and submerged days, sonar range.
- Not done in S1: boats are not fielded, no stance, no enemy submarines, no Dahai family, no tutorial lesson. `verify:subs` covers S1 only and grows with S2–S5.

## Tutorial: manual Back / Next (no auto-advance)
- Lessons no longer advance on their own. When an objective is met (or already holds on entry) the card shows "Objective complete" and **Next** lights up;
  **Back** returns to the previous briefing. Revisited lessons are marked "Recap" and Next works without redoing the objective.
- `useTutorialStore`: `furthest`, `next()`, `back()`; in-memory `snapshots[i]` (state each lesson started in, with the selected sector) let Back / Next
  restore a lesson; going Back from the furthest lesson saves its live state (`progress`) so Next resumes it rather than restarting it. After a page reload only the
  current lesson is restorable (Back is disabled), because only the latest checkpoint is persisted.
- `scripts/e2e-tutorial.mjs` presses Next between lessons and tests the Back / Next recap. `verify:tutorial` (engine-level) is unchanged.

## What to build next

Per `docs/PLAN-command-and-economy.md`: steps 1–3 are done. Contractors phases 1–3 and the tutorial pass are done. Plan phase 4 (economy
rebalance) was superseded by the fiscal year in `PLAN-command-and-economy.md`; only offsets remain unbuilt. Phase 5 (cold vendors) is
done, so the contractors plan is complete. Submarines (`docs/PLAN-submarines.md`, S1–S5) are decided but not started; enemy submarines (S3) would now hunt the shipping that T1–T6
built. The shipping plan and its tutorial lessons are complete; licensed local production / offsets remain optional. The Movement faction (`PLAN-asymmetric-faction.md`) can reuse the interdiction layer.

## Design backlog (do not build yet)
- `docs/PLAN-foreign-contractors.md` — relationship ladder, regime profiles, new vendors, submarines, alias toggle.
- `docs/PLAN-asymmetric-faction.md` — the second playable faction and its coalition AI.

## Gotchas learned
- The cockpit is client-only (`dynamic(..., { ssr:false })`) because the generator's float results can differ across engines.
- On this Windows setup use `python -` or PowerShell for scripted edits; `pkill -f` from the Bash tool can kill its own shell.
- Two local sessions may run in this folder; check `git status` for unexpected changes before large edits.
