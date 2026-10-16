CREATE TABLE "desire_reminders" (
	"desire_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"scheduled_for" timestamp (3) with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_enqueued_at" timestamp (3) with time zone,
	"delivered_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desire_reminder_version_check" CHECK ("desire_reminders"."schedule_version" >= 1),
	CONSTRAINT "desire_reminder_state_check" CHECK (("desire_reminders"."state" in ('pending','scheduled') and "desire_reminders"."delivered_at" is null) or ("desire_reminders"."state" = 'delivered' and "desire_reminders"."delivered_at" is not null)),
	CONSTRAINT "desire_reminder_times_check" CHECK (isfinite("desire_reminders"."scheduled_for") and isfinite("desire_reminders"."created_at") and isfinite("desire_reminders"."updated_at") and "desire_reminders"."created_at" <= "desire_reminders"."updated_at" and ("desire_reminders"."last_enqueued_at" is null or isfinite("desire_reminders"."last_enqueued_at")) and ("desire_reminders"."delivered_at" is null or isfinite("desire_reminders"."delivered_at")))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"desire_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reminder_version" integer NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"read_at" timestamp (3) with time zone,
	"ntfy_state" text DEFAULT 'pending' NOT NULL,
	"ntfy_attempts" integer DEFAULT 0 NOT NULL,
	"ntfy_claimed_at" timestamp (3) with time zone,
	"ntfy_sent_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reminder_delivery_unique" UNIQUE("desire_id","reminder_version","type"),
	CONSTRAINT "notification_reminder_version_check" CHECK ("notifications"."reminder_version" >= 1),
	CONSTRAINT "notification_ntfy_attempts_check" CHECK ("notifications"."ntfy_attempts" between 0 and 20),
	CONSTRAINT "notification_ntfy_state_check" CHECK (("notifications"."ntfy_state" = 'pending' and "notifications"."ntfy_attempts" = 0 and "notifications"."ntfy_claimed_at" is null and "notifications"."ntfy_sent_at" is null) or ("notifications"."ntfy_state" = 'sending' and "notifications"."ntfy_attempts" > 0 and "notifications"."ntfy_claimed_at" is not null and "notifications"."ntfy_sent_at" is null) or ("notifications"."ntfy_state" = 'failed' and "notifications"."ntfy_attempts" > 0 and "notifications"."ntfy_claimed_at" is null and "notifications"."ntfy_sent_at" is null) or ("notifications"."ntfy_state" = 'sent' and "notifications"."ntfy_attempts" > 0 and "notifications"."ntfy_claimed_at" is null and "notifications"."ntfy_sent_at" is not null)),
	CONSTRAINT "notification_times_check" CHECK (isfinite("notifications"."occurred_at") and isfinite("notifications"."created_at") and isfinite("notifications"."updated_at") and "notifications"."created_at" <= "notifications"."updated_at" and ("notifications"."read_at" is null or isfinite("notifications"."read_at")) and ("notifications"."ntfy_claimed_at" is null or isfinite("notifications"."ntfy_claimed_at")) and ("notifications"."ntfy_sent_at" is null or isfinite("notifications"."ntfy_sent_at")))
);
--> statement-breakpoint
ALTER TABLE "desire_reminders" ADD CONSTRAINT "desire_reminder_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_desire_owner_fk" FOREIGN KEY ("desire_id","owner_id") REFERENCES "desires"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desire_reminder_reconcile_idx" ON "desire_reminders" USING btree ("state","scheduled_for","desire_id");--> statement-breakpoint
CREATE INDEX "desire_reminder_owner_idx" ON "desire_reminders" USING btree ("owner_id","scheduled_for","desire_id");--> statement-breakpoint
CREATE INDEX "notification_owner_created_idx" ON "notifications" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_owner_unread_idx" ON "notifications" USING btree ("owner_id","created_at","id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_ntfy_recovery_idx" ON "notifications" USING btree ("ntfy_state","ntfy_claimed_at","id");
