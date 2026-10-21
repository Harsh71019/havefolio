import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
export async function seed(client, size) {
  const owners = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const token = randomBytes(32).toString('base64url');
  await client.query(
    "INSERT INTO users(id,email,password_hash) VALUES($1,'synthetic@example.test','$argon2id$fixture'),($2,NULL,NULL)",
    owners,
  );
  await client.query(
    "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '8 hours',now()+interval '1 day')",
    [owners[0], createHash('sha256').update(token).digest('hex')],
  );
  for (const owner of owners) {
    await client.query(
      "INSERT INTO owner_onboarding(owner_id,state,browsed_store,reviewed_item) VALUES($1,'completed',true,true)",
      [owner],
    );
    await client.query(
      `INSERT INTO items(id,owner_id,name,brand,currency,price_paid_minor,ownership_status,condition,use_frequency,
      acquisition_type,purchase_date_precision,purchase_year,purchase_month,purchase_day,original_entry,original_source,created_at)
      SELECT ($3::text||lpad(n::text,12,'0'))::uuid,$1,'Synthetic item '||lpad(n::text,5,'0'),'Synthetic brand '||(n%8),
      CASE WHEN n%10=0 THEN 'USD' ELSE 'INR' END,
      CASE WHEN n%11=0 OR n%13=0 THEN NULL ELSE (10000+n*17)::bigint END,
      CASE WHEN n%7=0 THEN 'returned' WHEN n%5=0 THEN 'sold' ELSE 'owned' END,'working','rarely',
      CASE WHEN n%13=0 THEN 'gift' ELSE 'bought' END,
      (ARRAY['unknown','year','month','exact'])[n%4+1],
      CASE WHEN n%4>0 THEN 2024 END,CASE WHEN n%4>1 THEN n%12+1 END,CASE WHEN n%4=3 THEN n%28+1 END,
      jsonb_build_object('name','Synthetic item '||lpad(n::text,5,'0')),'manual','2025-01-01'::timestamptz+n*interval '1 second'
      FROM generate_series(1,$2::int) AS n`,
      [owner, size, owner === owners[0] ? '10000000-0000-4000-8000-' : '20000000-0000-4000-8000-'],
    );
    await client.query(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at) SELECT owner_id,id,'created',created_at FROM items WHERE owner_id=$1",
      [owner],
    );
    await client.query(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) SELECT owner_id,id,'ownership_changed',created_at+interval '1 day',jsonb_build_object('ownershipStatus',ownership_status) FROM items WHERE owner_id=$1 AND ownership_status<>'owned'",
      [owner],
    );
    await client.query(
      "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor,refund_date_precision) SELECT owner_id,id,currency,1000,'unknown' FROM items WHERE owner_id=$1 AND ownership_status='returned' AND price_paid_minor IS NOT NULL",
      [owner],
    );
    await client.query(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at) SELECT owner_id,item_id,'refund_recorded','2025-03-01'::timestamptz FROM item_refunds WHERE owner_id=$1",
      [owner],
    );
  }
  // Deterministic textured pixels, with realistic compression work but no real photographs/EXIF.
  const pixels = Buffer.alloc(1600 * 1200 * 3);
  let state = 94;
  for (let i = 0; i < pixels.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pixels[i] = state >>> 24;
  }
  const images = {};
  for (const [variant, width] of [
    ['original', 1600],
    ['display', 1280],
    ['thumbnail', 320],
  ])
    images[variant] = await sharp(pixels, { raw: { width: 1600, height: 1200, channels: 3 } })
      .resize(width)
      .webp({ quality: 80 })
      .toBuffer();
  const stored = new Map();
  const items = (await client.query('SELECT id,owner_id,name FROM items ORDER BY name,id')).rows;
  const chosen = items.filter((item) => {
    const n = Number(item.name.slice(-5));
    return n <= 25 || n % 10 === 0;
  });
  for (const item of chosen) {
    const parent = randomUUID();
    for (const [variant, width] of [
      ['original', 1600],
      ['display', 1280],
      ['thumbnail', 320],
    ]) {
      const id = variant === 'original' ? parent : randomUUID(),
        key = `havefolio/test/${id}`;
      stored.set(key, images[variant]);
      await client.query(
        `INSERT INTO media_attachments(id,owner_id,item_id,parent_id,kind,variant,state,object_key,resource_type,format,
        provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum,width,height)
        VALUES($1,$2,$3,$4,'photo',$5,'ready',$6,'image','webp',$7,1,'sanitized.webp','image/webp',$8,$9,$10,$11)`,
        [
          id,
          item.owner_id,
          item.id,
          variant === 'original' ? null : parent,
          variant,
          key,
          randomUUID(),
          images[variant].length,
          createHash('sha256').update(images[variant]).digest('hex'),
          width,
          (width * 3) / 4,
        ],
      );
    }
  }
  await client.query('ANALYZE');
  const item = items.find((i) => i.owner_id === owners[0]).id;
  const foreign = items.find((i) => i.owner_id === owners[1]).id;
  const counts = (
    await client.query(
      'SELECT (SELECT count(*)::int FROM items) AS items,(SELECT count(*)::int FROM lifecycle_events) AS events,(SELECT count(*)::int FROM item_refunds) AS refunds,(SELECT count(*)::int FROM media_attachments) AS media',
    )
  ).rows[0];
  return { owners, token, item, foreign, stored, counts };
}
