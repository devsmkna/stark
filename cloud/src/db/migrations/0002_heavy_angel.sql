CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"machine_key" text NOT NULL,
	"label" text NOT NULL,
	"platform" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_user_key" UNIQUE("user_id","machine_key")
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"user_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"day" date NOT NULL,
	"project_key" text NOT NULL,
	"project_label" text,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"prompts" integer DEFAULT 0 NOT NULL,
	"chars" bigint DEFAULT 0 NOT NULL,
	"agent_ms" bigint DEFAULT 0 NOT NULL,
	"tools" integer DEFAULT 0 NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"commands" integer DEFAULT 0 NOT NULL,
	"aborted" integer DEFAULT 0 NOT NULL,
	"errored" integer DEFAULT 0 NOT NULL,
	"interrupted" integer DEFAULT 0 NOT NULL,
	"tok_in" bigint DEFAULT 0 NOT NULL,
	"tok_out" bigint DEFAULT 0 NOT NULL,
	"tok_cache_read" bigint DEFAULT 0 NOT NULL,
	"tok_cache_write" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_user_id_machine_id_day_project_key_agent_model_pk" PRIMARY KEY("user_id","machine_id","day","project_key","agent","model")
);
--> statement-breakpoint
CREATE TABLE "usage_session_days" (
	"user_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"day" date NOT NULL,
	"session_id" text NOT NULL,
	"project_key" text NOT NULL,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	CONSTRAINT "usage_session_days_user_id_machine_id_day_session_id_pk" PRIMARY KEY("user_id","machine_id","day","session_id")
);
--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_session_days" ADD CONSTRAINT "usage_session_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_session_days" ADD CONSTRAINT "usage_session_days_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;