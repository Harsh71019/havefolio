CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "category_name_check" CHECK (length(btrim("categories"."name")) between 1 and 120),
	CONSTRAINT "category_position_check" CHECK ("categories"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"suggested_values" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_provider_check" CHECK (length(btrim("item_suggestions"."provider")) between 1 and 120),
	CONSTRAINT "suggestion_values_check" CHECK (jsonb_typeof("item_suggestions"."suggested_values") = 'object'),
	CONSTRAINT "suggestion_status_check" CHECK (("item_suggestions"."status" = 'pending' and "item_suggestions"."decided_at" is null) or ("item_suggestions"."status" in ('accepted','rejected') and "item_suggestions"."decided_at" is not null and isfinite("item_suggestions"."decided_at")))
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "item_warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"provider" text,
	"starts_on" date,
	"expires_on" date,
	"terms" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_dates_check" CHECK (("item_warranties"."starts_on" is null or isfinite("item_warranties"."starts_on")) and ("item_warranties"."expires_on" is null or isfinite("item_warranties"."expires_on")) and ("item_warranties"."starts_on" is null or "item_warranties"."expires_on" is null or "item_warranties"."expires_on" >= "item_warranties"."starts_on"))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"subcategory_id" uuid,
	"brand" text,
	"model" text,
	"description" text,
	"specifications" jsonb,
	"notes" text,
	"price_paid_minor" bigint,
	"currency" text NOT NULL,
	"purchase_date_precision" text DEFAULT 'unknown' NOT NULL,
	"purchase_year" smallint,
	"purchase_month" smallint,
	"purchase_day" smallint,
	"acquisition_type" text DEFAULT 'unknown' NOT NULL,
	"condition" text DEFAULT 'unknown' NOT NULL,
	"use_frequency" text DEFAULT 'unknown' NOT NULL,
	"ownership_status" text DEFAULT 'owned' NOT NULL,
	"original_entry" jsonb NOT NULL,
	"original_source" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "item_name_check" CHECK (length(btrim("items"."name")) between 1 and 300),
	CONSTRAINT "item_subcategory_requires_category" CHECK ("items"."subcategory_id" is null or "items"."category_id" is not null),
	CONSTRAINT "item_price_check" CHECK ("items"."price_paid_minor" is null or "items"."price_paid_minor" >= 0),
	CONSTRAINT "item_currency_check" CHECK ("items"."currency" in ('ADP', 'AED', 'AFA', 'AFN', 'ALK', 'ALL', 'AMD', 'ANG', 'AOA', 'AOK', 'AON', 'AOR', 'ARA', 'ARP', 'ARS', 'ARY', 'ATS', 'AUD', 'AWG', 'AYM', 'AZM', 'AZN', 'BAD', 'BAM', 'BBD', 'BDT', 'BEC', 'BEF', 'BEL', 'BGJ', 'BGK', 'BGL', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOP', 'BOV', 'BRB', 'BRC', 'BRE', 'BRL', 'BRN', 'BRR', 'BSD', 'BTN', 'BUK', 'BWP', 'BYB', 'BYN', 'BYR', 'BZD', 'CAD', 'CDF', 'CHC', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CSD', 'CSJ', 'CSK', 'CUC', 'CUP', 'CVE', 'CYP', 'CZK', 'DDM', 'DEM', 'DJF', 'DKK', 'DOP', 'DZD', 'ECS', 'ECV', 'EEK', 'EGP', 'ERN', 'ESA', 'ESB', 'ESP', 'ETB', 'EUR', 'FIM', 'FJD', 'FKP', 'FRF', 'GBP', 'GEK', 'GEL', 'GHC', 'GHP', 'GHS', 'GIP', 'GMD', 'GNE', 'GNF', 'GNS', 'GQE', 'GRD', 'GTQ', 'GWE', 'GWP', 'GYD', 'HKD', 'HNL', 'HRD', 'HRK', 'HTG', 'HUF', 'IDR', 'IEP', 'ILP', 'ILR', 'ILS', 'INR', 'IQD', 'IRR', 'ISJ', 'ISK', 'ITL', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAJ', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LSM', 'LTL', 'LTT', 'LUC', 'LUF', 'LUL', 'LVL', 'LVR', 'LYD', 'MAD', 'MDL', 'MGA', 'MGF', 'MKD', 'MLF', 'MMK', 'MNT', 'MOP', 'MRO', 'MRU', 'MTL', 'MTP', 'MUR', 'MVQ', 'MVR', 'MWK', 'MXN', 'MXP', 'MXV', 'MYR', 'MZE', 'MZM', 'MZN', 'NAD', 'NGN', 'NIC', 'NIO', 'NLG', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEH', 'PEI', 'PEN', 'PES', 'PGK', 'PHP', 'PKR', 'PLN', 'PLZ', 'PTE', 'PYG', 'QAR', 'RHD', 'ROK', 'ROL', 'RON', 'RSD', 'RUB', 'RUR', 'RWF', 'SAR', 'SBD', 'SCR', 'SDD', 'SDG', 'SDP', 'SEK', 'SGD', 'SHP', 'SIT', 'SKK', 'SLE', 'SLL', 'SOS', 'SRD', 'SRG', 'SSP', 'STD', 'STN', 'SUR', 'SVC', 'SYP', 'SZL', 'THB', 'TJR', 'TJS', 'TMM', 'TMT', 'TND', 'TOP', 'TPE', 'TRL', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UAK', 'UGS', 'UGW', 'UGX', 'USD', 'USN', 'USS', 'UYI', 'UYN', 'UYP', 'UYU', 'UYW', 'UZS', 'VEB', 'VED', 'VEF', 'VES', 'VNC', 'VND', 'VUV', 'WST', 'XAD', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XEU', 'XFO', 'XFU', 'XOF', 'XPD', 'XPF', 'XPT', 'XRE', 'XSU', 'XUA', 'YDD', 'YER', 'YUD', 'YUM', 'YUN', 'ZAL', 'ZAR', 'ZMK', 'ZMW', 'ZRN', 'ZRZ', 'ZWC', 'ZWD', 'ZWG', 'ZWL', 'ZWN', 'ZWR')),
	CONSTRAINT "item_date_precision_check" CHECK (
    ("items"."purchase_date_precision" = 'unknown' and "items"."purchase_year" is null and "items"."purchase_month" is null and "items"."purchase_day" is null) or
    ("items"."purchase_date_precision" = 'year' and "items"."purchase_year" is not null and "items"."purchase_year" between 1 and 9999 and "items"."purchase_month" is null and "items"."purchase_day" is null) or
    ("items"."purchase_date_precision" = 'month' and "items"."purchase_year" is not null and "items"."purchase_year" between 1 and 9999 and "items"."purchase_month" is not null and "items"."purchase_month" between 1 and 12 and "items"."purchase_day" is null) or
    ("items"."purchase_date_precision" = 'exact' and "items"."purchase_year" is not null and "items"."purchase_year" between 1 and 9999 and "items"."purchase_month" is not null and "items"."purchase_month" between 1 and 12 and "items"."purchase_day" is not null and "items"."purchase_day" between 1 and
      case when "items"."purchase_month" = 2 then case when "items"."purchase_year" % 400 = 0 or ("items"."purchase_year" % 4 = 0 and "items"."purchase_year" % 100 <> 0) then 29 else 28 end
      when "items"."purchase_month" in (4,6,9,11) then 30 else 31 end)),
	CONSTRAINT "item_acquisition_check" CHECK ("items"."acquisition_type" in ('bought','gift','secondhand','other','unknown')),
	CONSTRAINT "item_condition_check" CHECK ("items"."condition" in ('working','needs_repair','broken','unknown')),
	CONSTRAINT "item_usage_check" CHECK ("items"."use_frequency" in ('often','sometimes','rarely','never','unknown')),
	CONSTRAINT "item_status_check" CHECK ("items"."ownership_status" in ('owned','sold','donated','disposed','lost','returned')),
	CONSTRAINT "item_original_entry_check" CHECK (jsonb_typeof("items"."original_entry") = 'object'),
	CONSTRAINT "item_specs_check" CHECK ("items"."specifications" is null or jsonb_typeof("items"."specifications") = 'object'),
	CONSTRAINT "item_original_source_check" CHECK ("items"."original_source" in ('manual','url','barcode','photo','receipt','import')),
	CONSTRAINT "item_revision_check" CHECK ("items"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_check" CHECK ("lifecycle_events"."event_type" in ('created','details_updated','ownership_changed','condition_changed','usage_changed','used','repaired','refund_recorded','correction')),
	CONSTRAINT "event_metadata_check" CHECK (jsonb_typeof("lifecycle_events"."metadata") = 'object'),
	CONSTRAINT "event_time_check" CHECK (isfinite("lifecycle_events"."occurred_at"))
);
--> statement-breakpoint
CREATE TABLE "subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcategory_category_owner_unique" UNIQUE("id","category_id","owner_id"),
	CONSTRAINT "subcategory_name_check" CHECK (length(btrim("subcategories"."name")) between 1 and 120),
	CONSTRAINT "subcategory_position_check" CHECK ("subcategories"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "tag_name_check" CHECK (length(btrim("tags"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_attachments" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "media_attachments" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_suggestions" ADD CONSTRAINT "item_suggestions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_suggestions" ADD CONSTRAINT "suggestion_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tag_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tag_tag_owner_fk" FOREIGN KEY ("tag_id","owner_id") REFERENCES "tags"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_warranties" ADD CONSTRAINT "item_warranties_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_warranties" ADD CONSTRAINT "warranty_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "item_category_owner_fk" FOREIGN KEY ("category_id","owner_id") REFERENCES "categories"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "item_subcategory_owner_fk" FOREIGN KEY ("subcategory_id","category_id","owner_id") REFERENCES "subcategories"("id","category_id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "event_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategory_category_owner_fk" FOREIGN KEY ("category_id","owner_id") REFERENCES "categories"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_owner_name_unique" ON "categories" USING btree ("owner_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "suggestion_item_owner_idx" ON "item_suggestions" USING btree ("item_id","owner_id");--> statement-breakpoint
CREATE INDEX "item_tag_owner_tag_idx" ON "item_tags" USING btree ("owner_id","tag_id","item_id");--> statement-breakpoint
CREATE INDEX "warranty_item_owner_idx" ON "item_warranties" USING btree ("item_id","owner_id");--> statement-breakpoint
CREATE INDEX "item_owner_created_idx" ON "items" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "item_owner_status_created_idx" ON "items" USING btree ("owner_id","ownership_status","created_at","id");--> statement-breakpoint
CREATE INDEX "item_owner_category_idx" ON "items" USING btree ("owner_id","category_id","subcategory_id");--> statement-breakpoint
CREATE INDEX "item_subcategory_owner_idx" ON "items" USING btree ("subcategory_id","category_id","owner_id");--> statement-breakpoint
CREATE INDEX "event_owner_item_time_idx" ON "lifecycle_events" USING btree ("owner_id","item_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "event_item_owner_idx" ON "lifecycle_events" USING btree ("item_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subcategory_owner_category_name_unique" ON "subcategories" USING btree ("owner_id","category_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "subcategory_category_owner_idx" ON "subcategories" USING btree ("category_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_owner_name_unique" ON "tags" USING btree ("owner_id",lower(btrim("name")));--> statement-breakpoint
-- Preserve PER-12 owner UUIDs as identity shells; authentication is supplied by PER-8.
INSERT INTO "users" ("id") SELECT DISTINCT "owner_id" FROM "media_attachments";
--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_item_owner_fk" FOREIGN KEY ("item_id","owner_id") REFERENCES "items"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_item_owner_idx" ON "media_attachments" USING btree ("item_id","owner_id");--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_position_check" CHECK ("media_attachments"."position" >= 0);--> statement-breakpoint
-- Drizzle does not model triggers; forward SQL adds database-enforced write guards.
CREATE FUNCTION inventory_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION inventory_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.original_entry IS DISTINCT FROM OLD.original_entry OR NEW.original_source IS DISTINCT FROM OLD.original_source THEN
    RAISE EXCEPTION 'Original input and item owner are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER item_original_guard BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION inventory_item_guard();
--> statement-breakpoint
CREATE FUNCTION inventory_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_exists boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Lifecycle events are append-only' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.items WHERE id = $1)', TG_TABLE_SCHEMA) INTO parent_exists USING OLD.item_id;
  IF parent_exists THEN
    RAISE EXCEPTION 'Delete the item for privacy erasure; do not delete individual events' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_append_only BEFORE UPDATE OR DELETE ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION inventory_event_guard();
--> statement-breakpoint
CREATE FUNCTION inventory_media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_item uuid; parent_kind text; parent_variant text; inconsistent_children boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'deleted' THEN
      RAISE EXCEPTION 'Provider cleanup must finish before metadata deletion' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.variant IS DISTINCT FROM OLD.variant OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR (OLD.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM OLD.item_id)) THEN
    RAISE EXCEPTION 'Attachment ownership and assigned item are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    EXECUTE format('SELECT item_id, kind, variant FROM %I.media_attachments WHERE id = $1 AND owner_id = $2 FOR SHARE', TG_TABLE_SCHEMA)
      INTO parent_item, parent_kind, parent_variant USING NEW.parent_id, NEW.owner_id;
    IF NEW.parent_id = NEW.id OR (parent_kind IS NOT NULL AND (parent_variant <> 'original' OR NEW.item_id IS DISTINCT FROM parent_item OR NEW.kind IS DISTINCT FROM parent_kind)) THEN
      RAISE EXCEPTION 'Variant purpose and item must match original' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.media_attachments WHERE parent_id = $1 AND (item_id IS DISTINCT FROM $2 OR kind IS DISTINCT FROM $3))', TG_TABLE_SCHEMA)
      INTO inconsistent_children USING OLD.id, NEW.item_id, NEW.kind;
    IF inconsistent_children THEN
      RAISE EXCEPTION 'Original must retain variant item and purpose' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON media_attachments FOR EACH ROW EXECUTE FUNCTION inventory_media_guard();
--> statement-breakpoint
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER categories_touch BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER subcategories_touch BEFORE UPDATE ON subcategories FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER items_touch BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER tags_touch BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER item_tags_touch BEFORE UPDATE ON item_tags FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER item_suggestions_touch BEFORE UPDATE ON item_suggestions FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER item_warranties_touch BEFORE UPDATE ON item_warranties FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();
--> statement-breakpoint
CREATE FUNCTION inventory_suggestion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.suggested_values IS DISTINCT FROM OLD.suggested_values THEN
    RAISE EXCEPTION 'Suggestion provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER suggestion_provenance_guard BEFORE UPDATE ON item_suggestions FOR EACH ROW EXECUTE FUNCTION inventory_suggestion_guard();
