"use client";

import dynamic from "next/dynamic";
import type { ChartRow } from "./dispatch-chart";

// recharts is heavy: load it client-side only, after the rest of the page.
// The placeholder matches the chart's height (h-52 + space-y-2 + h-56) so nothing shifts.
export const DispatchChart = dynamic<{ rows: ChartRow[]; showActual: boolean }>(
  () => import("./dispatch-chart").then((m) => m.DispatchChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[27.5rem] w-full items-center justify-center rounded-lg bg-muted/50 text-sm text-muted-foreground">
        Loading chart…
      </div>
    ),
  },
);
