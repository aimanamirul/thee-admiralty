# Submarines — plan

Status: **decided 2026-09-30, revised 2026-10-08 (see "Revision"). S1 (data, designer), S2 (service) and S3 (enemy submarines, ASW) built 2026-10-08; S4–S5 not built. See HANDOFF.md.** Follows `PLAN-foreign-contractors.md` §8.2 ("submarines: yes, a new hull
class"). Claims about real navies below are *general knowledge*, not source-checked; use them for flavour only.

## Decisions (2026-09-30)

| Question | Decision |
|---|---|
| Scope | **Player submarines + enemy submarines and ASW.** Not a separate undersea layer, thermoclines or mines (v1). |
| On station | **Passive deterrence + ambush.** Assigned like a task force; no mission orders. |
| Endurance | **Plant-driven indiscretion.** Diesel boats snorkel (exposure), AIP extends submerged time, Li-ion is premium. |
| Acquisition | **Foreign packages + licensed build.** Buy from submarine vendors with a crew-training package; STRATEGIC partners unlock licensed domestic production. No separate crew resource. |

Conventional submarines only (no nuclear boats).

## Revision (2026-10-08)

Revised after the evaluation phases shipped (battle reports, hull-aware loss weights, presence by hull class, refit and bulk orders, sound).
Decisions made with the player:

| Question | Decision |
|---|---|
| On-station decision | **Per-boat stance: STEALTH or PATROL** (see §2). One standing choice with a visible preview, like Rotate / Surge tempo. |
| Hull families at launch | **Two: Seorak and Kessler-Brandt.** Dahai (S26T replay) arrives with S4; Mitsurugi stays the cold-vendor unlock. |
| Enemy boats before the player has ASW | **No.** Gated behind year 1 and tension; one fiscal year earlier an advisory reports "unusual acoustic activity" so the player can buy sonar first. |
| Counter-detected friendly boat | Can be sunk only by enemy submarines, not by surface raiders. |
| Sonar | `SENSOR` socket with `domain: 'SONAR'`, not a new socket type. |

What the shipped systems change in this plan:

- **Presence** (`lib/sim/presence.ts`): a boat does not use `shipPower`. A separate `subPresence` counts at a fraction of a surface force's presence (suggested 0.5
  at full stealth value), scaled by the depth multiplier and zero while the boat is counter-detected. Boats get a row in `verify:hulls`
  so they cannot become the cheap-deterrence exploit that interceptor stacking was.
- **Shipping**: enemy submarines target lane ships through the existing pipeline (loss → lane risk → traffic → trade index → forecast and support).
  ASW cover is therefore an economic decision, not only a military one.
- **Battle reports and losses** (`lib/sim/narrative.ts`): add `SUBMARINE` to `LOSS_SUPPORT` (about 12, between frigate and destroyer), `LOSS_PC` (about 2),
  `CREW` (about 45). Torpedo attacks get their own story lines (no radar warning, a hit, the hunt) through `battleStory`.
- **Refit** (`lib/sim/fleetOps.ts`): sonar upgrades on surface ships are a docked refit. This gives the player a reason to buy ASW capability before the first
  enemy boat; refit must refuse surface-only modules on boats and sub-only modules on surface hulls via `platform`.
- **Sound**: contact by passive sonar maps to the SONAR cue in `lib/audio/cues.ts`.

## What exists to build on

- Bathymetry tiers (littoral / shelf / abyssal) per tile and `littoralFraction` per sector; the sector panel already labels abyssal
  sectors "SUB / CARRIER WATERS".
- `ARM_DOM_TORP` (role `ASW`) exists but combat ignores it: there is nothing under water to shoot.
- Contractors: Seorak, Kessler-Brandt and Dahai were picked partly as submarine builders; hidden sub-suppliers (`origins`), due
  diligence, contracts with deposits/cancel/resale, regimes and cold vendors all apply to submarines unchanged.
- The Thailand S26T case (German engine licence refused for a Chinese-built boat) can be replayed exactly: a Dahai submarine plant
  with a hidden Kessler-Brandt origin.

## 1. Hulls and the designer

- **Submarine hulls are vendor hulls.** New `HullBase.vendorId` (default the domestic yards) so the hull's cost goes to that vendor in
  build contracts and a sanction on the hull's builder stalls construction like any module. Hull families (fictional names TBD):
  - Seorak ~3,000 t: fast delivery, big battery, Li-ion ready later.
  - Kessler-Brandt ~1,800 t: quietest, AIP-ready; slow approvals (Rheinmark regime).
  - Dahai ~2,300 t: cheap; its diesel plant hides Kessler-Brandt engines (S26T). **Added in S4, not at launch.**
  - Mitsurugi ~3,000 t: premium, Li-ion; only after the Akitsu reform (cold vendor C1). **Later, with the cold vendor.**
  - **Launch set: Seorak and Kessler-Brandt only.** Two families give one clear tradeoff (fast and loud-ish vs slow and quiet) with two sets of tuning.
- **Sockets:** power (diesel generator + one AIP/battery slot), CMS, sensor (sonar only), armament (tubes: heavyweight torpedoes,
  tube-launched anti-ship missiles). Surface-only kit (radars, VLS, guns) is refused by the designer; sub-only kit is refused on
  surface hulls. New module field `platform: 'SURFACE' | 'SUBSURFACE' | 'ANY'`.
- **New module kinds:** sonar (sensor domain `SONAR`: hull sonar and towed array for surface ASW; flank/bow arrays for boats),
  heavyweight torpedoes, AIP modules, Li-ion battery. Protocol friction applies as usual.
- Designer shows **stealth** (from plant and hull) and **submerged endurance** instead of draft.

## 2. Player submarines on station (passive deterrence + ambush)

- Assigned to a sector like a task force (subs form their own task forces). Not drawn to the enemy: presence is by uncertainty.
- **Depth multiplier** on everything a boat does: abyssal 1.0, shelf 0.7, littoral 0.3 (by the sector's tile mix). Littoral water also
  raises counter-detection. This is the mirror of the grounding hazard for deep-draft surface hulls.
- **Deterrence:** sector threat drifts down while a boat is on station via `subPresence` (weaker than a visible surface patrol, but costs no coverage
  visibility and works in sectors surface ships cannot hold). It feeds the same sector threat, raider spawn and shipping cover figures as surface presence, with the stance factor above.
- **Ambush:** when a raid engages in a sector with a friendly boat on station, the boat attacks first with surprise (torpedo firepower
  × depth multiplier) before the surface engagement.
- **Early identification:** passive sonar identifies contacts in the sector at longer range, which reduces weapons-free incidents.

### Stance: STEALTH or PATROL (per boat, standing)

Each boat carries one standing choice, shown with a preview on the button like tempo:

| | Deterrence | Ambush | Indiscretion (counter-detection) | Endurance use |
|---|---|---|---|---|
| **STEALTH** | low (about 40% of PATROL) | full | near zero: the boat never snorkels while STEALTH holds | spends submerged endurance; must break off to recharge |
| **PATROL** | full | reduced (the boat is moving, less patient) | daily chance while snorkelling, higher in littoral water and at high tension | efficient: snorkels on schedule |

- STEALTH runs out of submerged endurance; the boat then shows a `RECHARGING` state for a few days (indiscretion rises) before it can return to STEALTH.
- AIP and Li-ion plants lengthen STEALTH and lower PATROL's indiscretion, so plant choice is a real purchase decision.
- The stance applies per boat, not per sector, and survives save/load. A new boat starts on PATROL.
- Previews: stance buttons state the deterrence value, ambush strength, and expected indiscretion risk per day, in the existing preview strip.
- Bulk orders (`fleetOps`): `setStanceMany` applies to selected boats.

## 3. Endurance and indiscretion

- Each boat has a **submerged endurance** from its plant: diesel-electric short, +AIP weeks, Li-ion between with faster sprints.
- **Indiscretion:** diesel boats must snorkel. Each snorkel day has a counter-detection chance (higher in littoral water and at high
  tension). Counter-detected: the boat loses its deterrence/ambush for some days and may be attacked if a hostile ASW contact is near.
- **Rotation:** submarines use the Rule of Thirds with their own limits: patrol length from endurance, long maintenance periods.

## 4. Enemy submarines and ASW

- New hostile contact intent `SUBMARINE`, spawned more often in abyssal/shelf sectors and at high tension. **Not drawn as a marker**
  until detected; the plot shows a **"possible submarine" datum**: a dashed circle that shrinks as sonar holds contact.
- While undetected it attacks shipping (lane ships from `PLAN-shipping.md`: losses → support and trade volume) or a patrolling hull (torpedo damage, possible loss).
- **Detection** by ships with sonar (surface hull sonar / towed array) and friendly boats; better sonar, bridged protocols and deeper
  water help. **Prosecution** with ASW weapons (`ARM_DOM_TORP` finally matters) or a friendly boat.
- **Ladder for submerged contacts:** SHADOW (hold sonar contact), WARN (active pinging / underwater signal: most intruders leave),
  ENGAGE. No hail or board. ROE caps it as usual; firing on a boat that has not attacked is an incident under RETURN FIRE.
- Sector SOPs apply (CHALLENGE warns off submerged contacts automatically).

## 5. Acquisition: foreign packages + licensed build

- A submarine is bought as a **package**: vendor hull + the vendor's plant/sonar/tubes, on a build contract (phase 3 rules).
- **First-of-class crew training:** the first boat of each hull family takes extra build days and cost (training package); later boats
  of the same family do not.
- **Licensed production** (the unbuilt "licensed local production" from the contractors plan): at STRATEGIC, a vendor grants a licence
  for its submarine family. Licensed hulls are built by the domestic yards (cheaper, slower first boat) and **immune to new export
  freezes on the hull**; the vendor's modules and spares stay exposed. The vendor keeps an `origins` link on the licensed hull.
- No domestic submarine design programme in v1.

## 6. Politics and events

- A lost submarine is a national tragedy: large support drop and a ledger event.
- Commissioning the navy's first submarine: prestige support boost.
- Enemy submarine attacks on shipping cost support until the sector is cleared.

## 7. Build phases

1. **S1 data + designer:** `HullBase.vendorId`, submarine hulls, `platform`, sonar / torpedo / AIP / Li-ion modules, designer rules,
   stealth and endurance figures, real-name skins. Hull vendor in contracts and procurability.
2. **S2 player boats:** sub task forces, depth multiplier, `subPresence`, **STEALTH / PATROL stance**, ambush, early identification, endurance/indiscretion, rotation, loss weights, torpedo story lines, `verify:hulls` rows.
3. **S3 enemy boats + ASW:** `SUBMARINE` contacts (gated behind year 1 and tension, with a one-year advisory warning), shipping attacks through the lane pipeline, datum rendering, detection, prosecution, submerged ladder and SOP, events.
4. **S4 acquisition:** vendor packages, first-of-class training, the third hull family and S26T replay (Dahai + Kessler-Brandt origin), licensed production.
5. **S5 polish:** `verify:subs` (depth, stance tradeoffs, indiscretion, detection and ambush rates, no invisible-sub soft locks: every undetected contact must expire or resolve), preview texts, plot
   layer toggle for sonar/datums, balance soak; optional tutorial or advisor lesson on ASW.

## Open questions (small; decide when building)

- Fictional names for the two launch hull families and their real-name skins (Dahai and Mitsurugi names can wait).
- Exact `subPresence` fraction and the STEALTH / PATROL deterrence ratio: set them with `verify:hulls` and a soak, not by hand.
- Whether the RECHARGING state should be visible on the plot or only in the order of battle.
