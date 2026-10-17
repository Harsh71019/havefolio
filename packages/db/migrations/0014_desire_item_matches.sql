CREATE TABLE "desire_item_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"desire_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"relevance" text DEFAULT 'relevant' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desire_item_match_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "desire_item_match_reason_check" CHECK (length(btrim("desire_item_matches"."reason")) between 1 and 1000 and "desire_item_matches"."reason" = btrim("desire_item_matches"."reason")),
	CONSTRAINT "desire_item_match_relevance_check" CHECK ("desire_item_matches"."relevance" in ('relevant','irrelevant')),
	CONSTRAINT "desire_item_match_source_check" CHECK ("desire_item_matches"."source" in ('manual','suggested')),
	CONSTRAINT "desire_item_match_times_check" CHECK (isfinite("desire_item_matches"."created_at") and isfinite("desire_item_matches"."updated_at") and "desire_item_matches"."created_at" <= "desire_item_matches"."updated_at")
);
--> statement-breakpoint
ALTER TABLE "desire_item_matches" ADD CONSTRAINT "desire_item_matches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_item_matches" ADD CONSTRAINT "desire_item_match_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_item_matches" ADD CONSTRAINT "desire_item_match_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desire_item_match_desire_item_unique" ON "desire_item_matches" USING btree ("owner_id","desire_id","item_id");--> statement-breakpoint
CREATE INDEX "desire_item_match_owner_desire_idx" ON "desire_item_matches" USING btree ("owner_id","desire_id","created_at","id");--> statement-breakpoint
CREATE INDEX "desire_item_match_owner_item_idx" ON "desire_item_matches" USING btree ("owner_id","item_id","created_at","id");