CREATE TABLE "desire_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desire_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"sequence" integer NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"note" text,
	"linked_item_id" uuid,
	"review_at" timestamp (3) with time zone,
	"supersedes_event_id" uuid,
	"estimated_not_spent_minor" bigint,
	"currency" text,
	CONSTRAINT "review_identity_unique" UNIQUE("id","desire_id","owner_id"),
	CONSTRAINT "review_command_unique" UNIQUE("owner_id","desire_id","command_id"),
	CONSTRAINT "review_sequence_unique" UNIQUE("desire_id","sequence"),
	CONSTRAINT "review_outcome_check" CHECK ("desire_review_events"."outcome" in ('bought','delayed','declined','used_owned')),
	CONSTRAINT "review_sequence_check" CHECK ("desire_review_events"."sequence" > 1),
	CONSTRAINT "review_hash_check" CHECK ("desire_review_events"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "review_note_check" CHECK ("desire_review_events"."note" is null or (length(btrim("desire_review_events"."note")) between 1 and 2000 and "desire_review_events"."note"=btrim("desire_review_events"."note"))),
	CONSTRAINT "review_date_check" CHECK (isfinite("desire_review_events"."occurred_at") and (("desire_review_events"."outcome"='delayed' and "desire_review_events"."review_at" is not null and isfinite("desire_review_events"."review_at") and "desire_review_events"."review_at">"desire_review_events"."occurred_at") or ("desire_review_events"."outcome"<>'delayed' and "desire_review_events"."review_at" is null))),
	CONSTRAINT "review_link_check" CHECK (("desire_review_events"."outcome"='used_owned' and "desire_review_events"."linked_item_id" is not null) or ("desire_review_events"."outcome"='bought') or ("desire_review_events"."outcome" in ('delayed','declined') and "desire_review_events"."linked_item_id" is null)),
	CONSTRAINT "review_estimate_check" CHECK (("desire_review_events"."estimated_not_spent_minor" is null and "desire_review_events"."currency" is null) or ("desire_review_events"."outcome"='declined' and "desire_review_events"."estimated_not_spent_minor" is not null and "desire_review_events"."estimated_not_spent_minor">=0 and "desire_review_events"."currency" is not null and "desire_review_events"."currency" ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "desires" DROP CONSTRAINT "desire_waiting_check";--> statement-breakpoint
ALTER TABLE "desire_review_events" ADD CONSTRAINT "review_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_review_events" ADD CONSTRAINT "review_supersedes_owner_fk" FOREIGN KEY ("supersedes_event_id","desire_id","owner_id") REFERENCES "desire_review_events"("id","desire_id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_owner_desire_order_idx" ON "desire_review_events" USING btree ("owner_id","desire_id","sequence");--> statement-breakpoint
ALTER TABLE "desires" ADD CONSTRAINT "desire_waiting_check" CHECK (("desires"."status" in ('considering','bought','declined','used_owned') and "desires"."waiting_started_at" is null and "desires"."review_at" is null) or ("desires"."status" = 'waiting' and "desires"."waiting_started_at" is not null and "desires"."review_at" is not null and isfinite("desires"."waiting_started_at") and isfinite("desires"."review_at") and "desires"."review_at" > "desires"."waiting_started_at"));--> statement-breakpoint
-- Owner context is transaction-local and set only after session authentication.
ALTER TABLE desire_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_owner_policy ON desire_review_events
 USING (owner_id = nullif(current_setting('havefolio.owner_id',true),'')::uuid)
 WITH CHECK (owner_id = nullif(current_setting('havefolio.owner_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION guard_desire_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d desires%ROWTYPE; latest desire_review_events%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN
   -- Explicit owner deletion of the parent removes private data, including history.
   IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM desires WHERE id=OLD.desire_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'REVIEW_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO d FROM desires WHERE id=NEW.desire_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_DESIRE_OWNER' USING ERRCODE='23503'; END IF;
 SELECT * INTO latest FROM desire_review_events WHERE desire_id=d.id AND owner_id=d.owner_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>d.revision+1 OR
    (NEW.supersedes_event_id IS NOT NULL AND NEW.supersedes_event_id IS DISTINCT FROM latest.id) OR
    (d.status IN ('bought','declined','used_owned') AND NEW.supersedes_event_id IS NULL) THEN
   RAISE EXCEPTION 'STALE_REVIEW' USING ERRCODE='23514';
 END IF;
 IF NEW.linked_item_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM items WHERE id=NEW.linked_item_id AND owner_id=NEW.owner_id AND ownership_status='owned' FOR SHARE
 ) THEN RAISE EXCEPTION 'REVIEW_ITEM_UNAVAILABLE' USING ERRCODE='23503'; END IF;
 IF NEW.estimated_not_spent_minor IS DISTINCT FROM (CASE WHEN NEW.outcome='declined' THEN d.likely_price_minor ELSE NULL END) OR
    NEW.currency IS DISTINCT FROM (CASE WHEN NEW.outcome='declined' THEN d.currency ELSE NULL END) THEN
   RAISE EXCEPTION 'REVIEW_ESTIMATE_SNAPSHOT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_review_events
 FOR EACH ROW EXECUTE FUNCTION guard_desire_review();
--> statement-breakpoint
CREATE FUNCTION project_desire_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE desires SET status=CASE WHEN NEW.outcome='delayed' THEN 'waiting' ELSE NEW.outcome END,
   waiting_started_at=CASE WHEN NEW.outcome='delayed' THEN NEW.occurred_at ELSE NULL END,
   review_at=NEW.review_at,revision=NEW.sequence,updated_at=now()
 WHERE id=NEW.desire_id AND owner_id=NEW.owner_id;
 IF NEW.outcome='delayed' THEN
   INSERT INTO desire_reminders(desire_id,owner_id,schedule_version,scheduled_for)
     VALUES(NEW.desire_id,NEW.owner_id,NEW.sequence,NEW.review_at)
   ON CONFLICT(desire_id) DO UPDATE SET schedule_version=NEW.sequence,scheduled_for=NEW.review_at,
     state='pending',last_enqueued_at=NULL,delivered_at=NULL,updated_at=now();
 ELSE
   DELETE FROM desire_reminders WHERE desire_id=NEW.desire_id AND owner_id=NEW.owner_id;
 END IF;
 -- Historical notification remains readable; resolved/superseded prompts stop being actionable.
 UPDATE notifications SET read_at=coalesce(read_at,now()),updated_at=now()
 WHERE desire_id=NEW.desire_id AND owner_id=NEW.owner_id;
 RETURN NEW;
END $$;
CREATE TRIGGER review_project AFTER INSERT ON desire_review_events FOR EACH ROW EXECUTE FUNCTION project_desire_review();
--> statement-breakpoint
CREATE FUNCTION guard_review_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE latest desire_review_events%ROWTYPE;
BEGIN
 SELECT * INTO latest FROM desire_review_events WHERE desire_id=NEW.id AND owner_id=NEW.owner_id ORDER BY sequence DESC LIMIT 1;
 IF FOUND AND (NEW.status IS DISTINCT FROM (CASE WHEN latest.outcome='delayed' THEN 'waiting' ELSE latest.outcome END)
   OR NEW.review_at IS DISTINCT FROM latest.review_at
   OR NEW.waiting_started_at IS DISTINCT FROM (CASE WHEN latest.outcome='delayed' THEN latest.occurred_at ELSE NULL END)) THEN
   RAISE EXCEPTION 'REVIEW_EVENT_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_projection_guard BEFORE UPDATE ON desires FOR EACH ROW EXECUTE FUNCTION guard_review_projection();
