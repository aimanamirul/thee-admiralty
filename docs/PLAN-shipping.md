# Civilian shipping — plan

Status: **decided 2026-09-30; all phases T1-T6 built 2026-09-30 (see HANDOFF.md).** Real-world anchors below are *general knowledge*, not source-checked:
the 1987–88 Tanker War escorts (Earnest Will), the 1982 Falklands total exclusion zone, the 2023–24 Red Sea attacks and rerouting
around the Cape, war-risk insurance premiums, AIS "dark" shadow-fleet tankers.

## Decisions (2026-09-30)

| Question | Decision |
|---|---|
| Presence | **Visible identified ships on shipping lanes**, drawn on the plot. Existing unidentified contacts become the "dark" traffic. |
| Protection | **Sector coverage protects implicitly + optional escort orders** for a convoy or high-value ship. |
| Your threat | **Incidents + inspections**, and — controversial, polarizing — **deliberate trade interdiction** (see §5). |
| Stakes | **Trade volume feeds next year's appropriation and domestic support.** |

Deliberate interdiction is a strategy-game abstraction under the same guardrails as `PLAN-asymmetric-faction.md` §7: neutral
wording, no gore, the civilian toll always counted and reported, no ending that glorifies it.

## Today

Civilians exist only as anonymous `UNKNOWN` contacts (merchant 45%, fishing 20% of spawns) that drift 8–16 days and expire. Firing on
one is an incident; nothing depends on them. Chokepoints and water-only A* routing (`navigation.ts`) already exist.

## 1. Lanes and traffic

- **Lanes** generated per theatre: 2–4 routes between map-edge gates, routed over water through chokepoints (deterministic per seed).
  Each lane has a base traffic rate and cargo mix.
- **Ships** (cap ~20 on the plot for performance): tanker, container ship, bulk carrier, ferry (local). Each has a flag state (a vendor
  country or a neutral flag), a cargo value and AIS on, so it spawns **identified** (`NEUTRAL`) and follows its lane at speed.
- **Dark traffic:** the existing unidentified contacts; AIS-off ships near lanes are suspicious by default (smugglers, shadowers).
- Plot: small grey hull symbols on faint lane lines (a new map layer toggle "shipping").

## 2. Threats to shipping and protection

- Raiders (and later enemy submarines, `PLAN-submarines.md` §4) **prefer lane ships in uncovered sectors**. Outcomes: damaged,
  hijacked, sunk; each is logged with the ship's name and flag.
- **Implicit protection:** a covered sector engages raiders before they reach a lane ship (existing engagement model).
- **Escort order:** assign a task force to escort a named convoy or high-value ship (e.g. a laden tanker) along its lane; the task
  force's presence moves with it across sectors and it fights first if the escortee is attacked. Leaves its sector uncovered.
- **Distress calls:** a damaged ship requests help; answering in time is a rescue (support +), ignoring it costs support.

## 3. Trade volume, insurance and the budget

- Each lane carries a **risk** from recent attacks in its sectors; risk sets a **war-risk premium**, which lowers the lane's traffic.
  Sustained high risk **reroutes** the lane out of the theatre until risk falls (the Red Sea pattern).
- A theatre **trade volume index** (100 = normal) feeds `forecast()` as a new factor alongside support and tension, and drifts domestic
  support (protecting trade is visible success; losses are headlines).
- Preview strip and Home Front show the trade factor, so the budget consequence is never hidden.

## 4. Inspections (legal leverage)

- New ladder action for identified civilians: **INSPECT** (visit and search). Takes time; reveals contraband by chance (varies by flag
  and by intelligence). Finding it: seizure (money, support). Finding nothing: standing loss with the flag state and a minor incident.
- Sector SOP option: inspect ships of a chosen flag (e.g. to enforce a sanction), with the diplomatic cost shown up front.

## 5. Deliberate trade interdiction (controversial)

A navy can choose economic warfare against a state's shipping. It is always available, never free, and always foreshadowed.

- **Declare a maritime exclusion zone** over chosen sectors against a chosen flag (or all flags). **Notice period** (e.g. 14 days):
  shipping reroutes, insurers react, the flag state and its bloc respond (standing drops, sanction warnings). After notice, ships of
  that flag inside the zone may be turned back, seized or attacked under the sector's ROE.
- **Interdiction policy** per flag: *Inspect all* → *Turn back / seize* → *Unrestricted* (attack on sight).
- Attacking outside a declared zone, or before notice ends, is the worst case: treated as the gravest incident type.
- **Consequences**, scaling with policy severity and civilian toll:
  - flag state: licence revocation; its bloc: standing and sanction hazard up; restrictive regimes (`incidentPenalty`) react hardest;
  - tension spikes; lanes reroute: **trade volume falls for everyone, including your own appropriation** (self-harm is part of it);
  - **polarization** (new domestic meter): a hardline segment rallies at high tension while others turn away; support swings grow
    and elections become volatile. Support can go up short-term and collapse later.
- The Home Front shows a running **civilian toll** and an annual report of shipping impact (the asymmetric plan's end report, reused).
- The same system is the **core loop of the Movement faction** (`PLAN-asymmetric-faction.md` strike layer), so building it here
  prepares that faction.

## 6. Build phases

1. **T1 lanes and traffic — DONE:** lane generation, identified ship spawns and movement, plot layer, ship panel (name, flag, cargo).
2. **T2 threats and protection — DONE:** raider targeting of lane ships, outcomes, implicit protection, escort order, distress calls.
3. **T3 economy — DONE:** lane risk, insurance, rerouting, trade volume index into `forecast()` and support; previews and Home Front.
4. **T4 inspections — DONE:** INSPECT ladder step, contraband, flag-state reactions, SOP option.
5. **T5 interdiction — DONE:** exclusion zones with notice, interdiction policies, polarization meter, civilian toll and report.
6. **T6 verification and report — DONE:** `verify:shipping` (lane connectivity, traffic caps, protection vs loss rates, trade → budget, zone notice
   always precedes force, consequences scale with policy), preview coverage, names.

Deviations while building T1-T3: protection also comes from a task force **holding the ship's sector** (on station within 8 tiles of its
anchor), not only from one within 14 tiles, because a 14-tile disc covers a sliver of a 200-tile lane and coverage would not have
mattered; the trade index only ever lowers the forecast (factor 0.85-1.00), so the existing economy balance is unchanged at normal
trade; ferries share the lanes; up to three lanes, the first of which crosses a chokepoint when the theatre has one.

Deviations while building T4-T6: the inspect action is an *order to a task force* (it goes to the ship) plus a per-sector standing order
for one flag, rather than a new rung on the contact ladder; the three policies are named *search and release*, *search / seize / turn
back* and *unrestricted* (the second searches first and turns back only the innocent); a strike is lawful only in sectors at WEAPONS
FREE (elsewhere an unrestricted order falls back to turning back), so ROE stays the ceiling; passenger ferries are never targets; a
deliberate "Engage" order exists on any merchant ship and is the gravest incident unless a lawful order covers it (two-click confirm);
polarization is a number 0-100 on the politics state, and the yearly report is a ledger line plus a line in the shipping section.

**Recommended order with submarines:** T1–T3 before submarine phase S3, since enemy submarines' main target is shipping.

## Open questions (decide when building)

- Is there a named adversary state (the source of raiders) whose shipping is the natural interdiction target, or only vendor/neutral
  flags?
- Whether escorts can be standing orders ("escort all tankers through the strait") or only per ship/convoy.
- How far polarization reaches: elections only, or also ministries' willingness (lobbying/hearings).
