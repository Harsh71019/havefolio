CREATE TABLE "account_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"receipt_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "account_deletions_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "account_deletions_receipt_hash_unique" UNIQUE("receipt_hash"),
	CONSTRAINT "deletion_state_check" CHECK ("account_deletions"."state" in ('pending','retrying','awaiting_finality','completed')),
	CONSTRAINT "deletion_receipt_check" CHECK ("account_deletions"."receipt_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "deletion_completion_check" CHECK (("account_deletions"."state"='completed' and "account_deletions"."owner_id" is null and "account_deletions"."completed_at" is not null) or ("account_deletions"."state"<>'completed' and "account_deletions"."owner_id" is not null and "account_deletions"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "deletion_resources" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"deletion_id" uuid NOT NULL,
	"finality_established" boolean NOT NULL,
	"cleaned_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_resources" ADD CONSTRAINT "deletion_resources_attachment_id_media_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "media_attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_resources" ADD CONSTRAINT "deletion_resources_deletion_id_account_deletions_id_fk" FOREIGN KEY ("deletion_id") REFERENCES "account_deletions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_recovery_idx" ON "account_deletions" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "deletion_resource_request_idx" ON "deletion_resources" USING btree ("deletion_id","attachment_id");
--> statement-breakpoint
-- Serialise admission with writes, including requests authenticated before revocation.
CREATE FUNCTION privacy_owner_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting_at timestamptz; principal uuid;
BEGIN
 -- Media cleanup is monotonic and uses an independent transaction inside existing owner locks.
 IF TG_TABLE_NAME='media_attachments' AND TG_OP='UPDATE' THEN
   IF NEW.state IN ('deleting','deleted') THEN RETURN NEW; END IF;
 END IF;
 principal := CASE WHEN TG_OP='DELETE' THEN OLD.owner_id ELSE NEW.owner_id END;
 SELECT deletion_requested_at INTO deleting_at FROM users WHERE id=principal FOR SHARE;
 IF NOT FOUND THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'OWNER_UNAVAILABLE' USING ERRCODE='23503';
 END IF;
 IF deleting_at IS NOT NULL THEN
   IF TG_OP='DELETE' AND current_setting('havefolio.erasing_owner_id',true)=principal::text THEN RETURN OLD; END IF;
   -- The existing immutable media guard still validates exact ownership and variants.
   IF TG_TABLE_NAME='media_attachments' AND TG_OP='UPDATE' THEN
     IF NEW.state IN ('deleting','deleted') THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'ACCOUNT_DELETION_PENDING' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON subcategories FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON tags FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON item_tags FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON merchants FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON owner_onboarding FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON demo_datasets FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON owner_settings FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON item_refunds FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON item_suggestions FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON item_warranties FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desires FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_reminders FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON media_attachments FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_review_events FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_item_matches FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_conversions FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON goals FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON goal_contributions FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_goal_allocations FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_privacy_write_guard BEFORE INSERT OR UPDATE OR DELETE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION privacy_owner_write_guard();
--> statement-breakpoint
-- Newly established finality always requires a fresh successful destroy after that evidence.
-- A pre-evidence not-found/cleanup result cannot authorise metadata erasure.
CREATE FUNCTION privacy_finality_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.finality_established AND NOT OLD.finality_established THEN NEW.cleaned_at := NULL; END IF;
 IF NEW.attachment_id<>OLD.attachment_id OR NEW.deletion_id<>OLD.deletion_id THEN
   RAISE EXCEPTION 'DELETION_RESOURCE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER privacy_finality_guard BEFORE UPDATE ON deletion_resources FOR EACH ROW EXECUTE FUNCTION privacy_finality_guard();
