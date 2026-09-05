-- Idempotente di proposito (IF NOT EXISTS): durante lo sviluppo del 5 settembre 2026
-- questa migrazione è stata applicata dal vivo come «0003_mfa_totp» prima che il merge
-- con la board-cloud-share la rinumerasse a 0004 con un timestamp più alto. Il
-- migrator di drizzle riapplica per timestamp, non per hash, quindi su quel DB
-- rigirerebbe questo file: senza le guardie, `ADD COLUMN` fallirebbe su colonne che
-- già esistono e il container andrebbe in crash-loop. Con le guardie, un DB nuovo la
-- applica intera e uno che l'ha già vista non fa nulla.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
