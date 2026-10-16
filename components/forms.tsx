"use client";

// Design rule: prevent, then enforce. Inputs only offer valid choices and actions are
// disabled (with the reason shown) when they would break a constraint. The server
// actions re-check everything as the backstop for stale tabs and hand-made requests.

import Link from "next/link";
import { useActionState, useState } from "react";
import { cn } from "cn";
import { approvePlan, createBattery, executePlan, generatePlan, type FormState } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateBattery } from "@/lib/optimise";
import { STAGE, homesForADay, niceDate } from "@/lib/format";

function ErrorAlert({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <Alert variant="destructive" role="alert" className="rounded-2xl border-0 bg-destructive/10 px-4 py-3">
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}

// Filled, borderless box: the label sits inside at the top-left, the value below it,
// and the unit (if any) inside on the right.
const box = "relative h-14 rounded-2xl bg-muted/60";
const floatingLabel = "absolute top-2 left-4 right-4 truncate text-xs leading-4 text-muted-foreground";
const unitText = "pointer-events-none absolute right-4 bottom-2 text-sm leading-6 text-muted-foreground";
const noSpinner = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const filledInput = cn(
  "h-14 rounded-2xl border-0 bg-muted/60 px-4 pt-6 pb-2 text-base leading-6 tabular-nums shadow-none md:text-base",
  "dark:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
);

function Field({ id, label, unit, className, ...props }: { id: string; label: string; unit?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <label htmlFor={id} className={cn(floatingLabel, "pointer-events-none")}>{label}</label>
      <Input
        id={id} name={id} required
        aria-describedby={unit ? `${id}-unit` : undefined}
        className={cn(filledInput, props.type === "number" && noSpinner, unit && "pr-16", className)}
        {...props}
      />
      {unit && <span id={`${id}-unit`} className={unitText}>{unit}</span>}
    </div>
  );
}

const initial = { capacityMwh: "100", powerMw: "50", rte: "88", minSoc: "10", maxSoc: "90", maxCyclesPerDay: "1.5" };

export function BatteryForm() {
  const [state, action, pending] = useActionState(createBattery, undefined);
  const [name, setName] = useState("");
  const [v, setV] = useState(initial);
  const n = (k: keyof typeof initial) => (v[k] === "" ? NaN : Number(v[k]));
  const spec = {
    capacityMwh: n("capacityMwh"), powerMw: n("powerMw"), rte: n("rte") / 100,
    minSoc: n("minSoc") / 100, maxSoc: n("maxSoc") / 100, maxCyclesPerDay: n("maxCyclesPerDay"),
  };
  const problems = validateBattery(spec); // same rules the server applies
  const usable = (spec.maxSoc - spec.minSoc) * spec.capacityMwh;
  const bind = (k: keyof typeof initial) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) });
  const num = { type: "number", step: "any", inputMode: "decimal" } as const;
  const fit = (value: string) => `${Math.max(2, value.length) + 0.5}ch`; // input width follows its digits
  const rangeInput = cn("min-w-0 text-right bg-transparent p-0 text-base leading-6 tabular-nums outline-none", noSpinner);

  return (
    <form action={action} className="grid gap-3">
      <Field id="name" label="What's it called?" placeholder="e.g. Riverside Big Battery" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="capacityMwh" label="How much energy can it store?" unit="MWh" {...num} min={0.1} {...bind("capacityMwh")} />
        <Field id="powerMw" label="How fast can it fill up or empty?" unit="MW" {...num} min={0.1} {...bind("powerMw")} />
        <Field id="rte" label="How much energy comes back out?" unit="%" {...num} min={1} max={100} {...bind("rte")} />
        <Field id="maxCyclesPerDay" label="How many full fills a day?" unit="/ day" {...num} min={0.1} {...bind("maxCyclesPerDay")} />
        {/* One box, two inputs: still posts minSoc and maxSoc separately. */}
        <div role="group" aria-labelledby="socRange-label" className={cn(box, "px-4 pt-6 pb-2 focus-within:ring-2 focus-within:ring-ring/50 sm:col-span-2")}>
          <label id="socRange-label" htmlFor="minSoc" className={floatingLabel}>Keep its charge between</label>
          {/* Each number carries its own %, sized to its digits, so it reads "10 % to 90 %". */}
          <div className="flex items-baseline gap-1.5">
            <input id="minSoc" name="minSoc" required aria-label="Minimum charge (%)" className={rangeInput} style={{ width: fit(v.minSoc) }}
              {...num} min={0} max={Number.isFinite(n("maxSoc")) ? n("maxSoc") - 1 : 99} {...bind("minSoc")} />
            <span aria-hidden="true" className="text-muted-foreground">%</span>
            <span aria-hidden="true" className="px-1.5 text-muted-foreground">to</span>
            {/* Like a return date that can't precede the outbound date: max SoC starts above min SoC. */}
            <input id="maxSoc" name="maxSoc" required aria-label="Maximum charge (%)" className={rangeInput} style={{ width: fit(v.maxSoc) }}
              {...num} min={(n("minSoc") || 0) + 1} max={100} {...bind("maxSoc")} />
            <span aria-hidden="true" className="text-muted-foreground">%</span>
          </div>
        </div>
      </div>
      {problems.length > 0 ? (
        <ul className="grid list-disc gap-1 rounded-2xl bg-destructive/10 py-3 pr-4 pl-9 text-sm text-destructive" data-testid="battery-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">
          It can use {usable.toFixed(0)} MWh, about enough for {homesForADay(usable).toLocaleString("en-GB")} homes for a day, and fills up in {(usable / spec.powerMw).toFixed(1)} hours at full speed.
        </p>
      )}
      <ErrorAlert state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || problems.length > 0 || !name.trim()} className="h-12 px-6">
          {pending ? "Adding…" : "Add battery"}
        </Button>
        {problems.length === 0 && !name.trim() && (
          <p className="text-sm text-muted-foreground">Give it a name to add it.</p>
        )}
      </div>
    </form>
  );
}

export type ExistingPlans = Record<string, { id: number; status: string }>;

export function PlanForm({ batteryId, defaultDate, maxDate, existing }: {
  batteryId: number; defaultDate: string; maxDate: string; existing: ExistingPlans;
}) {
  const [state, action, pending] = useActionState(generatePlan, undefined);
  const [date, setDate] = useState(defaultDate);
  const plan = existing[date];
  const locked = plan && plan.status !== "draft";
  const future = date > maxDate;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="batteryId" value={batteryId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <Field id="deliveryDate" label="Which day are you planning?" type="date" value={date} max={maxDate} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending || !date || locked || future} className="h-14 px-6">
          {pending ? "Working it out…" : plan?.status === "draft" ? "Make it again" : "Make a plan"}
        </Button>
      </div>
      {locked && (
        <p className="px-1 text-sm text-muted-foreground" data-testid="plan-locked">
          The plan for {niceDate(date)} is already {STAGE[plan.status].toLowerCase()}, so it can&apos;t be changed. <Link className="underline" href={`/plans/${plan.id}`}>View it</Link>
        </p>
      )}
      {future && <p className="px-1 text-sm text-muted-foreground">You can plan up to today. We need the day before&apos;s prices to make a guess.</p>}
      <ErrorAlert state={state} />
    </form>
  );
}

export function PlanActions({ planId, status, settlesAfter }: { planId: number; status: string; settlesAfter: string | null }) {
  const [approveState, approve, approving] = useActionState(approvePlan, undefined);
  const [executeState, execute, executing] = useActionState(executePlan, undefined);
  return (
    <div className="grid justify-items-end gap-2">
      {status === "draft" && (
        <form action={approve}>
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" disabled={approving} className="h-12 px-6">{approving ? "Approving…" : "Approve plan"}</Button>
          <p className="mt-1 text-right text-xs text-muted-foreground">Happy with it? Approving locks it in.</p>
        </form>
      )}
      {status === "approved" && (
        <form action={execute}>
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" disabled={executing || !!settlesAfter} className="h-12 px-6">{executing ? "Checking real prices…" : "Mark as done"}</Button>
        </form>
      )}
      {status === "approved" && settlesAfter && (
        <p className="text-xs text-muted-foreground">You can mark it done once {settlesAfter} is over and the real prices are in.</p>
      )}
      <ErrorAlert state={approveState ?? executeState} />
    </div>
  );
}
