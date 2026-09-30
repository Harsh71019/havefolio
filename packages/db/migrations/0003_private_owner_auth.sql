CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp (3) with time zone NOT NULL,
	"absolute_expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	CONSTRAINT "session_hash_check" CHECK ("auth_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "session_times_check" CHECK (isfinite("auth_sessions"."created_at") and isfinite("auth_sessions"."last_used_at") and isfinite("auth_sessions"."idle_expires_at") and isfinite("auth_sessions"."absolute_expires_at") and "auth_sessions"."created_at" <= "auth_sessions"."last_used_at" and "auth_sessions"."last_used_at" < "auth_sessions"."idle_expires_at" and "auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at" and ("auth_sessions"."revoked_at" is null or isfinite("auth_sessions"."revoked_at")))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_owner_created_idx" ON "auth_sessions" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "auth_sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_initial_owner_unique" ON "users" USING btree ((true)) WHERE "users"."email" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "user_credentials_check" CHECK (("users"."email" is null and "users"."password_hash" is null) or ("users"."email" is not null and "users"."password_hash" is not null and "users"."email" = lower(btrim("users"."email")) and length("users"."email") between 3 and 254 and "users"."password_hash" like '$argon2id$%'));