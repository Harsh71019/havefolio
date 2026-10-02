CREATE TABLE "item_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"refund_date_precision" text DEFAULT 'unknown' NOT NULL,
	"refund_year" smallint,
	"refund_month" smallint,
	"refund_day" smallint,
	"note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount_check" CHECK ("item_refunds"."amount_minor" > 0),
	CONSTRAINT "refund_date_precision_check" CHECK (
    ("item_refunds"."refund_date_precision" = 'unknown' and "item_refunds"."refund_year" is null and "item_refunds"."refund_month" is null and "item_refunds"."refund_day" is null) or
    ("item_refunds"."refund_date_precision" = 'year' and "item_refunds"."refund_year" is not null and "item_refunds"."refund_year" between 1 and 9999 and "item_refunds"."refund_month" is null and "item_refunds"."refund_day" is null) or
    ("item_refunds"."refund_date_precision" = 'month' and "item_refunds"."refund_year" is not null and "item_refunds"."refund_year" between 1 and 9999 and "item_refunds"."refund_month" is not null and "item_refunds"."refund_month" between 1 and 12 and "item_refunds"."refund_day" is null) or
    ("item_refunds"."refund_date_precision" = 'exact' and "item_refunds"."refund_year" is not null and "item_refunds"."refund_year" between 1 and 9999 and "item_refunds"."refund_month" is not null and "item_refunds"."refund_month" between 1 and 12 and "item_refunds"."refund_day" is not null and "item_refunds"."refund_day" between 1 and
      case when "item_refunds"."refund_month" = 2 then case when "item_refunds"."refund_year" % 400 = 0 or ("item_refunds"."refund_year" % 4 = 0 and "item_refunds"."refund_year" % 100 <> 0) then 29 else 28 end
      when "item_refunds"."refund_month" in (4,6,9,11) then 30 else 31 end)),
	CONSTRAINT "refund_note_check" CHECK ("item_refunds"."note" is null or (char_length("item_refunds"."note") between 1 and 1000 and "item_refunds"."note" = btrim("item_refunds"."note")))
);
--> statement-breakpoint
ALTER TABLE "lifecycle_events" DROP CONSTRAINT "event_type_check";--> statement-breakpoint
ALTER TABLE "item_refunds" ADD CONSTRAINT "item_refunds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The composite unique key must exist before the refund foreign key can reference it.
ALTER TABLE "items" ADD CONSTRAINT "item_owner_currency_identity_unique" UNIQUE("id","owner_id","currency");--> statement-breakpoint
ALTER TABLE "item_refunds" ADD CONSTRAINT "refund_item_owner_currency_fk" FOREIGN KEY ("item_id","owner_id","currency") REFERENCES "items"("id","owner_id","currency") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "refund_item_owner_currency_idx" ON "item_refunds" USING btree ("item_id","owner_id","currency");--> statement-breakpoint
CREATE INDEX "refund_owner_item_created_idx" ON "item_refunds" USING btree ("owner_id","item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "refund_owner_currency_idx" ON "item_refunds" USING btree ("owner_id","currency","item_id");--> statement-breakpoint
CREATE INDEX "item_owner_purchase_date_idx" ON "items" USING btree ("owner_id","purchase_year","purchase_month","purchase_day","id");--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "event_type_check" CHECK ("lifecycle_events"."event_type" in ('created','details_updated','ownership_changed','condition_changed','usage_changed','used','repaired','refund_recorded','refund_corrected','refund_deleted','correction'));--> statement-breakpoint
-- Drizzle does not model triggers; forward SQL adds database-enforced refund invariants.
CREATE TRIGGER item_refunds_touch BEFORE UPDATE ON item_refunds FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE FUNCTION inventory_refund_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'Refund owner and item are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_identity_guard BEFORE UPDATE ON item_refunds FOR EACH ROW EXECUTE FUNCTION inventory_refund_identity_guard();
--> statement-breakpoint
-- Confirmed refunds never exceed the recorded amount paid, and require one. The item row lock
-- serializes concurrent writers that bypass the application's owner lock.
CREATE FUNCTION inventory_refund_total_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_item uuid; target_owner uuid; paid bigint; refunded numeric;
BEGIN
  IF TG_TABLE_NAME = 'items' THEN
    target_item := NEW.id;
  ELSE
    target_item := NEW.item_id;
  END IF;
  target_owner := NEW.owner_id;
  EXECUTE format('SELECT price_paid_minor FROM %I.items WHERE id = $1 AND owner_id = $2 FOR UPDATE', TG_TABLE_SCHEMA)
    INTO paid USING target_item, target_owner;
  EXECUTE format('SELECT coalesce(sum(amount_minor), 0) FROM %I.item_refunds WHERE item_id = $1 AND owner_id = $2', TG_TABLE_SCHEMA)
    INTO refunded USING target_item, target_owner;
  IF refunded > 0 AND (paid IS NULL OR refunded > paid) THEN
    RAISE EXCEPTION 'Confirmed refunds cannot exceed the recorded amount paid' USING ERRCODE = '23514', CONSTRAINT = 'refund_total_check';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_total_guard AFTER INSERT OR UPDATE ON item_refunds FOR EACH ROW EXECUTE FUNCTION inventory_refund_total_guard();
--> statement-breakpoint
CREATE TRIGGER item_refund_total_guard AFTER UPDATE OF price_paid_minor ON items FOR EACH ROW WHEN (NEW.price_paid_minor IS DISTINCT FROM OLD.price_paid_minor) EXECUTE FUNCTION inventory_refund_total_guard();
