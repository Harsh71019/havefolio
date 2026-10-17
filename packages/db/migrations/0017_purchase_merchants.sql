CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_host" text,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "merchant_owner_name_unique" UNIQUE("owner_id","normalized_name"),
	CONSTRAINT "merchant_display_name_check" CHECK (length("merchants"."display_name") between 1 and 120 and "merchants"."display_name" = btrim(regexp_replace(normalize("merchants"."display_name",NFKC), '[[:space:]]+', ' ', 'g')) and "merchants"."display_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "merchant_normalized_name_check" CHECK ("merchants"."normalized_name" = lower("merchants"."display_name")),
	CONSTRAINT "merchant_state_check" CHECK ("merchants"."state" in ('active','retired')),
	CONSTRAINT "merchant_host_check" CHECK ("merchants"."website_host" is null or (length("merchants"."website_host") between 1 and 253 and "merchants"."website_host" = lower("merchants"."website_host") and "merchants"."website_host" ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "purchase_url" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_owner_state_name_idx" ON "merchants" USING btree ("owner_id","state","normalized_name","id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "item_merchant_owner_fk" FOREIGN KEY ("merchant_id","owner_id") REFERENCES "merchants"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_owner_merchant_idx" ON "items" USING btree ("owner_id","merchant_id","id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "item_purchase_url_check" CHECK ("items"."purchase_url" is null or (length("items"."purchase_url") between 1 and 2048 and "items"."purchase_url" ~* '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$' and "items"."purchase_url" !~ '[[:cntrl:]]'));