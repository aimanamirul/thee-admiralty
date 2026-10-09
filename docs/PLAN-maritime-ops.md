# Maritime Operations Centre (MOC) — plan

Status: **decided 2026-10-09 (proposed defaults adopted, see "Decisions"), not built.** Real-world anchors are general knowledge, used for flavour only: coastal
surveillance radar chains, AIS (ships broadcasting identity and position), vessel traffic services at straits, fixed seabed listening arrays
at chokepoints, national maritime operations / fusion centres.

## Why

Everything the player knows today comes from a ship being close to it:

- unidentified contacts resolve only inside `IDENTIFY_RANGE` (10 tiles) of a task force, or by a boat's passive sonar;
- enemy submarines are found only inside a sonar platform's reach (`reachOf`, typically 6–20 tiles);
- distress calls are answered only by a task force within `COVER_RADIUS`.

Maps are about 190 x 120 tiles and the player has two or three task forces. The result: most of the theatre is dark, and the measured
sonar coverage is sparse (two sonar frigates on lanes found three contacts in three worlds). A shore-based picture is how real navies close
that gap. It should **shift where the fog lies, not remove it**: the coast and the chokepoints become visible, the open ocean stays dark.

## Principles

1. **Passive.** The MOC is an investment, not a unit: no orders, no movement. Its output is information.
2. **Hints, not truth.** It never reveals a contact's hidden intent. It reports behaviour (no AIS, off the lane, loitering) with false alarms.
3. **Bounded.** Coverage is a set of fixed areas near the coast and chokepoints. Task forces still own the open sea.
4. **Paid for.** Build cost, upkeep, and (decision 3) the same vendor and sanction exposure as ships.

## 1. Stations and coverage

A station is a fixed installation with a position, a coverage radius and a kind. The MOC is the set of stations plus the fusion centre
(the home-port headquarters that ties them together).

| Station | Placed at | Radius (tiles) | Sees | Build / upkeep (M) |
|---|---|---|---|---|
| Coastal radar + AIS | home port, then any coastal tile of an owned sector | ~25 | surface tracks, AIS on/off | 40 / 0.15 per day |
| Chokepoint watch | a chokepoint tile (`map.chokepoints`) | ~18 | surface tracks; transits through the strait | 60 / 0.2 |
| Seabed array | a chokepoint tile | ~14 | submarine datums (sonar, below) | 90 / 0.25 |

- The fusion centre exists from the start (no cost) and covers nothing by itself; the starting home-port radar is the first station.
- Tiers (upgrade in place): coverage radius and detection quality rise, false alarms fall. Two tiers per kind is enough.
- Coverage is drawn as a plot layer toggle `coverage` (like `sonar`), and listed per sector in the sector panel ("Shore surveillance: radar,
  AIS; seabed array at THE NARROWS").

## 2. What it reports

All reports go to the ticker as ADVISORY (or WARNING for the urgent ones) with a `MOC:` prefix, and through the existing sound cues.

1. **Early tracks.** An UNKNOWN contact inside coverage becomes *tracked*: drawn on the plot as a faint track (position, heading) well
   before a task force could identify it. It stays `cls: 'UNKNOWN'`; the intent is still hidden. Tracking uses the contact engine's own random
   stream (`Rng(seed:moc:tick:id)`) so other rolls are untouched.
2. **Suspicion flags.** A tracked contact may be flagged from behaviour, never from its hidden intent directly:
   - *no AIS* (a raider, smuggler or shadower usually runs dark; some fishers and many lawful ships forget);
   - *off-lane* (well away from any shipping lane, heading across it);
   - *loitering* (slow, circling near a lane or chokepoint for several days).
   Each flag has a per-intent likelihood, so a flag raises the odds without proving anything. A flag sets the existing `suspicious` field's
   cousin `flagged` (new), shown as a chip in the contact panel ("MOC: NO AIS, LOITERING"), and SOPs may treat a flagged contact as
   suspicious (CHALLENGE warns it without waiting for a failed hail).
3. **Heads-up advisories.** At most one per day, most important first, e.g. "MOC: dark track loitering near the lane in S3 (two flags)".
   Raiders approaching a lane ship inside coverage give a warning a few days before they can strike.
4. **Distress relay.** A merchant ship attacked inside coverage is reported the same day with its position, and the distress window starts
   a day later (more time to answer).
5. **Submarine datums.** A seabed array raises `track` on submarine contacts within its radius like a weak sonar platform (it never
   reaches HELD by itself: capped at the datum band, so a ship or boat still has to finish the job). Fits straight into `sonarPlatforms`
   as a platform with `boat: false` and a fixed position.

### False alarms

Each tier has a false-alarm rate: a phantom "dark track" that resolves to nothing when a task force arrives, or a flag on a lawful
ship. Searching a falsely flagged merchant still costs standing (existing inspection rules), so trusting the MOC blindly has a price.
`verify:moc` checks the rates stay inside a band (useful, not oracular).

## 3. Costs and exposure

- **Money:** build cost and daily upkeep, shown in the Home Front running costs and in previews.
- **Vendor kit (decision 3: yes, built in M3):** each station kind has a supplier (radar and AIS from a western vendor, seabed arrays from a
  submarine builder, with the hidden sub-supplier mechanism available). A sanction degrades the station (radius and quality halve,
  then off after an embargo on parts), exactly as module failures without spares do. The domestic option is cheaper and worse.
- **Upkeep failures:** a station can break down and needs spares like a ship module (reuse the spares pool), so neglect shows.
- **Politics:** none at first. Later option: a coastal station in a disputed sector raises tension slightly.

## 4. What it does not do

- It does not identify or classify (no intent revealed), engage, board, or escort.
- It does not cover the open ocean: task forces and boats remain the only eyes there.
- It does not replace sonar ships: the seabed array only produces datums, and only at chokepoints.
- No new resource or micromanagement beyond building and upgrading stations.

## 5. Integration points (code)

| Area | Change |
|---|---|
| `lib/types/world.ts` | `stations: Station[]` on the world (and `pickWorld` / `worldPatch` / save), `Contact.tracked?`, `Contact.flags?` |
| `lib/sim/moc.ts` (new) | station data, coverage, tracking, flagging, advisories, false alarms, degradation; pure helpers + `tickMoc(w)` |
| `lib/sim/worldEngine.ts` | `tickMoc` after contacts, before shipping |
| `lib/sim/contactEngine.ts` | SOP treats `flags` like `suspicious`; tracked contacts shown before identification |
| `lib/sim/asw.ts` | seabed arrays as fixed sonar platforms, capped at the datum band |
| `lib/sim/shipping.ts` | distress relay: earlier report, one extra day to answer inside coverage |
| commands / previews / store | `buildStation`, `upgradeStation`, `removeStation` with previews (cost, coverage, exposure) |
| UI | "Shore surveillance" panel (stations, coverage, status) in the Sector tab overview; plot layer `coverage`; faint tracked contacts; flag chips |
| glossary / tutorial | glossary MOC, AIS, FLAGS; tutorial: one line in the graduation lesson, not a full lesson |

## 6. Build phases

1. **M1 core:** stations (home-port radar from the start, build coastal radar and chokepoint watch), coverage, early tracks, heads-up
   advisories, distress relay, `coverage` layer, previews, `verify:moc` (coverage geometry, no intent leak, determinism, cost).
2. **M2 judgement:** suspicion flags with per-intent likelihoods, false alarms, SOP use of flags, seabed arrays as capped sonar platforms.
3. **M3 exposure:** vendor kit, sanctions and breakdowns degrading stations, spares, domestic option, glossary and graduation line,
   balance soak (does the MOC change losses and incidents by a sensible amount?).

## Decisions (2026-10-09)

The proposed defaults were adopted as they stand.

| Question | Decision |
|---|---|
| 1. Where do alerts show up? | Ticker advisories **and** a `coverage` plot layer with faint tracks |
| 2. Fixed stations only, or also a staffing level trading cost for alert quality? | Fixed stations with two upgrade tiers; no staffing slider |
| 3. Is the kit vendor-supplied (sanctions, hidden sub-suppliers) or domestic and simple? | Vendor-supplied, with a cheaper, worse domestic option; built in M3 |
| 4. Can enemy raids target stations? | No (keeps it passive); revisit if the MOC proves too strong |
