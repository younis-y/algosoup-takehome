"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type ChartRow = {
  period: number; forecastPrice: number | null; actualPrice: number | null;
  charge: number; discharge: number; soc: number; reserved: boolean;
};

// Contiguous runs of reserved periods, for shading.
function reservedRuns(rows: ChartRow[]) {
  const runs: { x1: number; x2: number }[] = [];
  for (const r of rows) {
    const last = runs.at(-1);
    if (!r.reserved) continue;
    if (last && last.x2 === r.period - 1) last.x2 = r.period; else runs.push({ x1: r.period, x2: r.period });
  }
  return runs;
}

// Two panels on one time axis instead of a dual-axis chart: £/MWh above, MWh below.
const priceConfig = {
  forecastPrice: { label: "Forecast (D‑1) £/MWh", color: "var(--viz-1)" },
  actualPrice: { label: "Actual £/MWh", color: "var(--viz-2)" },
} satisfies ChartConfig;

const energyConfig = {
  charge: { label: "Charge (MWh, import)", color: "var(--viz-1)" },
  discharge: { label: "Discharge (MWh, export)", color: "var(--viz-2)" },
  soc: { label: "State of charge (MWh)", color: "var(--viz-3)" },
} satisfies ChartConfig;

const axis = { tickLine: false, axisLine: false, fontSize: 11 } as const;

export function DispatchChart({ rows, showActual }: { rows: ChartRow[]; showActual: boolean }) {
  // Charge is drawn below the baseline (energy in), discharge above (energy out).
  const shade = reservedRuns(rows).map((r) => (
    <ReferenceArea key={r.x1} x1={r.x1} x2={r.x2} fill="var(--muted-foreground)" fillOpacity={0.12} strokeOpacity={0} ifOverflow="extendDomain" />
  ));
  const data = rows.map((r) => ({ ...r, charge: r.charge ? -r.charge : null, discharge: r.discharge || null }));
  return (
    <div className="space-y-2">
      <ChartContainer config={priceConfig} className="h-52 w-full">
        <ComposedChart data={data} syncId="plan" margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="period" {...axis} hide />
          <YAxis {...axis} width={48} tickFormatter={(v) => `£${v}`} />
          {shade}
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Period ${p?.[0]?.payload.period}`} />} />
          <Line dataKey="forecastPrice" type="stepAfter" stroke="var(--color-forecastPrice)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          {showActual && <Line dataKey="actualPrice" type="stepAfter" stroke="var(--color-actualPrice)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
          {showActual && <ChartLegend content={<ChartLegendContent />} />}
        </ComposedChart>
      </ChartContainer>
      <ChartContainer config={energyConfig} className="h-56 w-full">
        <ComposedChart data={data} syncId="plan" margin={{ left: 4, right: 8 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="period" {...axis} interval={5} />
          <YAxis {...axis} width={48} />
          {shade}
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Period ${p?.[0]?.payload.period}`} />} />
          <Bar dataKey="charge" fill="var(--color-charge)" radius={[0, 0, 4, 4]} isAnimationActive={false} />
          <Bar dataKey="discharge" fill="var(--color-discharge)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="soc" type="linear" stroke="var(--color-soc)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <ChartLegend content={<ChartLegendContent />} />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
