# Second playable faction: the "Movement" (asymmetric maritime insurgency)

Status: **plan only.** Inspired by the Red Sea crisis (a clerical-led armed movement governing highlands and a western coast,
using patron-supplied missiles and drones against shipping and coalition navies). It is a **strategy-game abstraction**, not a
reconstruction: fictional names by default, abstract mechanics, no real target lists, real coordinates, or technical
specifications. Modelling the costs honestly (civilians, legitimacy, famine) is part of the design, not an afterthought.

## 1. Why it fits

The engine already has sectors, chokepoints, contacts, ROE, vendors with sanction risk, and a friction/reaction model. This
faction **inverts the viewpoint**: today the player is the navy and hostile contacts are threats. Here the player is the
contact, and a coalition AI plays the navy. Most of the systems get reused as mirror images.

| Existing system | Admiralty (today) | Movement (new) |
|---|---|---|
| Vendors + export sanctions | Buy hulls from states | **Patrons**: supply pipelines with conditions, deniability and interdiction risk |
| Rule of Thirds | Rotate ships | **Launch-cell dispersal cycle**: Concealed / Preparing / Firing / Recovering |
| Sector threat / ROE | Threat you defend against | **Coalition attention** per sector (how hard you are being hunted) |
| Contacts (unknown / neutral / hostile) | You identify them | **Shipping traffic** you must classify; misidentification harms legitimacy |
| Budget / RP / Political Capital | Treasury, research, politics | **Revenue, Munitions, Legitimacy** (see §3) |
| Spares / hulks | Cannibalise ships | **Salvage and dispersal**: strike losses, reconstitution |
| Tutorial | Admiralty briefing | Separate short briefing; do not ship before the Admiralty tutorial |

## 2. What "playing" is (the loop)

1. **Govern** (the slow layer): hold zones, pay salaries, keep services and ports running.
2. **Supply**: run patron pipelines; decide what to accept and at what political price.
3. **Strike or restrain**: choose a targeting policy and tempo against shipping and coalition forces.
4. **Survive the response**: coalition escalates; you choose dispersal, deterrence or de-escalation.
5. **End**: negotiated settlement, stalemate, or collapse. There is no "conquer the map" ending.

### Governance layer (new, the biggest addition)
- Land gets **zones** (Voronoi over land tiles): *Highlands*, *Western Littoral*, contested edges. Requires tagging land, which the generator does not do today.
- Per zone: **control, loyalty, services, food security**, revenue (port dues, taxes), salary bill.
- The western coast port is a **lifeline**: most food imports arrive there. That dependency is the core dilemma, as UN inspection data shows the country imports about 90% of its food and that the UN Verification and Inspection Mechanism has cleared over 2,300 vessels (both sourced below).
- **Council decision cards** (clerical council, tribal leaders, military wing) with trade-offs between ideology and pragmatism. Written in neutral, non-loaded language.

### Strike layer
- Assets are **launch cells and unmanned vessels/aircraft**, not hulls: cheap, numerous, concealable. Stats: signature, readiness, reload time, patron-dependence.
- **Targeting policy** (declared, changeable): *Hostile-affiliated only* / *Broad shipping* / *Coalition warships only*. Broader policy raises leverage on shipping and coalition pressure, and drops legitimacy and patron-neutral trade.
- **Shipping model**: lanes through the chokepoint carry traffic; attacks reduce transit share. Effects are outputs the player watches: transit index, rerouting share, war-risk premium. Reported public figures give plausible tuning ranges: Suez transits down about 50–60%, Cape rerouting adding 10–14 days and about a 25–30% cost premium, war-risk premiums about $150k–300k per voyage (all sourced below).
- **Misidentification** reuses the existing neutral-contact code path: strikes on neutral or humanitarian traffic cost Legitimacy and can trigger sanctions on you.

### Coalition AI (the new opponent, largest engineering piece)
- Actors: **Western naval task groups** (escort/interdict), **Gulf coalition air/missile force**, **host-government forces** (a front-pressure meter, not a full ground war).
- **Escalation ladder** driven by *your* effects: escort missions → interceptions → strikes on launch areas → port inspection/blockade → strikes on port infrastructure.
- Coalition is constrained too: **magazine depth and cost exchange**. Public analysis cites ~$2M interceptors used against drones costing a few thousand dollars, with cost ratios from 2:1 up to 100:1. The UI shows a live **cost-exchange ledger** (abstract "cost units") for both sides. This is the educational centrepiece.

### Supply layer (patrons)
- Reuses `Vendor`, but as **Patrons** with `deniability`, `conditions`, `interdiction risk` and their own agenda.
- Pipelines are **abstract routes** (Route 1/2/3 with capacity and detection) and are **not real routes**. Coalition interdiction reduces throughput; UN-inspection and embargo dynamics appear as events. No smuggling method detail.

## 3. Resources and meters

- **Revenue** (dues, taxes, aid) → salaries, services, maintenance.
- **Munitions** (patron-supplied, capped by pipeline).
- **Legitimacy** (domestic + international): drives recruitment, patron willingness, negotiation leverage.
- **Humanitarian index** (food, health, displacement): a *visible* consequence of both the coalition's blockade and your own policy. If it collapses, so does Loyalty.
- **Coalition attention / escalation level**, **Patron standing** (per patron).

## 4. Map requirements

- Archetype: use **CHOKEPOINT/CORRIDOR** with a strait in the south, plus a new `landZones` layer.
- Highland relief for land (elevation is currently a display shade only). Needed for zone flavour and concealment bonuses.
- Fixed scenario map first (like the tutorial), then seeded variants.

## 5. Endings (all reachable, none glorified)

- **Negotiated settlement**: legitimacy and leverage above thresholds, humanitarian index above a floor.
- **Frozen conflict**: survive N days, coalition attention stable.
- **Collapse**: loyalty or humanitarian index hits zero, or patrons walk.
- An **end-of-run report**: shipping impact, cost-exchange totals, civilian toll, what a different policy would have changed. This is what makes it educational rather than a power fantasy.

## 6. Prerequisites and build order

Depends on: UI scale (done), tutorial framework (`uiFlags`), contractor rework (relationship ladder becomes patron logic), and
`landZones`. Estimated **2–3 weeks**:

1. `PlayerFaction` switch and a second scenario config; hide Admiralty-only UI via `uiFlags`. ~2 days
2. Land zones + governance layer + council cards. ~4 days
3. Shipping traffic model + targeting policy + strike cells. ~3 days
4. Coalition AI + escalation ladder + cost-exchange ledger. ~4 days
5. Patron pipelines (reusing diplomacy engine) + end-of-run report. ~3 days
6. Balance, a headless soak test for both factions, faction briefing. ~2 days

## 7. Guardrails (build these in from the start)

- Fictional state, faction and patron names; a real-name skin is **not** offered for this faction.
- Abstract routes, units, and costs; no real vessel names/positions, no real weapons specs, no how-to content.
- Civilian harm and humanitarian effects are **always shown**, not hidden behind a menu.
- Neutral wording for decisions and events; the game presents trade-offs, not a verdict.

## 8. Open questions

1. Should the Coalition also be *playable* later (mirror mode)? It would reuse the current Admiralty game against this AI.
2. Fictional setting: new invented geography, or a stylised nod to the real one? I recommend invented geography.
3. How much should the humanitarian index constrain the player (soft warning, or hard game-over)?

## Sources

- [Red Sea crisis rerouting costs — GEP](https://www.gep.com/blog/mind/red-sea-crisis-how-rerouting-is-impacting-shipping-costs), [Atlas Institute overview](https://atlasinstitute.org/the-red-sea-shipping-crisis-2024-2025-houthi-attacks-and-global-trade-disruption/), [Warconomy](https://warconomy.com/chokepoints/red-sea-shipping/economic-impact), [CXTMS 2026](https://cxtms.com/blog/red-sea-disruptions-shipping-routes-rates-impact-2026)
- [Cost and Value in Air and Missile Defense Intercepts — CSIS](https://www.csis.org/analysis/cost-and-value-air-and-missile-defense-intercepts), [Navies Can't Afford Expensive Solutions to Cheap Problems — ASPI](https://www.aspistrategist.org.au/navies-cant-afford-expensive-solutions-to-cheap-problems/), [CIMSEC on directed energy](https://cimsec.org/the-coming-of-age-of-directed-energy-weapons-and-the-red-sea-crisis/), [Responsible Statecraft](https://responsiblestatecraft.org/operation-prosperity-guardian/)
- [UNVIM](https://vimye.org/), [UNOPS on Yemen supplies](https://www.unops.org/news-and-stories/news/bringing-life-saving-supplies-into-yemen), [UNDP port damage assessment](https://www.undp.org/yemen/publications/damage-and-capacity-assessment-ports-hodiedah-salif-and-ras-issa), [FDD on UN limits](https://www.fdd.org/analysis/2025/10/01/8-un-failures-in-yemen/)
