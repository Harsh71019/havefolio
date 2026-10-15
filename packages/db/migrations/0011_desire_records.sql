CREATE TABLE "desires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"classification" text,
	"likely_price_minor" bigint,
	"currency" text,
	"product_url" text,
	"reason" text,
	"status" text DEFAULT 'considering' NOT NULL,
	"waiting_started_at" timestamp (3) with time zone,
	"review_at" timestamp (3) with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desire_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "desire_name_check" CHECK (length(btrim("desires"."name")) between 1 and 300 and "desires"."name" = btrim("desires"."name")),
	CONSTRAINT "desire_classification_check" CHECK ("desires"."classification" is null or "desires"."classification" in ('need','want','greed')),
	CONSTRAINT "desire_likely_price_check" CHECK (("desires"."likely_price_minor" is null and "desires"."currency" is null) or ("desires"."likely_price_minor" is not null and "desires"."currency" is not null and "desires"."likely_price_minor" >= 0 and "desires"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "desire_product_url_check" CHECK ("desires"."product_url" is null or (length("desires"."product_url") between 1 and 2048 and "desires"."product_url" ~ '^https?://')),
	CONSTRAINT "desire_reason_check" CHECK ("desires"."reason" is null or (length(btrim("desires"."reason")) between 1 and 2000 and "desires"."reason" = btrim("desires"."reason"))),
	CONSTRAINT "desire_waiting_check" CHECK (("desires"."status" = 'considering' and "desires"."waiting_started_at" is null and "desires"."review_at" is null) or ("desires"."status" = 'waiting' and "desires"."waiting_started_at" is not null and "desires"."review_at" is not null and isfinite("desires"."waiting_started_at") and isfinite("desires"."review_at") and "desires"."review_at" > "desires"."waiting_started_at")),
	CONSTRAINT "desire_revision_check" CHECK ("desires"."revision" >= 1),
	CONSTRAINT "desire_times_check" CHECK (isfinite("desires"."created_at") and isfinite("desires"."updated_at") and "desires"."created_at" <= "desires"."updated_at")
);
--> statement-breakpoint
ALTER TABLE "media_attachments" ADD COLUMN "desire_id" uuid;--> statement-breakpoint
ALTER TABLE "desires" ADD CONSTRAINT "desires_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desire_owner_created_idx" ON "desires" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "desire_owner_updated_idx" ON "desires" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "desire_owner_status_idx" ON "desires" USING btree ("owner_id","status","id");--> statement-breakpoint
CREATE INDEX "desire_owner_review_idx" ON "desires" USING btree ("owner_id","review_at","id") WHERE "desires"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "desire_owner_classification_idx" ON "desires" USING btree ("owner_id","classification","id");--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_desire_owner_idx" ON "media_attachments" USING btree ("desire_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_desire_single_photo_unique" ON "media_attachments" USING btree ("owner_id","desire_id") WHERE "media_attachments"."desire_id" is not null and "media_attachments"."variant" = 'original' and "media_attachments"."kind" = 'photo' and "media_attachments"."state" <> 'deleted';--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_target_exclusivity_check" CHECK ("media_attachments"."item_id" is null or "media_attachments"."desire_id" is null);--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_desire_kind_check" CHECK ("media_attachments"."desire_id" is null or "media_attachments"."kind" = 'photo');--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_item uuid; parent_desire uuid; parent_kind text; parent_variant text; inconsistent_children boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'deleted' THEN
      RAISE EXCEPTION 'Provider cleanup must finish before metadata deletion' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  -- Confirmed-deleted metadata may detach for item or desire erasure, retaining exact provider keys.
  -- Other fields remain immutable and detached tombstones cannot be rebound.
  IF TG_OP = 'UPDATE' AND OLD.state = 'deleted' AND NEW.state = 'deleted'
     AND ((OLD.item_id IS NOT NULL AND NEW.item_id IS NULL) OR (OLD.desire_id IS NOT NULL AND NEW.desire_id IS NULL))
     AND NEW.owner_id = OLD.owner_id AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.variant = OLD.variant AND NEW.kind = OLD.kind
     AND NEW.object_key = OLD.object_key AND NEW.resource_type = OLD.resource_type THEN
    IF NEW.parent_id IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.media_attachments WHERE id = $1 AND owner_id = $2 AND state <> ''deleted'')', TG_TABLE_SCHEMA)
        INTO inconsistent_children USING NEW.parent_id, NEW.owner_id;
    ELSE
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.media_attachments WHERE parent_id = $1 AND owner_id = $2 AND state <> ''deleted'')', TG_TABLE_SCHEMA)
        INTO inconsistent_children USING NEW.id, NEW.owner_id;
    END IF;
    IF inconsistent_children THEN
      RAISE EXCEPTION 'All variants must be confirmed deleted before detachment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'deleted' AND (NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.desire_id IS DISTINCT FROM OLD.desire_id) THEN
    RAISE EXCEPTION 'Deleted metadata cannot be revived or rebound' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.variant IS DISTINCT FROM OLD.variant OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR (OLD.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM OLD.item_id) OR (OLD.desire_id IS NOT NULL AND NEW.desire_id IS DISTINCT FROM OLD.desire_id)) THEN
    RAISE EXCEPTION 'Attachment ownership and assigned target are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    EXECUTE format('SELECT item_id, desire_id, kind, variant FROM %I.media_attachments WHERE id = $1 AND owner_id = $2 FOR SHARE', TG_TABLE_SCHEMA)
      INTO parent_item, parent_desire, parent_kind, parent_variant USING NEW.parent_id, NEW.owner_id;
    IF NEW.parent_id = NEW.id OR (parent_kind IS NOT NULL AND (parent_variant <> 'original' OR NEW.item_id IS DISTINCT FROM parent_item OR NEW.desire_id IS DISTINCT FROM parent_desire OR NEW.kind IS DISTINCT FROM parent_kind)) THEN
      RAISE EXCEPTION 'Variant purpose and target must match original' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.desire_id IS DISTINCT FROM OLD.desire_id OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.media_attachments WHERE parent_id = $1 AND (item_id IS DISTINCT FROM $2 OR desire_id IS DISTINCT FROM $3 OR kind IS DISTINCT FROM $4))', TG_TABLE_SCHEMA)
      INTO inconsistent_children USING OLD.id, NEW.item_id, NEW.desire_id, NEW.kind;
    IF inconsistent_children THEN
      RAISE EXCEPTION 'Original must retain variant target and purpose' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;