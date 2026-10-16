# Battery Dispatch Planner

Plans which half-hours a GB grid battery should charge and discharge on a given day, shows the expected £, and tracks the plan from draft to approval to execution, then compares realised P&L with what was expected.

- **Live demo:** https://algosoup-takehome-ten.vercel.app
- **Repo:** <to be added>

## Who it's for

A trader or asset optimiser at a GB battery storage operator who currently decides which half-hours to buy and sell using spreadsheets and gut feel. The app turns that into a repeatable plan with an audit trail.

## Core flow

1. **Set up a battery**: capacity, power, round-trip efficiency, min/max SoC, max cycles per day.
2. **Pick a delivery date** and generate a plan from prices.
3. **Review** the two-panel chart (price, and charge/discharge with SoC) and the expected P&L.
4. **Approve** the plan.
5. **Mark executed** once the day has settled, which shows realised vs expected P&L.

Plans move `draft → approved → executed`, and the server enforces this:

- Approve and execute are conditional UPDATEs (`WHERE status = 'draft'` / `'approved'`), so a stale page or a double click can't skip a state.
- Generating a plan is an upsert on `UNIQUE (battery_id, delivery_date)` with `setWhere status = 'draft'`. Once a plan is approved it can't be regenerated.

## Data model

All in `db/schema.ts` (Drizzle, Postgres on Neon).

| Table | Purpose |
|---|---|
| `battery` | Asset settings. CHECK constraints: capacity, power and cycles > 0; `0 < rte ≤ 1`; `0 ≤ min_soc < max_soc ≤ 1`. |
| `price` | Half-hourly wholesale price. PK `(settlement_date, settlement_period)`; `source` is `elexon` or `seed`. |
| `ancillary_price` | NESO Dynamic Containment (DCH/DCL) clearing prices per EFA block. Collected for frequency-response stacking; the optimiser doesn't use them yet. |
| `dispatch_plan` | One plan per battery per delivery date. `params` (jsonb) snapshots the battery settings at plan time; holds status, expected and realised P&L. |
| `plan_interval` | One row per period: action, grid-side MWh, SoC after, forecast price, actual price. |

Prices and P&L use `double precision` rather than `numeric`. Dates use Drizzle's string mode (`'2026-10-14'`), so no timezone shifts happen in JS. The schema already has a `reserve` action, `reserved_mw` and `pnl_breakdown` for the frequency-response work in "What's next".

## Optimiser: method and limits

`lib/optimise.ts` is pure TypeScript with no I/O.

- **Steps:** half-hour periods, so MWh = MW × 0.5. SoC carries from one period to the next, starts at min SoC, and must end at or above where it started.
- **Efficiency:** split as √rte on each leg. Charging X MWh from the grid stores X·√rte. Discharging Y MWh to the grid draws Y/√rte from storage.
- **Greedy search:** on each pass it picks the most profitable feasible (charge period, discharge period) pair. The pair is sized to the tightest of: power headroom in both periods, SoC headroom along every period between them, and the remaining cycle budget. A charge-only move is also allowed at negative prices (you get paid to take energy).
- **Never discharges at a price ≤ £0.** Doing so would just burn energy through losses.
- **Cycles:** energy drawn from storage ÷ usable energy, where usable energy = (max SoC − min SoC) × capacity.
- **Validation:** `checkPlan` is a separate validator that re-simulates the physics (power, SoC bounds, SoC carry-over, end-of-day SoC, cycle cap). A property test runs 200 random batteries and price days through it.

**Limits:**

- Greedy is not globally optimal. An LP/MILP would be.
- No degradation model beyond the cycle cap.
- Assumes perfect execution: the planned volumes are delivered exactly.

### Forecast and settlement

- **Naive persistence:** day D is planned on day D‑1 prices, matched by settlement period. A period with no forecast price (e.g. periods 49–50 when D is a 50-period day) stays idle; the planner doesn't invent a price for it. Planning is refused if fewer than half of the periods have a forecast price.
- **Realised P&L** settles the same planned volumes at day D's actual prices. Execution is refused until day D has a complete set of prices.

### Edge cases handled

- Negative prices: the optimiser charges into them and never discharges into them.
- Clock-change days with 46 or 50 periods. The expected count comes from Europe/London midnights (`lib/periods.ts`).
- Missing periods, which are reported, idled in planning, and block execution.
- API down: prices are cached in the DB, and 2026‑10‑13 and 2026‑10‑14 are seeded from snapshot files.
- Nonsense battery settings are rejected in the server action (`validateBattery`) and again by the DB CHECK constraints.

### Caveats

- The price is Elexon's Market Index Price (`APXMIDP`), a spot index used as a proxy. It is not the N2EX day-ahead auction price a trader would actually commit at.
- Most GB battery revenue comes from the Balancing Mechanism and frequency services. This app covers wholesale arbitrage only.
- The demo uses a shared database with no auth, so anyone with the URL can add batteries and plans. Auth was out of scope.

## Data sources

Neither source needs an API key.

- **Elexon Insights `market-index`** (`lib/elexon.ts`). The `from`/`to` filters apply to UTC `startTime`, but `settlementDate` is the UK local day. The client therefore over-fetches a window either side and filters on `settlementDate`. Rows with zero price and zero volume mean no trades, so they're treated as missing rather than as £0.
- **NESO Data Portal, EAC auction results** (`lib/neso.ts`). `deliveryStart` is UTC but has no `Z` suffix, so the client appends one before parsing. Results are filtered to the EFA day, which starts at 23:00 local the evening before.

Both clients read from the DB first and only call the API when a day is incomplete.

## Run locally

Requires Node 22+ and a Postgres database (Neon; the app uses `@neondatabase/serverless`).

```bash
npm install
```

Create `.env.local`:

```bash
DATABASE_URL=postgres://...          # pooled, used by the app and seed
DATABASE_URL_UNPOOLED=postgres://... # direct, used by drizzle-kit migrations
```

Then:

```bash
npm run db:migrate   # apply db/migrations
npm run db:seed      # demo battery + prices for 2026-10-13/14 (idempotent)
npm run dev          # http://localhost:3000
```

With the seed data, choose delivery date **2026-10-14**. It is planned on 10‑13 prices and can be executed against 10‑14 actuals without any network access.

## Tests

```bash
npm test           # vitest: optimiser, validator, settlement, period helpers
npm run test:e2e   # Playwright (WebKit)
```

- The unit tests cover idle on flat prices, power limits, efficiency losses, cycle cap, negative prices, missing prices, the 200-case property test, and 46/48/50-period days.
- The e2e suite runs the full flow (create → generate → approve → execute), rejects a bad battery, checks that an approved plan can't be overwritten, and covers clock-change days.
- By default the e2e suite targets the **production URL** and writes test batteries to the shared demo database. To point it at another deployment or a local server, set `E2E_BASE_URL`, e.g. `E2E_BASE_URL=http://localhost:3000 npm run test:e2e`.

## What's next

- **Frequency-response revenue stacking:** commit EFA blocks to Dynamic Containment using the NESO prices already cached, and plan arbitrage around the reserved headroom.
- **LP/MILP optimiser:** report the uplift over greedy, with a binary variable to prevent simultaneous charge and discharge.
- **A better forecast** than D‑1 persistence.
- **Balancing Mechanism:** needs a bid/offer strategy and acceptance modelling. It can't be planned like a fixed schedule.
- **Auth and multi-tenancy.**
