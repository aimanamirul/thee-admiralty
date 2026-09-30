# Submarines — plan

Status: **brainstormed and decided 2026-09-30, not built.** Follows `PLAN-foreign-contractors.md` §8.2 ("submarines: yes, a new hull
class"). Claims about real navies below are *general knowledge*, not source-checked; use them for flavour only.

## Decisions (2026-09-30)

| Question | Decision |
|---|---|
| Scope | **Player submarines + enemy submarines and ASW.** Not a separate undersea layer, thermoclines or mines (v1). |
| On station | **Passive deterrence + ambush.** Assigned like a task force; no mission orders. |
| Endurance | **Plant-driven indiscretion.** Diesel boats snorkel (exposure), AIP extends submerged time, Li-ion is premium. |
| Acquisition | **Foreign packages + licensed build.** Buy from submarine vendors with a crew-training package; STRATEGIC partners unlock licensed domestic production. No separate crew resource. |

Conventional submarines only (no nuclear boats).

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
  - Dahai ~2,300 t: cheap; its diesel plant hides Kessler-Brandt engines (S26T).
  - Mitsurugi ~3,000 t: premium, Li-ion; only after the Akitsu reform (cold vendor C1).
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
- **Deterrence:** sector threat drifts down while a boat is on station (weaker than a visible surface patrol, but costs no coverage
  visibility and works in sectors surface ships cannot hold).
- **Ambush:** when a raid engages in a sector with a friendly boat on station, the boat attacks first with surprise (torpedo firepower
  × depth multiplier) before the surface engagement.
- **Early identification:** passive sonar identifies contacts in the sector at longer range, which reduces weapons-free incidents.

## 3. Endurance and indiscretion

- Each boat has a **submerged endurance** from its plant: diesel-electric short, +AIP weeks, Li-ion between with faster sprints.
- **Indiscretion:** diesel boats must snorkel. Each snorkel day has a counter-detection chance (higher in littoral water and at high
  tension). Counter-detected: the boat loses its deterrence/ambush for some days and may be attacked if a hostile ASW contact is near.
- **Rotation:** submarines use the Rule of Thirds with their own limits: patrol length from endurance, long maintenance periods.

## 4. Enemy submarines and ASW

- New hostile contact intent `SUBMARINE`, spawned more often in abyssal/shelf sectors and at high tension. **Not drawn as a marker**
  until detected; the plot shows a **"possible submarine" datum**: a dashed circle that shrinks as sonar holds contact.
- While undetected it attacks shipping (merchant losses → support) or a patrolling hull (torpedo damage, possible loss).
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
2. **S2 player boats:** sub task forces, depth multiplier, deterrence, ambush, early identification, endurance/indiscretion, rotation.
3. **S3 enemy boats + ASW:** `SUBMARINE` contacts, datum rendering, detection, prosecution, submerged ladder and SOP, events.
4. **S4 acquisition:** vendor packages, first-of-class training, S26T replay (Dahai + Kessler-Brandt origin), licensed production.
5. **S5 polish:** `verify:subs` (depth, indiscretion, detection and ambush rates, no invisible-sub soft locks), preview texts, plot
   layer toggle for sonar/datums, balance soak; optional tutorial or advisor lesson on ASW.

## Open questions (small; decide when building)

- Can enemy submarines appear before the player can field ASW (an early-game reason to buy sonar), or only after the first year?
- Fictional names for the four hull families and their real-name skins.
- Whether a counter-detected friendly boat can be sunk by enemy surface raiders or only by enemy submarines.
