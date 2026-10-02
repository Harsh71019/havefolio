CREATE INDEX "item_owner_name_idx" ON "items" USING btree ("owner_id",lower("name") COLLATE "C","id");--> statement-breakpoint
CREATE INDEX "item_owner_updated_idx" ON "items" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "item_owner_currency_price_idx" ON "items" USING btree ("owner_id","currency","price_paid_minor","id");--> statement-breakpoint
CREATE INDEX "item_search_document_idx" ON "items" USING gin (to_tsvector('simple', normalize(coalesce("name",'') || ' ' || coalesce("brand",'') || ' ' || coalesce("model",''),NFKC)));--> statement-breakpoint
CREATE INDEX "tag_search_document_idx" ON "tags" USING gin (to_tsvector('simple',normalize("name",NFKC)));