# Command agency & civil-military economy — plan

Status: **decided 2026-09-30, build in progress: steps 1 (preview strip), 2 (support + fiscal year) and 3 (contact SOP ladder) done.** Source: user feedback after the tutorial review.
This plan supersedes the "economy rebalance" phase in `PLAN-foreign-contractors.md` §10 and runs **before** contractors phase 1,
so vendors can be priced against a budget that actually bites.

## Problems (verified in code)

1. **Consequences are invisible until after the click.** Buttons carry at most a `title` tooltip describing the action, never its effect.
2. **Unknown contacts give no agency.** A contact is a dice roll resolved by ROE; the player can neither query, warn nor intercept it.
3. **Budget can be farmed.** Income is a flat 8M/day, the tutorial fleet's upkeep is ~4M/day, and nothing takes money back. Idling wins.
4. **No domestic politics.** The civilian government never reacts to the navy's record, and Political Capital regenerates regardless.

## Build order

1. Action preview strip — small; every later feature reports through it.
2. Domestic support + fiscal year (the economy rebalance).
3. Contact SOP ladder — largest; its incidents feed domestic support.
4. Then contractors phase 1 (`PLAN-foreign-contractors.md`).

## 1. Action preview strip

- A one-line strip **below the tactical ticker**. Hovering or keyboard-focusing any action shows its **predicted consequence**, not a
  description: costs, before -> after values, time to effect, risks, and why it is blocked.
- Built into the shared `Btn` (`preview` prop, computed lazily at hover time from the live world), so every action gets it.
- Pure functions in `lib/sim/preview.ts` (headless-testable); text uses name tokens, so the skin applies.
- Idle text: "Hover an action to see its effect."

## 2. Domestic support & the fiscal year

**Domestic support (0-100),** shown in the top bar. How willing the civilian government is to back the navy.
- Up: tension spikes (rally effect), hostiles destroyed, averted sanctions, sectors covered.
- Down: incidents, ships lost, unopposed hostile probes, deficits, running over budget, stalled or frozen procurement.
- Periodic elections (about every 2 fiscal years) pull it towards 50 with a random swing.
- **Graduated effects (decided):**
  - `< 40`: lobbying costs +50%, PC regenerates at half rate.
  - `< 25`: ministries refuse lobbying and budget hearings; PC drains 0.2/day.
  - `< 10`: parliamentary inquiry: next appropriation cut 20%, procurement orders frozen 30 days.
  - Every threshold is shown in advance (support meter ticks + preview strip).

**Fiscal year (decided): 360 days, paid in four quarterly tranches.**
- The appropriation for next year is shown as a **forecast range** that moves daily with support, tension and the navy's record.
  It locks 30 days before year end.
- **Budget hearing** (lever): spend PC to push the forecast up; success chance scales with support; failure costs support.
  Refused below support 25.
- **Carryover (decided): partial.** Up to 15% of the year's appropriation carries over; the rest is returned to the Treasury.
  Spending under 70% of the appropriation also lowers next year's forecast ("you needed less than you asked for").
- **Real running costs** replace the flat 8M/day income: crew wages per commissioned hull (even docked), fuel on patrol, base overhead,
  and maintenance that grows with hull age. A fleet in port still costs money.
- Deficit: allowed briefly, but each deficit day costs support.

## 3. Contact SOP ladder

**Decided: a standing SOP per sector, with per-contact override.**
- Contacts get a hidden **intent**: merchant, fishing fleet, smuggler, surveillance shadower, foreign warship, raider.
- Escalation ladder, each step taking time, revealing information and carrying risk:
  **Shadow -> Hail -> Warn -> Intercept / Board -> Engage.**
  - Merchants and fishers answer hails; smugglers run; shadowers break off when warned; warships protest (tension);
    raiders may fire first when warned or intercepted.
  - Boarding a smuggler seizes cargo (small budget and support gain); boarding a merchant is an incident.
- **Sector SOP:** distances and conditions per step (e.g. hail at 20 tiles, warn at 14, engage only if the warning is ignored),
  capped by ROE. ROE becomes the ceiling on which steps are authorised, not the only lever.
- **Per-contact override:** click a contact on the plot (new map picking) to open its ladder and act directly.
- Outcomes feed the ledger, tension and domestic support.

## Open questions

- Exact support weights and appropriation formula: tune with `verifySim` (a "duck" run that idles must end worse off than an active run).
- Whether the tutorial gets a lesson on the fiscal year and the SOP ladder (likely yes, after both land; tutorial pass is already queued).
