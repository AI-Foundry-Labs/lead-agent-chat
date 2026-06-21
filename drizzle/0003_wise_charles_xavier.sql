-- F4d — GDPR consent + audit log tables. Idempotent for safe apply on any state.
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"admin_id" uuid,
	"actor_type" varchar(10) NOT NULL,
	"action" varchar(50) NOT NULL,
	"target_lead_id" uuid,
	"details" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"consent_type" varchar(20) NOT NULL,
	"granted" boolean NOT NULL,
	"source" varchar(50),
	"recorded_by" uuid,
	"notes" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead_consents" ADD CONSTRAINT "lead_consents_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead_consents" ADD CONSTRAINT "lead_consents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_lead_idx" ON "audit_log" USING btree ("agency_id","target_lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_time_idx" ON "audit_log" USING btree ("agency_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_consents_lead_idx" ON "lead_consents" USING btree ("agency_id","lead_id");
