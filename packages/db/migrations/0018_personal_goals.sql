CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"supersedes_id" uuid,
	"kind" text NOT NULL,
	"note" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_identity_unique" UNIQUE("id","goal_id","owner_id"),
	CONSTRAINT "contribution_command_unique" UNIQUE("goal_id","owner_id","command_id"),
	CONSTRAINT "contribution_sequence_unique" UNIQUE("goal_id","sequence"),
	CONSTRAINT "contribution_successor_unique" UNIQUE("supersedes_id"),
	CONSTRAINT "contribution_amount_check" CHECK (("goal_contributions"."kind" in ('contribution','correction') and "goal_contributions"."amount_minor">0) or ("goal_contributions"."kind"='reversal' and "goal_contributions"."amount_minor"=0)),
	CONSTRAINT "contribution_kind_check" CHECK (("goal_contributions"."kind"='contribution' and "goal_contributions"."supersedes_id" is null) or ("goal_contributions"."kind" in ('correction','reversal') and "goal_contributions"."supersedes_id" is not null)),
	CONSTRAINT "contribution_note_check" CHECK ("goal_contributions"."note" is null or length("goal_contributions"."note") between 1 and 2000),
	CONSTRAINT "contribution_hash_check" CHECK ("goal_contributions"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "contribution_sequence_check" CHECK ("goal_contributions"."sequence">1)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"target_date" date,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "goal_currency_unique" UNIQUE("id","owner_id","currency"),
	CONSTRAINT "goal_name_check" CHECK (length(btrim("goals"."name")) between 1 and 200 and "goals"."name"=btrim("goals"."name")),
	CONSTRAINT "goal_target_check" CHECK ("goals"."target_minor" >= 0),
	CONSTRAINT "goal_currency_check" CHECK ("goals"."currency" in ('ADP', 'AED', 'AFA', 'AFN', 'ALK', 'ALL', 'AMD', 'ANG', 'AOA', 'AOK', 'AON', 'AOR', 'ARA', 'ARP', 'ARS', 'ARY', 'ATS', 'AUD', 'AWG', 'AYM', 'AZM', 'AZN', 'BAD', 'BAM', 'BBD', 'BDT', 'BEC', 'BEF', 'BEL', 'BGJ', 'BGK', 'BGL', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOP', 'BOV', 'BRB', 'BRC', 'BRE', 'BRL', 'BRN', 'BRR', 'BSD', 'BTN', 'BUK', 'BWP', 'BYB', 'BYN', 'BYR', 'BZD', 'CAD', 'CDF', 'CHC', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CSD', 'CSJ', 'CSK', 'CUC', 'CUP', 'CVE', 'CYP', 'CZK', 'DDM', 'DEM', 'DJF', 'DKK', 'DOP', 'DZD', 'ECS', 'ECV', 'EEK', 'EGP', 'ERN', 'ESA', 'ESB', 'ESP', 'ETB', 'EUR', 'FIM', 'FJD', 'FKP', 'FRF', 'GBP', 'GEK', 'GEL', 'GHC', 'GHP', 'GHS', 'GIP', 'GMD', 'GNE', 'GNF', 'GNS', 'GQE', 'GRD', 'GTQ', 'GWE', 'GWP', 'GYD', 'HKD', 'HNL', 'HRD', 'HRK', 'HTG', 'HUF', 'IDR', 'IEP', 'ILP', 'ILR', 'ILS', 'INR', 'IQD', 'IRR', 'ISJ', 'ISK', 'ITL', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAJ', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LSM', 'LTL', 'LTT', 'LUC', 'LUF', 'LUL', 'LVL', 'LVR', 'LYD', 'MAD', 'MDL', 'MGA', 'MGF', 'MKD', 'MLF', 'MMK', 'MNT', 'MOP', 'MRO', 'MRU', 'MTL', 'MTP', 'MUR', 'MVQ', 'MVR', 'MWK', 'MXN', 'MXP', 'MXV', 'MYR', 'MZE', 'MZM', 'MZN', 'NAD', 'NGN', 'NIC', 'NIO', 'NLG', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEH', 'PEI', 'PEN', 'PES', 'PGK', 'PHP', 'PKR', 'PLN', 'PLZ', 'PTE', 'PYG', 'QAR', 'RHD', 'ROK', 'ROL', 'RON', 'RSD', 'RUB', 'RUR', 'RWF', 'SAR', 'SBD', 'SCR', 'SDD', 'SDG', 'SDP', 'SEK', 'SGD', 'SHP', 'SIT', 'SKK', 'SLE', 'SLL', 'SOS', 'SRD', 'SRG', 'SSP', 'STD', 'STN', 'SUR', 'SVC', 'SYP', 'SZL', 'THB', 'TJR', 'TJS', 'TMM', 'TMT', 'TND', 'TOP', 'TPE', 'TRL', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UAK', 'UGS', 'UGW', 'UGX', 'USD', 'USN', 'USS', 'UYI', 'UYN', 'UYP', 'UYU', 'UYW', 'UZS', 'VEB', 'VED', 'VEF', 'VES', 'VNC', 'VND', 'VUV', 'WST', 'XAD', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XEU', 'XFO', 'XFU', 'XOF', 'XPD', 'XPF', 'XPT', 'XRE', 'XSU', 'XUA', 'YDD', 'YER', 'YUD', 'YUM', 'YUN', 'ZAL', 'ZAR', 'ZMK', 'ZMW', 'ZRN', 'ZRZ', 'ZWC', 'ZWD', 'ZWG', 'ZWL', 'ZWN', 'ZWR')),
	CONSTRAINT "goal_date_check" CHECK ("goals"."target_date" is null or ("goals"."target_date" between '0001-01-01'::date and '9999-12-31'::date)),
	CONSTRAINT "goal_notes_check" CHECK ("goals"."notes" is null or length("goals"."notes") between 1 and 2000),
	CONSTRAINT "goal_status_check" CHECK ("goals"."status" in ('active','completed','archived')),
	CONSTRAINT "goal_revision_check" CHECK ("goals"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "contribution_goal_currency_fk" FOREIGN KEY ("goal_id","owner_id","currency") REFERENCES "goals"("id","owner_id","currency") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "contribution_supersedes_fk" FOREIGN KEY ("supersedes_id","goal_id","owner_id") REFERENCES "goal_contributions"("id","goal_id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_owner_order_idx" ON "goal_contributions" USING btree ("owner_id","goal_id","sequence");--> statement-breakpoint
CREATE INDEX "goal_owner_order_idx" ON "goals" USING btree ("owner_id","id");
--> statement-breakpoint
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_owner_policy ON goals
 USING (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid)
 WITH CHECK (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid);
ALTER TABLE goal_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY contribution_owner_policy ON goal_contributions
 USING (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid)
 WITH CHECK (owner_id=nullif(current_setting('havefolio.owner_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION guard_goal_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g goals%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
   -- Explicit deletion of the parent purges owner-private ledger history.
   IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM goals WHERE id=OLD.goal_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'CONTRIBUTION_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO g FROM goals WHERE id=NEW.goal_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTRIBUTION_GOAL_OWNER' USING ERRCODE='23503'; END IF;
 IF g.status='archived' OR NEW.sequence<>g.revision+1 OR NEW.currency<>g.currency THEN
   RAISE EXCEPTION 'INVALID_CONTRIBUTION_STATE' USING ERRCODE='23514';
 END IF;
 IF NEW.supersedes_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM goal_contributions WHERE id=NEW.supersedes_id AND goal_id=g.id AND owner_id=g.owner_id) THEN
     RAISE EXCEPTION 'CONTRIBUTION_NOT_FOUND' USING ERRCODE='23503';
   END IF;
   IF EXISTS(SELECT 1 FROM goal_contributions WHERE supersedes_id=NEW.supersedes_id AND owner_id=g.owner_id) THEN
     RAISE EXCEPTION 'CONTRIBUTION_ALREADY_CORRECTED' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contribution_guard BEFORE INSERT OR UPDATE OR DELETE ON goal_contributions
 FOR EACH ROW EXECUTE FUNCTION guard_goal_contribution();
--> statement-breakpoint
CREATE FUNCTION project_goal_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE goals SET revision=NEW.sequence,updated_at=now() WHERE id=NEW.goal_id AND owner_id=NEW.owner_id;
 RETURN NEW;
END $$;
CREATE TRIGGER contribution_project AFTER INSERT ON goal_contributions
 FOR EACH ROW EXECUTE FUNCTION project_goal_contribution();
