import { assert } from './helpers.js';

function scope(kind) {
  const product=kind==='product';
  const relations=product ? `
    selected_sales AS (SELECT id,order_id FROM sales WHERE sku=(SELECT id FROM target)),
    candidate_orders AS (SELECT DISTINCT order_id AS id FROM selected_sales WHERE order_id IS NOT NULL),
    selected_orders AS (SELECT id FROM candidate_orders o WHERE NOT EXISTS(
      SELECT 1 FROM sales s WHERE s.order_id=o.id AND s.id NOT IN (SELECT id FROM selected_sales))),
    selected_batches AS (SELECT id FROM batches WHERE sku=(SELECT id FROM target)),
    selected_issues AS (SELECT id FROM issues WHERE sku=(SELECT id FROM target)),
    attached_photos AS (SELECT id FROM photos WHERE sku=(SELECT id FROM target) OR issue_id IN (SELECT id FROM selected_issues)),
    selected_imports AS (SELECT i.id,i.payload FROM import_rows i WHERE json_extract(i.payload,'$.sku')=(SELECT id FROM target)
      OR (i.approved_at IS NOT NULL AND COALESCE(json_extract(i.payload,'$.sku'),'')='' AND EXISTS (
        SELECT 1 FROM json_each(i.payload,'$.photos') f JOIN attached_photos p ON p.id=f.value))),
    selected_photos AS (SELECT id FROM attached_photos UNION
      SELECT p.id FROM selected_imports i JOIN json_each(i.payload,'$.photos') f JOIN photos p ON p.id=f.value
      WHERE p.sku IS NULL AND p.issue_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM import_rows other JOIN json_each(other.payload,'$.photos') extra ON extra.value=p.id
        WHERE other.id NOT IN (SELECT id FROM selected_imports)))` : `
    selected_orders AS (SELECT id FROM orders WHERE customer_id=(SELECT id FROM target)),
    selected_sales AS (SELECT id,order_id FROM sales WHERE order_id IN (SELECT id FROM selected_orders)),
    selected_batches AS (SELECT id FROM batches WHERE 0),
    selected_issues AS (SELECT id FROM issues WHERE 0),
    selected_imports AS (SELECT id FROM import_rows WHERE 0),
    selected_photos AS (SELECT id FROM photos WHERE 0)`;
  return `WITH target(id) AS (VALUES (?)), ${relations},
    selected_returns AS (SELECT id FROM returns WHERE sale_id IN (SELECT id FROM selected_sales)),
    selected_movements AS (SELECT id FROM movements WHERE sale_id IN (SELECT id FROM selected_sales)
      OR batch_id IN (SELECT id FROM selected_batches))`;
}

function summary(kind) {
  const product=kind==='product';
  const entity=product ? "SELECT json_array(sku,name,created_at) FROM products WHERE sku=(SELECT id FROM target)" :
    "SELECT json_array(id,name,phone,email,created_at) FROM customers WHERE id=(SELECT id FROM target)";
  const attached=product ? "SELECT id FROM photos WHERE sku=(SELECT id FROM target) ORDER BY position,id" : "SELECT id FROM photos WHERE 0";
  return `SELECT json_object('record',json((${entity})),
    'photos',json((SELECT json_group_array(id) FROM (${attached}))),
    'orderIds',json((SELECT json_group_array(id) FROM (SELECT id FROM selected_orders ORDER BY id))),
    'orders',(SELECT count(*) FROM selected_orders),
    'sales',(SELECT count(*) FROM selected_sales),
    'returns',(SELECT count(*) FROM selected_returns),
    'moves',(SELECT count(*) FROM selected_movements),
    'batches',(SELECT count(*) FROM selected_batches),
    'issues',(SELECT count(*) FROM selected_issues),
    'files',(SELECT count(*) FROM selected_photos),
    'imports',(SELECT count(*) FROM selected_imports))`;
}

export async function deletionPreview(db,kind,key) {
  const row=await db.one(`${scope(kind)} ${summary(kind)} AS snapshot`,key);
  const {record,photos,orderIds,...counts}=JSON.parse(row.snapshot);
  assert(record,'This record is unavailable.',404);
  const [id,name,phone,email]=record;
  return {id,name,photos,counts,snapshot:row.snapshot,...(kind==='customer'?{phone,email}:{})};
}

export async function deleteRecord(db,env,user,kind,key,input) {
  assert(input.confirmation==='DELETE','Type DELETE to confirm.');
  assert(typeof input.snapshot==='string','Review the records before deleting.');
  const preview=await deletionPreview(db,kind,key);
  assert(preview.snapshot===input.snapshot,'The records changed. Close this window and review them again.',409);
  const product=kind==='product';
  const withScope=(sql,...params)=>db.sql(`${scope(kind)} ${sql}`,key,...params);
  // Keep mixed-product orders. Remember emptying orders while their original lines still exist.
  const targetOrders=JSON.parse(preview.snapshot).orderIds;
  const writes=[
    withScope(`SELECT json(CASE WHEN (${summary(kind)})=? THEN 'null' ELSE 'changed' END)`,input.snapshot),
    ...(product ? [
      withScope('INSERT OR IGNORE INTO photo_cleanup SELECT id FROM selected_photos'),
      withScope("DELETE FROM audit WHERE (target=(SELECT id FROM target) AND action GLOB 'product.*') OR (target=(SELECT id FROM target) AND action GLOB 'stock.*') OR (target=(SELECT id FROM target) AND action='import.approve') OR (target IN (SELECT id FROM selected_issues) AND action GLOB 'issue.*')"),
      withScope('DELETE FROM applied_imports WHERE id IN (SELECT id FROM selected_imports)'),
      withScope('DELETE FROM import_rows WHERE id IN (SELECT id FROM selected_imports)'),
      db.sql('DELETE FROM photos WHERE id IN (SELECT id FROM photo_cleanup)'),
      withScope('DELETE FROM issues WHERE id IN (SELECT id FROM selected_issues)')
    ] : []),
    withScope("DELETE FROM audit WHERE (action GLOB 'sale.*' AND target IN (SELECT id FROM selected_sales)) OR (action GLOB 'order.*' AND target IN (SELECT id FROM selected_orders))"),
    withScope('DELETE FROM return_allocations WHERE return_id IN (SELECT id FROM selected_returns) OR movement_id IN (SELECT id FROM selected_movements)'),
    withScope('DELETE FROM returns WHERE id IN (SELECT id FROM selected_returns)'),
    withScope('DELETE FROM movements WHERE id IN (SELECT id FROM selected_movements)'),
    withScope('DELETE FROM sale_notes WHERE sale_id IN (SELECT id FROM selected_sales)'),
    withScope('DELETE FROM sales WHERE id IN (SELECT id FROM selected_sales)'),
    ...(product ? [
      db.sql('DELETE FROM orders WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM sales WHERE order_id=orders.id)',JSON.stringify(targetOrders)),
      withScope('DELETE FROM batches WHERE id IN (SELECT id FROM selected_batches)'),
      ...['product_categories','product_themes','recent','events','products'].map(table=>db.sql(`DELETE FROM ${table} WHERE sku=?`,key))
    ] : [withScope('DELETE FROM orders WHERE id IN (SELECT id FROM selected_orders)'),db.sql('DELETE FROM customers WHERE id=?',key)]),
    db.sql('INSERT INTO audit(actor,action,target) VALUES(?,?,?)',user.id,kind+'.deleted',key)
  ];
  try { await db.batch(writes); }
  catch (error) {
    if (String(error.message).includes('malformed JSON')) assert(false,'The records changed. Close this window and review them again.',409);
    throw error;
  }
  let cleanupPending=false;
  if (product) {
    try {
      while (true) {
        const rows=await db.all('SELECT id FROM photo_cleanup LIMIT 500');
        if (!rows.length) break;
        const ids=rows.map(row=>row.id);
        await env.PHOTOS.delete(ids);
        await db.run('DELETE FROM photo_cleanup WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(ids));
      }
    } catch { cleanupPending=true; }
  }
  return {cleanupPending};
}
