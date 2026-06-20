-- Catch-up baseline migration: brings the migration history in sync with schema.ts.
-- Captures objects previously applied only via `drizzle-kit push` (telegram_agent_sessions,
-- preferred_lang, anon_seq_counter, persona, anon_seq) PLUS the new message_templates table.
-- Written IDEMPOTENT so it applies cleanly whether a DB already has some objects (push) or none.
CREATE TABLE IF NOT EXISTS "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_agent_sessions" (
	"agency_id" uuid PRIMARY KEY NOT NULL,
	"agent_kind" varchar(20) NOT NULL,
	"lead_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "preferred_lang" varchar(2) DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "anon_seq_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "persona" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "anon_seq" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_agent_sessions" ADD CONSTRAINT "telegram_agent_sessions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_agent_sessions" ADD CONSTRAINT "telegram_agent_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_templates_agency_idx" ON "message_templates" USING btree ("agency_id");
