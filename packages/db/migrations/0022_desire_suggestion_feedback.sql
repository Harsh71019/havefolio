CREATE TABLE "desire_suggestion_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"desire_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"feedback_type" text NOT NULL,
	"scope" text DEFAULT 'desire' NOT NULL,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desire_suggestion_feedback_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "desire_suggestion_feedback_type_check" CHECK ("desire_suggestion_feedback"."feedback_type" in ('dismissed','irrelevant','relevant')),
	CONSTRAINT "desire_suggestion_feedback_scope_check" CHECK ("desire_suggestion_feedback"."scope" in ('desire','global')),
	CONSTRAINT "desire_suggestion_feedback_reason_check" CHECK ("desire_suggestion_feedback"."reason" is null or (length(btrim("desire_suggestion_feedback"."reason")) between 1 and 500 and "desire_suggestion_feedback"."reason" = btrim("desire_suggestion_feedback"."reason"))),
	CONSTRAINT "desire_suggestion_feedback_times_check" CHECK (isfinite("desire_suggestion_feedback"."created_at") and isfinite("desire_suggestion_feedback"."updated_at") and "desire_suggestion_feedback"."created_at" <= "desire_suggestion_feedback"."updated_at")
);
--> statement-breakpoint
ALTER TABLE "desire_suggestion_feedback" ADD CONSTRAINT "desire_suggestion_feedback_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_suggestion_feedback" ADD CONSTRAINT "desire_suggestion_feedback_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "public"."desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_suggestion_feedback" ADD CONSTRAINT "desire_suggestion_feedback_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "public"."items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desire_suggestion_feedback_desire_item_unique" ON "desire_suggestion_feedback" USING btree ("owner_id","desire_id","item_id");--> statement-breakpoint
CREATE INDEX "desire_suggestion_feedback_owner_desire_idx" ON "desire_suggestion_feedback" USING btree ("owner_id","desire_id","created_at","id");--> statement-breakpoint
CREATE INDEX "desire_suggestion_feedback_owner_item_idx" ON "desire_suggestion_feedback" USING btree ("owner_id","item_id","created_at","id");