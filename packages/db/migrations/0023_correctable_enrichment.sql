CREATE TABLE "enrichment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"candidate_id" text NOT NULL,
	"field" text NOT NULL,
	"decision" text NOT NULL,
	"value" text,
	"previous_value" text,
	"confirmed_value" text,
	"revision" integer NOT NULL,
	"resulting_revision" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_review_command_unique" UNIQUE("owner_id","command_id"),
	CONSTRAINT "enrichment_review_field_check" CHECK ("enrichment_reviews"."field" in ('name','brand','model','description')),
	CONSTRAINT "enrichment_review_decision_check" CHECK ("enrichment_reviews"."decision" in ('accept','reject','correct') and (("enrichment_reviews"."decision"='correct' and "enrichment_reviews"."value" is not null) or ("enrichment_reviews"."decision"<>'correct' and "enrichment_reviews"."value" is null))),
	CONSTRAINT "enrichment_review_bounds_check" CHECK ("enrichment_reviews"."revision">0 and "enrichment_reviews"."resulting_revision"="enrichment_reviews"."revision"+1 and "enrichment_reviews"."request_hash" ~ '^[a-f0-9]{64}$' and length("enrichment_reviews"."candidate_id") between 1 and 80 and ("enrichment_reviews"."value" is null or length("enrichment_reviews"."value") between 1 and 5000))
);
--> statement-breakpoint
CREATE TABLE "enrichment_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"base_revision" integer NOT NULL,
	"input" jsonb NOT NULL,
	"confirmed_snapshot" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp (3) with time zone,
	"failure_code" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_owner_command_unique" UNIQUE("owner_id","command_id"),
	CONSTRAINT "enrichment_work_identity_unique" UNIQUE("id","owner_id","item_id"),
	CONSTRAINT "enrichment_state_check" CHECK ("enrichment_work"."state" in ('pending','processing','retry','succeeded','failed','unconfigured','stale')),
	CONSTRAINT "enrichment_bounds_check" CHECK ("enrichment_work"."base_revision">0 and "enrichment_work"."attempts" between 0 and 3 and "enrichment_work"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "enrichment_payload_check" CHECK (jsonb_typeof("enrichment_work"."input")='object' and octet_length("enrichment_work"."input"::text)<=16384 and jsonb_typeof("enrichment_work"."confirmed_snapshot")='object' and octet_length("enrichment_work"."confirmed_snapshot"::text)<=32768 and jsonb_typeof("enrichment_work"."candidates")='array' and jsonb_array_length("enrichment_work"."candidates")<=5 and octet_length("enrichment_work"."candidates"::text)<=40000),
	CONSTRAINT "enrichment_lease_check" CHECK (("enrichment_work"."state"='processing' and "enrichment_work"."lease_token" is not null and "enrichment_work"."lease_until" is not null) or ("enrichment_work"."state"<>'processing' and "enrichment_work"."lease_token" is null and "enrichment_work"."lease_until" is null)),
	CONSTRAINT "enrichment_failure_check" CHECK ("enrichment_work"."failure_code" is null or "enrichment_work"."failure_code" in ('PROVIDER_UNCONFIGURED','PROVIDER_FAILED'))
);
--> statement-breakpoint
ALTER TABLE "enrichment_reviews" ADD CONSTRAINT "enrichment_reviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_reviews" ADD CONSTRAINT "enrichment_review_work_fk" FOREIGN KEY ("work_id","owner_id","item_id") REFERENCES "enrichment_work"("id","owner_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_work" ADD CONSTRAINT "enrichment_work_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_work" ADD CONSTRAINT "enrichment_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_review_owner_item_idx" ON "enrichment_reviews" USING btree ("owner_id","item_id","id");--> statement-breakpoint
CREATE INDEX "enrichment_due_idx" ON "enrichment_work" USING btree ("state","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "enrichment_owner_item_idx" ON "enrichment_work" USING btree ("owner_id","item_id","id");
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON enrichment_work FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON enrichment_reviews FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE FUNCTION guard_enrichment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM items WHERE id=OLD.item_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'ENRICHMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='enrichment_reviews' THEN
   RAISE EXCEPTION 'ENRICHMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF (NEW.id,NEW.owner_id,NEW.item_id,NEW.command_id,NEW.request_hash,NEW.base_revision,NEW.input,NEW.confirmed_snapshot,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.item_id,OLD.command_id,OLD.request_hash,OLD.base_revision,OLD.input,OLD.confirmed_snapshot,OLD.created_at)
   OR (OLD.state IN ('succeeded','failed','unconfigured','stale') AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'ENRICHMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_history_guard BEFORE UPDATE OR DELETE ON enrichment_work FOR EACH ROW EXECUTE FUNCTION guard_enrichment_history();
--> statement-breakpoint
CREATE TRIGGER enrichment_history_guard BEFORE UPDATE OR DELETE ON enrichment_reviews FOR EACH ROW EXECUTE FUNCTION guard_enrichment_history();
