CREATE TABLE "demo_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"version" text NOT NULL,
	CONSTRAINT "demo_dataset_owner_unique" UNIQUE("owner_id"),
	CONSTRAINT "demo_dataset_identity_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "demo_dataset_version_check" CHECK ("demo_datasets"."version" = 'indian-household-v1')
);
--> statement-breakpoint
CREATE TABLE "owner_onboarding" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'not_started' NOT NULL,
	"browsed_store" boolean DEFAULT false NOT NULL,
	"reviewed_item" boolean DEFAULT false NOT NULL,
	"tried_demo" boolean DEFAULT false NOT NULL,
	"removed_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "onboarding_state_check" CHECK ("owner_onboarding"."state" in ('not_started','active','skipped','completed'))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "demo_dataset_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_datasets" ADD CONSTRAINT "demo_datasets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_onboarding" ADD CONSTRAINT "owner_onboarding_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "item_demo_dataset_owner_fk" FOREIGN KEY ("demo_dataset_id","owner_id") REFERENCES "demo_datasets"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_owner_demo_dataset_idx" ON "items" USING btree ("owner_id","demo_dataset_id");