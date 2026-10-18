CREATE TABLE "desire_goal_allocations" (
	"desire_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"review_event_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_contribution_unique" UNIQUE("contribution_id"),
	CONSTRAINT "allocation_command_unique" UNIQUE("owner_id","command_id"),
	CONSTRAINT "allocation_hash_check" CHECK ("desire_goal_allocations"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "desire_goal_allocations" ADD CONSTRAINT "allocation_source_fk" FOREIGN KEY ("review_event_id","desire_id","owner_id") REFERENCES "desire_review_events"("id","desire_id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_goal_owner_idx" ON "desire_goal_allocations" USING btree ("owner_id","goal_id");
--> statement-breakpoint
ALTER TABLE desire_goal_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY allocation_owner_policy ON desire_goal_allocations
 USING (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid)
 WITH CHECK (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid);
--> statement-breakpoint
-- No goal/ledger FK: explicit goal erasure purges its private data but must not permit reallocation.
-- No amount/name/note snapshots survive that erasure. Source erasure purges this link by FK.
CREATE FUNCTION guard_desire_goal_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest desire_review_events%ROWTYPE; entry goal_contributions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
   IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM desires WHERE id=OLD.desire_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'ALLOCATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM desires WHERE id=NEW.desire_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ALLOCATION_SOURCE_OWNER' USING ERRCODE='23503'; END IF;
 SELECT * INTO latest FROM desire_review_events WHERE desire_id=NEW.desire_id AND owner_id=NEW.owner_id ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR latest.id<>NEW.review_event_id OR latest.outcome<>'declined' OR latest.estimated_not_spent_minor IS NULL OR latest.estimated_not_spent_minor<=0 THEN
   RAISE EXCEPTION 'ALLOCATION_SOURCE_STATE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO entry FROM goal_contributions WHERE id=NEW.contribution_id AND owner_id=NEW.owner_id AND goal_id=NEW.goal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ALLOCATION_CONTRIBUTION_OWNER' USING ERRCODE='23503'; END IF;
 IF entry.kind<>'contribution' OR entry.supersedes_id IS NOT NULL OR entry.amount_minor<>latest.estimated_not_spent_minor OR entry.currency<>latest.currency OR entry.command_id<>NEW.command_id OR entry.request_hash<>NEW.request_hash THEN
   RAISE EXCEPTION 'ALLOCATION_CONTRIBUTION_STATE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON desire_goal_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_desire_goal_allocation();
