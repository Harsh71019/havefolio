CREATE OR REPLACE FUNCTION inventory_media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_item uuid; parent_kind text; parent_variant text; inconsistent_children boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'deleted' THEN
      RAISE EXCEPTION 'Provider cleanup must finish before metadata deletion' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  -- Confirmed-deleted metadata may detach for item erasure, retaining exact provider keys.
  -- Other fields remain immutable and detached tombstones cannot be rebound.
  IF TG_OP = 'UPDATE' AND OLD.state = 'deleted' AND NEW.state = 'deleted'
     AND OLD.item_id IS NOT NULL AND NEW.item_id IS NULL
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
  IF TG_OP = 'UPDATE' AND OLD.state = 'deleted' AND NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'Deleted metadata cannot be revived or rebound' USING ERRCODE = '23514';
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
