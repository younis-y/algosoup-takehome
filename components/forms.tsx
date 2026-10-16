"use client";

import { useActionState } from "react";
import { approvePlan, createBattery, executePlan, generatePlan, type FormState } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export function BatteryForm() {
  const [state, action, pending] = useActionState(createBattery, undefined);
  return (
    <form action={action} className="grid gap-4">
      <Field id="name" label="Name" placeholder="e.g. Cottam BESS" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field id="capacityMwh" label="Energy capacity (MWh)" type="number" step="any" defaultValue={100} />
        <Field id="powerMw" label="Power (MW)" type="number" step="any" defaultValue={50} />
        <Field id="rte" label="Round-trip efficiency (%)" type="number" step="any" defaultValue={88} />
        <Field id="minSoc" label="Min SoC (%)" type="number" step="any" defaultValue={10} />
        <Field id="maxSoc" label="Max SoC (%)" type="number" step="any" defaultValue={90} />
        <Field id="maxCyclesPerDay" label="Max cycles per day" type="number" step="any" defaultValue={1.5} />
      </div>
      <ErrorAlert state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">{pending ? "Adding…" : "Add battery"}</Button>
    </form>
  );
}

export function PlanForm({ batteryId, defaultDate, maxDate }: { batteryId: number; defaultDate: string; maxDate: string }) {
  const [state, action, pending] = useActionState(generatePlan, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="batteryId" value={batteryId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="deliveryDate">Delivery date</Label>
          <Input id="deliveryDate" name="deliveryDate" type="date" defaultValue={defaultDate} max={maxDate} required />
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Optimising…" : "Generate plan"}</Button>
      </div>
      <ErrorAlert state={state} />
    </form>
  );
}

export function PlanActions({ planId, status }: { planId: number; status: string }) {
  const [approveState, approve, approving] = useActionState(approvePlan, undefined);
  const [executeState, execute, executing] = useActionState(executePlan, undefined);
  return (
    <div className="grid gap-3">
      {status === "draft" && (
        <form action={approve}>
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" disabled={approving}>{approving ? "Approving…" : "Approve plan"}</Button>
        </form>
      )}
      {status === "approved" && (
        <form action={execute}>
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" disabled={executing}>{executing ? "Settling…" : "Mark executed"}</Button>
        </form>
      )}
      <ErrorAlert state={approveState ?? executeState} />
    </div>
  );
}
