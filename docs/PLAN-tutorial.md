# Tutorial stage — plan

Status: **implemented** (see `docs/HANDOFF.md` for how it is built; the shipped script has 15 lessons — table in HANDOFF.md; the table below is the original 9-lesson plan). Launched from the title screen.

## 1. Diagnosis: why it feels like too much

On first load the player sees, simultaneously: a map with 4 layer toggles, 6+ sectors, 2 task forces, a 9-item top bar
(budget, industry, research, political capital, tension, date, clock, seed/archetype/generate), 4 tabs, a Rule-of-Thirds gauge,
a fleet tree with 7 ships, a spares yard, and a ticker. That is roughly **nine systems, none explained, with jargon** (ROE,
littoral, friction index, hulk, tempo). There is no obvious first action and no reason yet to care about any number.

Principles for the fix:
1. **Progressive disclosure.** Hide what the player cannot yet use; reveal one system per lesson.
2. **One action at a time**, each with a visible payoff.
3. **Learn by doing in a scripted world**, not by reading. The sim is deterministic per seed, so the tutorial can be too.
4. **Never block experts.** Skippable, replayable, and off by default for a returning player.

## 2. Structure: "Admiral's Briefing" (~12–15 minutes, 9 lessons)

The tutorial is a **fixed scenario** (its own seed and hand-tuned start, small fleet, generous budget) with the sim paused
between lessons. A briefing card (docked bottom-left of the map, not modal) gives 1–3 lines, one **objective**, and the target
element is highlighted with a phosphor pulse. The next lesson starts when the objective's gate is satisfied.

| # | Lesson | UI revealed | Objective (gate) | Payoff |
|---|---|---|---|---|
| 0 | **Reading the plot** | Map only (no top-bar readouts except date) | Click any sector | Sector panel slides in; legend for cyan coast / amber unknown / red hostile |
| 1 | **Sectors & threat** | Sector tab | Set ROE on the marked sector | Threat meter explained; ROE tooltip shows the trade-off |
| 2 | **Put ships on station** | Order of Battle tab, sim clock | Assign TF 11 to the marked sector, press ▶ | Chevron sails along its route; ticker starts |
| 3 | **Rule of Thirds** | Thirds gauge, ship rows | Watch one hull rotate to dock (sim runs at 16x, auto-pauses on the event) | "Ships wear out; ⅓ patrol / ⅓ transit / ⅓ overhaul" and Hold Station's cost |
| 4 | **Contacts & engagement** | Ticker filters | Scripted unknown contact appears → identify → engage | See the raid math: window, reaction, interceptors; ROE consequence (weapons-free incident is offered as a *what-if*, not forced) |
| 5 | **Breakdowns & spares** | Spares yard | Scripted module failure; buy a spare or designate a hulk | Cannibalisation explained with a real consequence |
| 6 | **Design bureau** | Designer button | Lay down a corvette that passes the power grid check (an overloaded preset teaches the grid first) | Power/payload bars, draft class |
| 7 | **Integration friction & R&D** | R&D tab | The corvette's foreign missile has friction → start the matching bridge | Friction matrix and permanent fleet-wide fix |
| 8 | **Diplomacy & sanctions** | Diplomacy tab, PC readout | Scripted vendor WARNING → lobby to avert it | Sanction lifecycle, why domestic substitutes exist |
| 9 | **Graduation** | Everything | — | Reveal all UI, show a one-page Codex, offer "New theatre" |

Lessons 6–8 tie together as one story (design → mismatch → bridge → sanction), which is the game's core loop. It also mirrors a
real case worth quoting in-game: Turkey developed a domestic launcher and CMS interface after US restrictions on Mk 41 (see the
contractor doc).

## 3. Mechanism

**Tutorial state machine** in a new `store/useTutorialStore.ts`:

```ts
interface Lesson {
  id: string;
  title: string;
  body: string[];                       // 1–3 short lines
  anchor?: string;                      // data-tutorial="…" id to spotlight
  reveals: UiFlag[];                    // e.g. 'TAB_SECTOR', 'CLOCK', 'SPARES'
  gate: (s: GameState) => boolean;      // objective completion, evaluated on store change
  onEnter?: (w: WorldDraft) => void;    // scripted, deterministic world edits (spawn contact, fail a module…)
  pauseOnEnter?: boolean;
}
```

- **UI gating** via a `uiFlags: Set<UiFlag>`; each panel/tab/readout renders only if its flag is on (default: all on when the
  tutorial is off). This is the only real change to existing components.
- **Spotlight overlay**: one component that reads `data-tutorial` anchors, dims everything else, and pulses the target. It must
  respect the UI-scale setting and `prefers-reduced-motion`.
- **Scripted events** use the existing `WorldDraft` and commands, so they are unit-testable headlessly like `verifySim.ts`.
- **Persistence**: `localStorage` for completed lessons and "don't show again"; **Settings → Replay tutorial**.
- **Skip**: always visible; skipping reveals everything and marks the tutorial done.

## 4. Support features that reduce overwhelm even without the tutorial

1. **Glossary tooltips** on jargon (ROE, littoral, friction index, hulk, tempo) — one shared `<Term>` component.
2. **Codex tab** (post-tutorial): one paragraph + diagram per system, searchable.
3. **Advisor nudges**: a non-modal chip when a situation first occurs ("First breakdown — see spares"). Each fires once.
4. **Cleaner default layout**: collapse the spares yard and "Organise" sections by default; group top-bar readouts.
5. **Early-game pacing**: slower first 60 days (fewer hostile probes) so the player isn't punished while learning.

## 5. Build order

1. `uiFlags` gating + `<Term>` tooltips (useful immediately, low risk). ~0.5 day.
2. Lesson runner + spotlight + briefing card, lessons 0–3. ~1.5 days.
3. Scripted scenario + lessons 4–5 (needs deterministic contact/failure injection). ~1 day.
4. Lessons 6–9 + Codex. ~1.5 days.
5. Playwright walkthrough test that completes every gate, so regressions in the flow are caught. ~0.5 day.

## 6. Decisions (2026-09-29)

- **Fixed scenario on a fixed 2-sector map**, covering the whole game A to Z.
- Consequence for the lesson table: with two sectors, use **Sector A = home approaches** and **Sector B = beyond the strait**
  (a CHOKEPOINT-style map with a single named strait linking them). Lessons 1–2 use A; the graduation lesson opens B, which
  teaches that coverage is a resource problem. The scripted contact, breakdown and sanction events are authored for this map only.
- Add a **hard-coded seed and archetype** for the scenario and a headless test that plays it through, like `verifySim.ts`.
- Launch: **title-screen selection** (Begin briefing / Free play). Voice: terse military briefing. Codex: deferred.
