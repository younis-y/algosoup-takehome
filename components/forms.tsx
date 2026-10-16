"use client";

// Design rule: prevent, then enforce. Inputs only offer valid choices and actions are
// disabled (with the reason shown) when they would break a constraint. The server
// actions re-check everything as the backstop for stale tabs and hand-made requests.

import Link from "next/link";
import { useActionState, useState } from "react";
import { approvePlan, createBattery, executePlan, generatePlan, type FormState } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateBattery } from "@/lib/optimise";

function ErrorAlert({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>;
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} required {...props} />
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

  return (
    <form action={action} className="grid gap-4">
      <Field id="name" label="Name" placeholder="e.g. Cottam BESS" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field id="capacityMwh" label="Energy capacity (MWh)" type="number" step="any" min={0.1} {...bind("capacityMwh")} />
        <Field id="powerMw" label="Power (MW)" type="number" step="any" min={0.1} {...bind("powerMw")} />
        <Field id="rte" label="Round-trip efficiency (%)" type="number" step="any" min={1} max={100} {...bind("rte")} />
        <Field id="minSoc" label="Min SoC (%)" type="number" step="any" min={0} max={Number.isFinite(n("maxSoc")) ? n("maxSoc") - 1 : 99} {...bind("minSoc")} />
        {/* Like a return date that can't precede the outbound date: max SoC starts above min SoC. */}
        <Field id="maxSoc" label="Max SoC (%)" type="number" step="any" min={(n("minSoc") || 0) + 1} max={100} {...bind("maxSoc")} />
        <Field id="maxCyclesPerDay" label="Max cycles per day" type="number" step="any" min={0.1} {...bind("maxCyclesPerDay")} />
      </div>
      {problems.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-destructive" data-testid="battery-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Usable energy {usable.toFixed(1)} MWh · {(usable / spec.powerMw).toFixed(1)} h at full power · 1 cycle = {usable.toFixed(1)} MWh discharged
        </p>
      )}
      <ErrorAlert state={state} />
      <Button type="submit" disabled={pending || problems.length > 0 || !name.trim()} className="justify-self-start">
        {pending ? "Adding…" : "Add battery"}
      </Button>
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
        <div className="grid gap-1.5">
          <Label htmlFor="deliveryDate">Delivery date</Label>
          <Input id="deliveryDate" name="deliveryDate" type="date" value={date} max={maxDate} required onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending || !date || locked || future}>
          {pending ? "Optimising…" : plan?.status === "draft" ? "Regenerate draft" : "Generate plan"}
        </Button>
      </div>
      {locked && (
        <p className="text-sm text-muted-foreground" data-testid="plan-locked">
          The plan for {date} is already {plan.status} and can&apos;t be regenerated. <Link className="underline" href={`/plans/${plan.id}`}>View it</Link>
        </p>
      )}
      {future && <p className="text-sm text-muted-foreground">Plans can be made up to today ({maxDate}); the forecast needs yesterday&apos;s prices.</p>}
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
          <Button type="submit" disabled={approving}>{approving ? "Approving…" : "Approve plan"}</Button>
        </form>
      )}
      {status === "approved" && (
        <form action={execute}>
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" disabled={executing || !!settlesAfter}>{executing ? "Settling…" : "Mark executed"}</Button>
        </form>
      )}
      {status === "approved" && settlesAfter && (
        <p className="text-xs text-muted-foreground">Available once {settlesAfter} has fully settled</p>
      )}
      <ErrorAlert state={approveState ?? executeState} />
    </div>
  );
}
