CREATE TABLE "desire_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"desire_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"bought_event_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"photo_state" text DEFAULT 'not_requested' NOT NULL,
	"photo_attempt" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversion_owner_desire_unique" UNIQUE("owner_id","desire_id"),
	CONSTRAINT "conversion_owner_command_unique" UNIQUE("owner_id","command_id"),
	CONSTRAINT "conversion_item_unique" UNIQUE("item_id"),
	CONSTRAINT "conversion_hash_check" CHECK ("desire_conversions"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "conversion_photo_check" CHECK ("desire_conversions"."photo_state" in ('not_requested','pending','copied','unavailable') and "desire_conversions"."photo_attempt" between 0 and 5 and (("desire_conversions"."photo_state" = 'not_requested') = ("desire_conversions"."photo_attempt" = 0))),
	CONSTRAINT "conversion_times_check" CHECK (isfinite("desire_conversions"."created_at") and isfinite("desire_conversions"."updated_at") and "desire_conversions"."created_at" <= "desire_conversions"."updated_at")
);
--> statement-breakpoint
ALTER TABLE "desire_conversions" ADD CONSTRAINT "conversion_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_conversions" ADD CONSTRAINT "conversion_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_conversions" ADD CONSTRAINT "conversion_bought_event_owner_fk" FOREIGN KEY ("bought_event_id","desire_id","owner_id") REFERENCES "desire_review_events"("id","desire_id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversion_owner_created_idx" ON "desire_conversions" USING btree ("owner_id","created_at","id");--> statement-breakpoint
-- Owner context is transaction-local and set only after session authentication (PER-28 pattern).
ALTER TABLE desire_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversion_owner_policy ON desire_conversions
 USING (owner_id = nullif(current_setting('havefolio.owner_id',true),'')::uuid)
 WITH CHECK (owner_id = nullif(current_setting('havefolio.owner_id',true),'')::uuid);
--> statement-breakpoint
-- Final guard: a conversion may only be inserted for the desire's current, effective bought event.
-- Identity is immutable; only photo-copy progress may change. Rows disappear only when their
-- desire or item is deleted (privacy erasure), never through a review correction.
CREATE FUNCTION guard_desire_conversion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest desire_review_events%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM desires WHERE id=OLD.desire_id)
      OR NOT EXISTS (SELECT 1 FROM items WHERE id=OLD.item_id)
      OR NOT EXISTS (SELECT 1 FROM desire_review_events WHERE id=OLD.bought_event_id) THEN
     RETURN OLD;
   END IF;
   RAISE EXCEPTION 'CONVERSION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.desire_id IS DISTINCT FROM OLD.desire_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
      OR NEW.bought_event_id IS DISTINCT FROM OLD.bought_event_id
      OR NEW.command_id IS DISTINCT FROM OLD.command_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.photo_attempt < OLD.photo_attempt
      OR (OLD.photo_state IN ('copied','unavailable','not_requested') AND NEW.photo_state IS DISTINCT FROM OLD.photo_state) THEN
     RAISE EXCEPTION 'CONVERSION_IMMUTABLE' USING ERRCODE='23514';
   END IF;
   NEW.updated_at := now();
   RETURN NEW;
 END IF;
 PERFORM 1 FROM desires WHERE id=NEW.desire_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSION_DESIRE_OWNER' USING ERRCODE='23503'; END IF;
 SELECT * INTO latest FROM desire_review_events
   WHERE desire_id=NEW.desire_id AND owner_id=NEW.owner_id ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR latest.outcome <> 'bought' OR latest.id IS DISTINCT FROM NEW.bought_event_id THEN
   RAISE EXCEPTION 'CONVERSION_NOT_BOUGHT' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM items WHERE id=NEW.item_id AND owner_id=NEW.owner_id AND demo_dataset_id IS NULL) THEN
   RAISE EXCEPTION 'CONVERSION_ITEM_OWNER' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conversion_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_conversions
 FOR EACH ROW EXECUTE FUNCTION guard_desire_conversion();
