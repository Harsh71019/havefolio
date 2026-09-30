CREATE TABLE "media_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"variant" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'cloudinary' NOT NULL,
	"object_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"format" text NOT NULL,
	"provider_asset_id" text,
	"provider_version" bigint,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_owner_identity_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "media_provider_check" CHECK ("media_attachments"."provider" = 'cloudinary'),
	CONSTRAINT "media_state_check" CHECK ("media_attachments"."state" in ('pending','ready','deleting','deleted')),
	CONSTRAINT "media_kind_check" CHECK ("media_attachments"."kind" in ('photo','receipt','warranty')),
	CONSTRAINT "media_variant_check" CHECK (("media_attachments"."variant" = 'original' and "media_attachments"."parent_id" is null) or ("media_attachments"."variant" in ('display','thumbnail') and "media_attachments"."parent_id" is not null)),
	CONSTRAINT "media_size_check" CHECK ("media_attachments"."byte_size" > 0 and "media_attachments"."byte_size" <= 20971520),
	CONSTRAINT "media_checksum_check" CHECK ("media_attachments"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "media_ready_check" CHECK ("media_attachments"."state" <> 'ready' or ("media_attachments"."provider_asset_id" is not null and "media_attachments"."provider_version" is not null and "media_attachments"."provider_version" > 0)),
	CONSTRAINT "media_dimensions_check" CHECK (("media_attachments"."width" is null and "media_attachments"."height" is null) or ("media_attachments"."width" is not null and "media_attachments"."height" is not null and "media_attachments"."width" > 0 and "media_attachments"."height" > 0 and "media_attachments"."width" <= 8192 and "media_attachments"."height" <= 8192 and "media_attachments"."width"::bigint * "media_attachments"."height" <= 24000000)),
	CONSTRAINT "media_type_check" CHECK (("media_attachments"."resource_type" = 'raw' and "media_attachments"."format" = 'pdf' and "media_attachments"."mime_type" = 'application/pdf' and "media_attachments"."kind" <> 'photo') or ("media_attachments"."resource_type" = 'image' and "media_attachments"."byte_size" <= 10485760 and (("media_attachments"."format" = 'jpg' and "media_attachments"."mime_type" = 'image/jpeg') or ("media_attachments"."format" = 'png' and "media_attachments"."mime_type" = 'image/png') or ("media_attachments"."format" = 'webp' and "media_attachments"."mime_type" = 'image/webp'))))
);
--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_parent_owner_fk" FOREIGN KEY ("parent_id","owner_id") REFERENCES "media_attachments"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_object_key_unique" ON "media_attachments" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_provider_asset_unique" ON "media_attachments" USING btree ("provider_asset_id");--> statement-breakpoint
CREATE INDEX "media_owner_created_idx" ON "media_attachments" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_recovery_idx" ON "media_attachments" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "media_parent_idx" ON "media_attachments" USING btree ("parent_id");