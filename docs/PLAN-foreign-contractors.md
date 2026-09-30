# Foreign contractors — research & expansion plan

Status: **phases 0–3 implemented** (see §10 and `docs/HANDOFF.md`). Research done 2026-09-29. Claims marked *(verified)* come from the linked
sources at the bottom; claims marked *(general knowledge)* are from memory and should be checked before we lean on them
for flavour text.

## 1. What the research says is worth modelling

Real procurement is shaped less by "who makes the best radar" than by **who is allowed to sell to you, and who else's
permission is hidden inside the product**. These precedents each map to a mechanic we can build.

| Real precedent | What happened | Mechanic it suggests |
|---|---|---|
| **Mistral / Russia** (2011–2015) | France contracted two Mistral amphibious ships (~€1.2B), suspended delivery Nov 2014, cancelled Aug 2015 under US and Central European pressure. Refunded ~€950M, net loss ~€409M, then resold to Egypt. *(verified)* | **Contract cancellation → refund → resale.** A frozen hull can be cancelled for a refund minus penalty, or resold to a third-party customer at a discount. |
| **Thailand S26T submarine** | Germany refused an export licence for the MTU engines in a Chinese-built sub; CSSC pushed a domestic Chinese engine instead or risk cancellation. *(verified)* | **Sub-supplier chokepoints.** A vendor's product contains parts from another country's regime. Sanctioning the sub-supplier freezes a product whose *seller* is friendly. |
| **Turkey / CAATSA** (2020) | US sanctions restricted Mk 41 procurement; Roketsan accelerated a domestic launcher that interfaces with the Havelsan ADVENT CMS. *(verified)* | This is our **domestic substitution + protocol bridge** loop, already in the game. Strong justification, and a ready-made tutorial story. |
| **Japan → Australia, Mogami** (2025–26) | Australia selected an upgraded Mogami design (MHI); described as Japan's first approved transfer of lethal equipment after loosening its transfer principles. *(verified)* | **Policy-shift events.** A vendor that is *closed* to us can open when their government's policy changes (or because we hit a relationship threshold). |
| **Korea "One Team"** | DAPA, Hanwha Ocean and HD HHI formed a joint export team: HHI surface ships, Hanwha submarines. *(verified)* | **Consortium vendors** with a division of labour and one negotiating counterpart. |
| **BrahMos** | India–Russia JV (DRDO + NPO Mashinostroyeniya). Export customers: Philippines (first, 2022), Vietnam, Indonesia. *(verified)* | **JV vendors with two-country exposure.** Sanctioned if *either* parent state is. |
| **Naval Group / Thales / Fincantieri / OSN** | Thales holds ~30% of Naval Group; Fincantieri is a platform builder with no systems work; Orizzonte Sistemi Navali is 51% Fincantieri / 49% Leonardo. *(verified)* | **Cross-holdings → contagion.** Trouble at one vendor bleeds into its shareholders/affiliates. |
| **Saab 9LV** | Marketed as integrating third-party surface-to-surface missiles from several suppliers. *(verified)* | A **"bridge-friendly" CMS** archetype: lower friction with foreign weapons at a price. |
| **Rosoboronexport** | Handles ~85% of Russian arms exports; India, China, Algeria, Vietnam are leading customers. *(verified)* | **State-monopoly vendor:** one counterparty, no competitors within the bloc, politics decides everything. |
| **German export control** | Federal Security Council (Bundessicherheitsrat) historically approved arms exports; cabinet decided in Aug 2025 to dissolve it from 1 Jan 2026 in favour of a new National Security Council. Maritime systems are comparatively easy for German governments to justify. *(verified)* | **Regime profiles** per country (see §3). Germany: slow, committee-driven, but maritime-friendly. |
| **Chinese exports** | Pakistan is the only export customer of the Type 054A/P (four ships) and is receiving eight Hangor-class subs (S26T). *(verified)* | Sino bloc: **price-and-volume friendly, few customers, hardware you cannot get elsewhere**. |

## 2. Relationship ladder (new mechanic)

Today a vendor is just `standing 0–100` with tiers. Replace the front door with a ladder so *unsigned* vendors exist:

`UNKNOWN → CONTACT → TRADE MISSION → FRAMEWORK AGREEMENT → SIGNED → STRATEGIC PARTNER`

- **UNKNOWN**: not shown in the ledger until a contact event, an R&D lead or a neighbour recommends them ("intelligence").
- **CONTACT / TRADE MISSION**: costs Political Capital and days. Reveals the catalogue *read-only* (you can see what you'd get).
- **FRAMEWORK AGREEMENT**: catalogue purchasable at T0 only; standing now matters.
- **SIGNED / STRATEGIC PARTNER**: full tiers, licensed local production, offsets.
- Each rung has a **bloc-affinity cost**: courting an adversary bloc lowers standing with the other (see §4).

Start-of-game state per candidate is in §5. This gives the player something to *pursue* instead of a fixed list.

## 3. Export-regime profiles (drives the sanction state machine)

Instead of one shared volatility number, each vendor's **home regime** sets how sanctions behave:

| Regime | Behaviour | Anchor |
|---|---|---|
| US (ITAR/State Dept, CAATSA) | Long lead time, deep catalogue, **secondary-sanction trigger** if you buy from listed adversaries. Hard revocation possible. | ITAR controls surface vessels of war and special naval equipment *(verified)*; CAATSA lets the US restrict defence exports to sanctioned parties *(verified)* |
| France | Politically steered; cancellations happen at head-of-state level. Refunds owed. | Mistral |
| Germany | Slow approval; **component licences** (engines) are a hidden chokepoint. | MTU/S26T |
| UK | Reliable ally-tier; design licensing (Arrowhead/Type 31 on a Danish hull) *(verified)* makes licensed-build cheap. | Babcock |
| Nordics (SE/NO/DK) | Restrictive on conflict parties, otherwise stable; excellent sensors/missiles. | *(general knowledge)* |
| Russia (state monopoly) | One counterparty, cheap, **you inherit US secondary-sanction risk**. | Rosoboronexport |
| China | Cheap, high volume, gated by bloc alignment; few references. | 054A/P, Hangor |
| Turkey | Transactional, eager for new customers, exposed to US restrictions. | CAATSA/Mk 41 |
| Korea | Consortium sales, fast delivery, competitive price; regime is business-friendly. | One Team |
| Japan | **Closed until a policy shift**, then premium and reliable. | Mogami |
| Israel | Very capable, politically sensitive customers list. | *(general knowledge)* |
| India | JV-heavy, pushes local content, exporter of missiles. | BrahMos |

## 4. New systems the roster enables

1. **Sub-supplier graph.** `Module.origins: VendorId[]` (e.g. a Chinese hull with a German engine). A sanction on *any* origin freezes it.
2. **Cross-holding contagion.** `Vendor.affiliates` with a share; standing/sanction shocks propagate at that fraction.
3. **JV / consortium vendors.** A vendor with two `parentStates`; either can trigger a sanction.
4. **Bloc affinity.** Blocs: WEST, EURO, NORDIC, EAST, SINO, ASIA-PAC, NON-ALIGNED. Buying deeply from EAST/SINO raises US-regime hazard on WEST vendors (CAATSA-style secondary risk), and vice versa.
5. **Contract cancel/resale.** For a frozen hull: refund minus penalty, or resell at a discount (Mistral).
6. **Policy-shift events.** Random and player-triggered (relationship threshold) events flip a `CLOSED` vendor to `OPEN` (Japan).
7. **Licensed local production.** At STRATEGIC PARTNER, unlock a build licence: cheaper units, slower start, and *immune to new export freezes* for that design (spares still exposed).
8. **Bridge-friendly CMS archetype** (Saab-like) and **closed ecosystem archetype** (US-like): different friction curves.

## 5. Candidate roster

Protocol tags use our four (`TACTICOS_ETHERNET`, `NATO_LINK16`, `EASTERN_ANALOG`, `DOMESTIC_OPEN`). I suggest adding two later
(`NORDIC_OPEN` for 9LV-style open architecture, `SINO_DIGITAL` for modern Chinese digital buses) — see §7.

**Signed at start (already in the game):** Domestic Yards; Naval Group/Thales (FR); Raytheon (US); Aselsan (TR); Zvezda-Nord Export (fictional eastern bloc).

### Trade connections exist, not yet signed (start at CONTACT)

| Candidate | Country | Niche | Likely catalogue | Protocol | Hook |
|---|---|---|---|---|---|
| Saab | SE | CMS + sensors | 9LV-class CMS, AESA radars, Bofors guns | NORDIC_OPEN (or TACTICOS bridge) | Best integrator of foreign weapons; small-volume, expensive *(9LV integrates third-party SSMs — verified)* |
| Kongsberg | NO | Anti-ship missiles | NSM-class SSM, coastal batteries | NATO_LINK16 | Widely selected across NATO navies *(verified)*; restrictive on conflict parties |
| Hanwha Ocean / HD HHI ("K-Yards") | KR | Hulls, subs | Frigate/destroyer hulls, AIP subs | DOMESTIC_OPEN | Consortium sale, fast delivery *(verified)*; can unlock **submarine** hulls |
| Navantia | ES | Hulls + Aegis-class integration | F-100-style hulls | NATO_LINK16 | Friendly, mid-price *(general knowledge)* |
| Damen | NL | Modular hulls, patrol craft | OPVs, small combatants | DOMESTIC_OPEN | Cheap, fast, light armament *(general knowledge)* |
| BAE Systems / Babcock | UK | Guns, CMS, licensed designs | Type 31/Arrowhead-class licence | NATO_LINK16 | Licensed local build option *(Arrowhead verified)* |
| MBDA | multi (FR/UK/IT) | Missiles | Sea Ceptor-class SAM, Exocet-class SSM | NATO_LINK16 / TACTICOS | Multi-nation: any parent state can trigger a freeze |
| Leonardo / Fincantieri (OSN) | IT | Hulls + integration | Frigates, 76mm guns, radars | TACTICOS_ETHERNET | Cross-holding case *(OSN 51/49 — verified)* |
| Roketsan / STM | TR | Missiles / design | Domestic-VLS, ATMACA-class SSM | DOMESTIC_OPEN | Extends the Turkish bloc; CAATSA storyline *(verified)* |
| Rafael / IAI | IL | Air defence | Barak-class SAM | NATO_LINK16 | Barak 8 sold to India, seven ships *(verified)*; sensitive customers list |
| TKMS / Hensoldt / MTU-class | DE | Subs, engines, radars | Diesel/engine sets, sensors | TACTICOS_ETHERNET | **Sub-supplier** for others' products; slow licences |

### Cold (no relationship; reachable via events/PC)

| Candidate | Country | Niche | Hook |
|---|---|---|---|
| CSSC / NORINCO | CN | Hulls, subs, missiles at volume | Gated by bloc; Pakistan-style customer story *(verified)* |
| Rosoboronexport | RU | Everything, cheap | State monopoly, ~85% of exports *(verified)*; triggers secondary risk from US vendors |
| BrahMos Aerospace / BEL / Mazagon | IN | Supersonic anti-ship missiles, hulls | JV with Russia *(verified)*; exports to Philippines, Vietnam, Indonesia *(verified)* |
| Mitsubishi Heavy Industries | JP | Frigate hulls (Mogami-class) | **Starts CLOSED**, opens on a policy-shift event *(verified)* |
| Lockheed / General Dynamics / HII (US primes) | US | Aegis-class combat systems, big hulls | Deepest catalogue, strictest regime; only via STRATEGIC PARTNER with Raytheon-tier standing *(general knowledge)* |

### Fictional-alias recommendation
Using real firms in invented sanctions/scandal storylines can look like statements about real companies. We already use real names
(Raytheon, Thales, Aselsan). Two safe options: (a) keep real names for *catalogue flavour* but write sanction events in generic
terms ("the vendor state"); (b) ship a `fictionalNames` toggle that swaps in aliases (e.g. "Nordvik Defence" for Saab). **Decision needed.**

## 6. Data model changes

```ts
type Bloc = 'WEST' | 'EURO' | 'NORDIC' | 'EAST' | 'SINO' | 'ASIA_PAC' | 'NON_ALIGNED';
type Rung = 'UNKNOWN' | 'CONTACT' | 'TRADE_MISSION' | 'FRAMEWORK' | 'SIGNED' | 'STRATEGIC';
type RegimeId = 'US' | 'FR' | 'DE' | 'UK' | 'NORDIC' | 'RU' | 'CN' | 'TR' | 'KR' | 'JP' | 'IL' | 'IN';

interface Vendor {            // extends today's Vendor
  bloc: Bloc;
  parentStates: RegimeId[];   // >1 => JV
  affiliates: { id: VendorId; share: number }[];
  rung: Rung;
  closedUntilEvent?: string;  // e.g. JP policy shift
  archetype: 'OPEN_INTEGRATOR' | 'CLOSED_ECOSYSTEM' | 'VOLUME_BUILDER' | 'SPECIALIST';
}
interface EquipmentModule { origins: VendorId[]; }   // sub-supplier graph
```

The sanction state machine in `diplomacyEngine.ts` keeps its shape (WARNING → FROZEN/REVOKED); only its **inputs** change:
regime hazard multiplier, secondary-sanction term, propagation through `affiliates`/`origins`.

## 7. Implementation phases

1. **Data + ladder** (no new UI): extend `Vendor`/`Module`, add ~10 vendors at CONTACT/UNKNOWN, gate catalogue visibility by rung. ~1 day.
2. **Diplomacy tab v2**: group vendors by rung, "Advance relationship" action, bloc chips. Needs the UI-scale work done first (done). ~1 day.
3. **Regime + propagation**: regime multipliers, `origins` freeze, affiliate contagion, secondary-sanction risk. ~1–2 days.
4. **Events**: Mistral-style cancel/resale, Japan-style policy shift, JV double exposure. ~1 day.
5. **Content pass**: ~40–60 new catalogue modules across the candidates; optional two new protocol tags. ~2 days.

## 8. Decisions (2026-09-29)

1. **Names:** a toggle. Default to fictional aliases; real names are a skin. Sanction/scandal text stays generic in both modes.
2. **Submarines:** yes, a new hull class (`SUBMARINE`, with `AIP`/diesel-electric plants, stealth and depth attributes). This makes
   Hanwha, TKMS and CSSC meaningful and gives abyssal waters a gameplay role.
3. **Vendor count (decided):** curated ~8 foreign vendors, each with a distinct regime, niche and story; the relationship ladder
   reveals them gradually. Not the 15+ sandbox roster in §5 (that is a source pool to pick from).
4. **Fairness (decided):** every supply-chain hazard is avoidable with information: foreshadowed warnings, plus a "due diligence"
   action that reveals hidden sub-suppliers (`origins`) *before* purchase. No unforeseeable blindsides.
5. **Bloc affinity (decided):** soft. Courting adversary blocs costs standing and price with the other blocs; it never locks the
   player out and there are no hard secondary sanctions in v1.
6. **Economy (decided):** rebalance so budget bites (income currently far outpaces spending, ~2.6B by day 56). Vendor deposits,
   cancellation penalties and offsets are real budget decisions alongside Political Capital and time. Needs its own balance pass.
7. **Cold vendors (decided):** all three, staged cheapest-first: Japan-type (policy-shift event), China-type (bloc-gated, needs soft
   affinity), India-type (JV, needs multi-parent sanction logic). They are hidden until unlocked, so they do not add to the initial 8.
8. **Naming (decided):** fully fictional by default (vendors, countries, modules, R&D projects, tutorial copy); real names are an
   optional skin behind a settings toggle. Sanction and scandal wording stays generic in both modes.
9. **Alias set (approved)** as listed in §9. **Extra protocol tags (decided: skip for v1):** Nordvik and Dahai reuse the existing four tags
   (`NORDIC_OPEN`, `SINO_DIGITAL` stay a future refinement if playtesting shows the four are too coarse). Aliases and roster remain open to refinement.

## 9. Curated roster (decided 2026-09-29)

Eight vendors at start, three cold vendors unlocking over a run. Each one teaches a different mechanic. The "real analogue" column
is the skin mapping only; the game shows the alias by default.

| # | Alias (default) | Country alias | Real analogue (skin) | Regime | Start rung | Teaches |
|---|---|---|---|---|---|---|
| 1 | Arsenal Yards | Home | Domestic Yards | Home | Signed | Fallback, substitution, licensed production |
| 2 | Meridian Navale | Republic of Aurelle | Naval Group / Thales | Politically steered, refunds owed | Signed | Cancellation and resale (Mistral case) |
| 3 | Halberd Dynamics | Federated States of Halcyon | Raytheon | Deepest catalogue, strictest licences | Framework | Closed ecosystem, high friction |
| 4 | Sarnic Defence | Republic of Sarnia | Aselsan | Transactional, eager for customers | Signed | Substitution story (already in the tutorial) |
| 5 | Zvezda-Nord Export | Eastern Bloc | (fictional already) | State monopoly, cheap | Signed | Bloc affinity: courting it costs Western standing |
| 6 | Nordvik Systems | Kingdom of Vinterland | Saab | Restrictive on conflict parties | Contact | Bridge-friendly CMS; standing tied to your `incidents` |
| 7 | Seorak Consortium | Republic of Seoryeong | Hanwha / HD HHI | Business-friendly, fast | Contact | Consortium sales; gateway to submarines |
| 8 | Kessler-Brandt Antriebe | Federal Republic of Rheinmark | TKMS / MTU-class | Slow, component licences | Unknown | **Hidden sub-supplier** (engines inside others' products) |
| C1 | Mitsurugi Heavy Industries | Akitsu Federation | MHI | **Closed** until a policy-shift event | Closed | Policy-shift event, premium reliable hulls |
| C2 | Dahai Marine Group | Dahai Republic | CSSC / NORINCO | Volume builder, gated by bloc | Unknown | Soft bloc affinity, few references |
| C3 | Vayu-Sarath Aerospace (JV) | Bharatvar + Eastern Bloc | BrahMos | JV: either parent state can sanction | Unknown | Double sanction exposure |

Build order for the cold vendors: C1 (a `closedUntilEvent` flag and one event), C2 (needs soft bloc affinity), C3 (needs multi-parent
sanction logic). Module names follow the same rule: fictional by default (e.g. TACTICOS → "TACTIS", MK41 + ESSM → "VL-41 + SPX-16",
Aegis Link → "Bulwark Link"), with the real name in the skin table.

## 10. Build phases (revised for the decisions above)

0. **Display-name layer — DONE (2026-09-29).** `displayName(id, skin)` for vendors, countries, modules, projects; tutorial text uses tokens
   (`{vendor:SARNIC}`) instead of literals; settings toggle (persisted). Do this first, before content grows.
1. **Ladder + regimes + roster 6-8 — DONE (2026-09-30).** `rung`, regime profiles replacing the single `volatility`, catalogue gated by rung, Diplomacy tab v2.
2. **Information game — DONE (2026-09-30).** `origins` on modules, a due-diligence action that reveals them before purchase, warning stage kept for every hazard.
3. **Contracts — DONE (2026-09-30).** Deposits, cancellation penalties, refund/resale for hulls under construction (Mistral); incident-driven standing loss for restrictive regimes.
4. **Economy rebalance — superseded** by the fiscal year (`PLAN-command-and-economy.md`); offsets not built. Original scope: income vs upkeep, deposits, offsets; verify with `verifySim`.
5. **Cold vendors** C1, C2, C3 in that order; then submarines as a separate track.


## Sources

- [Naval Group — GlobalSecurity](https://www.globalsecurity.org/military/world/europe/dcn.htm), [Thales naval technology](https://www.naval-technology.com/contractors/maritime-c4/thales-c4isr/), [Fincantieri / OSN](https://www.fincantieri.com/en/group/company/subsidiaries-and-associates/Orizzonte-Sistemi-Navali), [Defense News on Italian yards](https://www.defensenews.com/global/europe/2018/10/10/italian-shipbuilders-tout-systems-engineering-chops-ahead-of-french-merger-talks/)
- [Wassenaar Arrangement (Wikipedia)](https://en.wikipedia.org/wiki/Wassenaar_Arrangement), [ITAR (Wikipedia)](https://en.wikipedia.org/wiki/International_Traffic_in_Arms_Regulations), [CAATSA (Wikipedia)](https://en.wikipedia.org/wiki/Countering_America's_Adversaries_Through_Sanctions_Act), [German Federal Security Council (Wikipedia)](https://en.wikipedia.org/wiki/Federal_Security_Council_(Germany))
- [Mistral sale — ECA Watch](https://www.eca-watch.org/updates/the-french-mistral-the-case-of-the-russian-sale-and-its-aftermath/), [Defense News 2015](https://www.defensenews.com/naval/2015/08/09/mistral-dispute-with-russia-settled-france-eyes-exports/)
- [Thai S26T / Chinese engine issue and Pakistan Hangor — Naval News](https://www.navalnews.com/features/2026/09/pakistans-hangor-class-and-naval-strategic-souvereignty), [Tughril-class (Wikipedia)](https://en.wikipedia.org/wiki/Tughril-class_frigate)
- [Turkey MILGEM exports — ESD](https://euro-sd.com/2023/05/articles/31367/the-milgem-programme-turkish-naval-procurement-and-exports/), [Turkish naval exports in SE Asia](https://www.asianmilitaryreview.com/2025/08/turkeys-naval-exports-make-waves-in-southeast-asia-foc/)
- [Korean yards "One Team" — Naval News](https://www.navalnews.com/naval-news/2025/02/korean-shipbuilding-giants-join-forces-in-naval-export-market/), [Saudi naval programme — UPI](https://www.upi.com/Top_News/World-News/2026/07/23/saudi-arabia-hd-hyundai-heavy-industries-hanwha-ocean/5171784845116/)
- [Japan–Australia Mogami — CSIS](https://www.csis.org/analysis/mogami-advancing-australia-japan-defense-cooperation), [Defense News](https://www.defensenews.com/global/asia-pacific/2025/08/06/japan-closes-in-on-biggest-ever-defense-export-with-frigate-selection/)
- [Saab 9LV](https://www.saab.com/products/9lv-cs), [Kongsberg NSM customers (Wikipedia via search)](https://en.wikipedia.org/wiki/Skjold-class_corvette)
- [BrahMos–Indonesia — Naval News](https://www.navalnews.com/naval-news/2026/07/indonesia-signs-brahmos-missile-deal-with-india/), [BrahMos–Philippines](https://www.brahmos.com/brahmos-in-media/114)
- [Rosoboronexport (Wikipedia)](https://en.wikipedia.org/wiki/Rosoboronexport), [CRS: Russian arms sales](https://www.congress.gov/crs-product/R46937)
- [Barak 8 (Wikipedia)](https://en.wikipedia.org/wiki/Barak_8), [Type 31 / Arrowhead — Navy Lookout](https://www.navylookout.com/a-guide-to-the-type-31-frigate/)
