// Plain-English definitions for every abbreviation and term the app shows.
// <Abbr> gives an inline hover/press definition; <Glossary> lists them all.

export const TERMS: Record<string, { name: string; means: string }> = {
  MWh: { name: "megawatt-hour", means: "An amount of energy, like litres of water in a tank. 1 MWh is roughly what 135 UK homes use in a day." },
  MW: { name: "megawatt", means: "How fast energy flows in or out, like how wide a tap is. A 50 MW battery can move 25 MWh in half an hour." },
  "£/MWh": { name: "pounds per megawatt-hour", means: "The price of electricity: how much 1 MWh costs to buy or earns when sold." },
  "%": { name: "efficiency", means: "Out of every 100 units of energy put in, how many come back out. The rest is lost as heat. Grown-ups call it round-trip efficiency (RTE)." },
  Charge: { name: "state of charge (SoC)", means: "How full the battery is. Batteries last longer if they're never completely empty or completely full, so we keep them between two limits." },
  Fill: { name: "cycle", means: "Filling the battery's usable space once and emptying it again. Limiting fills per day helps the battery last longer." },
  "Half-hour": { name: "settlement period", means: "Great Britain's electricity market runs in half-hour slots: 48 a normal day, 46 when the clocks go forward, 50 when they go back." },
  Guess: { name: "forecast", means: "We don't know tomorrow's prices, so we use the day before's prices as our guess. Simple, but honest." },
  "P&L": { name: "profit and loss", means: "Money made minus money spent. Expected P&L is what the plan should make; realised P&L is what it really made." },
  DC: { name: "Dynamic Containment", means: "A standby job from NESO: the battery is paid to stay ready to push or soak up power within a second if the grid wobbles." },
  EFA: { name: "EFA block", means: "Standby jobs are sold in 4-hour blocks, starting at 23:00. (EFA = Electricity Forward Agreement, an old industry calendar.)" },
  NESO: { name: "National Energy System Operator", means: "The organisation that keeps Great Britain's electricity grid balanced. It buys standby jobs like DC." },
  Elexon: { name: "Elexon", means: "The organisation that settles Great Britain's electricity market. Our half-hourly prices come from its free data service." },
  Draft: { name: "plan stages", means: "Draft: made, can still be changed. Approved: locked in. Done: the day is over and we've checked the real money." },
};

export function Abbr({ term, children }: { term: keyof typeof TERMS; children?: React.ReactNode }) {
  const t = TERMS[term];
  return (
    <abbr title={`${t.name}: ${t.means}`} className="cursor-help underline decoration-dotted underline-offset-4">
      {children ?? term}
    </abbr>
  );
}

export function Glossary({ terms = Object.keys(TERMS) }: { terms?: (keyof typeof TERMS)[] }) {
  return (
    <details className="rounded-2xl bg-muted/60 p-4 text-sm [&_summary]:cursor-pointer">
      <summary className="font-medium">Words we use</summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {terms.map((k) => (
          <div key={k}>
            <dt className="font-medium">{k}{TERMS[k].name.toLowerCase() !== k.toLowerCase() && <span className="font-normal text-muted-foreground"> ({TERMS[k].name})</span>}</dt>
            <dd className="text-muted-foreground">{TERMS[k].means}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
