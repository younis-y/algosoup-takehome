CREATE TYPE "public"."interval_action" AS ENUM('charge', 'discharge', 'idle', 'reserve');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'approved', 'executed');--> statement-breakpoint
CREATE TABLE "ancillary_price" (
	"delivery_start" timestamp with time zone NOT NULL,
	"delivery_end" timestamp with time zone NOT NULL,
	"product" text NOT NULL,
	"price_gbp_mw_h" double precision NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "ancillary_price_delivery_start_product_pk" PRIMARY KEY("delivery_start","product")
);
--> statement-breakpoint
CREATE TABLE "battery" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity_mwh" double precision NOT NULL,
	"power_mw" double precision NOT NULL,
	"rte" double precision NOT NULL,
	"min_soc" double precision NOT NULL,
	"max_soc" double precision NOT NULL,
	"max_cycles_per_day" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battery_capacity_pos" CHECK ("battery"."capacity_mwh" > 0),
	CONSTRAINT "battery_power_pos" CHECK ("battery"."power_mw" > 0),
	CONSTRAINT "battery_rte_range" CHECK ("battery"."rte" > 0 AND "battery"."rte" <= 1),
	CONSTRAINT "battery_soc_range" CHECK ("battery"."min_soc" >= 0 AND "battery"."min_soc" < "battery"."max_soc" AND "battery"."max_soc" <= 1),
	CONSTRAINT "battery_cycles_pos" CHECK ("battery"."max_cycles_per_day" > 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"battery_id" integer NOT NULL,
	"delivery_date" date NOT NULL,
	"forecast_date" date NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"params" jsonb NOT NULL,
	"expected_pnl" double precision NOT NULL,
	"realised_pnl" double precision,
	"pnl_breakdown" jsonb,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_battery_day" UNIQUE("battery_id","delivery_date")
);
--> statement-breakpoint
CREATE TABLE "plan_interval" (
	"plan_id" integer NOT NULL,
	"period" integer NOT NULL,
	"action" interval_action NOT NULL,
	"mwh" double precision NOT NULL,
	"soc_after_mwh" double precision NOT NULL,
	"reserved_mw" double precision DEFAULT 0 NOT NULL,
	"forecast_price" double precision,
	"actual_price" double precision,
	CONSTRAINT "plan_interval_plan_id_period_pk" PRIMARY KEY("plan_id","period")
);
--> statement-breakpoint
CREATE TABLE "price" (
	"settlement_date" date NOT NULL,
	"settlement_period" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"price_gbp_mwh" double precision NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_settlement_date_settlement_period_pk" PRIMARY KEY("settlement_date","settlement_period")
);
--> statement-breakpoint
ALTER TABLE "dispatch_plan" ADD CONSTRAINT "dispatch_plan_battery_id_battery_id_fk" FOREIGN KEY ("battery_id") REFERENCES "public"."battery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_interval" ADD CONSTRAINT "plan_interval_plan_id_dispatch_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."dispatch_plan"("id") ON DELETE cascade ON UPDATE no action;