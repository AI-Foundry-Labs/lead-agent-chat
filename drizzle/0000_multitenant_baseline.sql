CREATE TABLE "admin_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(500),
	"ip" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255),
	"telegram_user_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"primary_host" varchar(255),
	"telegram_group_chat_id" varchar(50),
	"telegram_topics_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agencies_primary_host_unique" UNIQUE("primary_host"),
	CONSTRAINT "agencies_telegram_group_chat_id_unique" UNIQUE("telegram_group_chat_id")
);
--> statement-breakpoint
CREATE TABLE "agency_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"tone" text NOT NULL,
	"qualification_criteria" jsonb NOT NULL,
	"calendar_id" varchar(255) NOT NULL,
	CONSTRAINT "agency_config_agency_id_unique" UNIQUE("agency_id")
);
--> statement-breakpoint
CREATE TABLE "agency_telegram_link_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"lead_id" uuid,
	"admin_id" uuid,
	"listing_id" varchar(50),
	"primary_channel" varchar(10) DEFAULT 'web' NOT NULL,
	"mode" varchar(10) DEFAULT 'agent' NOT NULL,
	"thread_summary" text,
	"summarized_turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"description" text NOT NULL,
	"trigger_keywords" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_magic_links" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(500),
	"ip" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "lead_telegram_link_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid,
	"listing_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_telegram_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"group_chat_id" varchar(50) NOT NULL,
	"conversation_topic_id" integer NOT NULL,
	"assistant_topic_id" integer NOT NULL,
	"lead_conversation_id" uuid,
	"operator_conversation_id" uuid,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_telegram_topics_group_lead_unique" UNIQUE("group_chat_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"channel" varchar(10) DEFAULT 'web' NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"listing_id" varchar(50),
	"language" varchar(5) DEFAULT 'fr' NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"qual_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"potential_status" varchar(10),
	"score_reason" text,
	"long_term_memory" text,
	"telegram_user_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"title_en" varchar(255) NOT NULL,
	"address" varchar(500) NOT NULL,
	"price" integer NOT NULL,
	"surface_m2" integer NOT NULL,
	"rooms" integer NOT NULL,
	"floor" varchar(255) NOT NULL,
	"floor_en" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"description_en" text NOT NULL,
	"key_features" jsonb NOT NULL,
	"key_features_en" jsonb NOT NULL,
	"image_url" varchar(1000),
	"agent_name" varchar(255) NOT NULL,
	"agent_email" varchar(255) NOT NULL,
	"agent_calendar_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(12) NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"is_draft" boolean DEFAULT false NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "viewing_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid,
	"listing_id" varchar(50) NOT NULL,
	"contact_email" varchar(255),
	"proposed_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_slot" timestamp with time zone,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"calendar_event_id" varchar(255),
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_config" ADD CONSTRAINT "agency_config_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_telegram_link_tokens" ADD CONSTRAINT "agency_telegram_link_tokens_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_rules" ADD CONSTRAINT "handoff_rules_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_magic_links" ADD CONSTRAINT "lead_magic_links_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sessions" ADD CONSTRAINT "lead_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_link_tokens" ADD CONSTRAINT "lead_telegram_link_tokens_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_link_tokens" ADD CONSTRAINT "lead_telegram_link_tokens_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_topics" ADD CONSTRAINT "lead_telegram_topics_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_topics" ADD CONSTRAINT "lead_telegram_topics_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_topics" ADD CONSTRAINT "lead_telegram_topics_lead_conversation_id_conversations_id_fk" FOREIGN KEY ("lead_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telegram_topics" ADD CONSTRAINT "lead_telegram_topics_operator_conversation_id_conversations_id_fk" FOREIGN KEY ("operator_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_slots" ADD CONSTRAINT "viewing_slots_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_slots" ADD CONSTRAINT "viewing_slots_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "admins_agency_idx" ON "admins" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "agency_telegram_link_tokens_agency_idx" ON "agency_telegram_link_tokens" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "agency_telegram_link_tokens_expires_idx" ON "agency_telegram_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "conversations_admin_idx" ON "conversations" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "conversations_updated_idx" ON "conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "conversations_agency_idx" ON "conversations" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "handoff_rules_agency_idx" ON "handoff_rules" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "lead_magic_links_lead_idx" ON "lead_magic_links" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_magic_links_expires_idx" ON "lead_magic_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lead_sessions_lead_idx" ON "lead_sessions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_sessions_expires_idx" ON "lead_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lead_telegram_link_tokens_conv_idx" ON "lead_telegram_link_tokens" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "lead_telegram_link_tokens_expires_idx" ON "lead_telegram_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lead_telegram_topics_conv_topic_idx" ON "lead_telegram_topics" USING btree ("group_chat_id","conversation_topic_id");--> statement-breakpoint
CREATE INDEX "lead_telegram_topics_asst_topic_idx" ON "lead_telegram_topics" USING btree ("group_chat_id","assistant_topic_id");--> statement-breakpoint
CREATE INDEX "lead_telegram_topics_agency_idx" ON "lead_telegram_topics" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "leads_agency_idx" ON "leads" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "listings_agency_idx" ON "listings" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_admin_idx" ON "telegram_link_tokens" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_expires_idx" ON "telegram_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "viewing_slots_agency_idx" ON "viewing_slots" USING btree ("agency_id");