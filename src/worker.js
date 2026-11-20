import { HttpError, assert, clean, skuOf, units, money, date, dayInZone, offsetDay, emailOf, hashToken, goodImage } from './helpers.js';
import { buildAuth, seedAdmin, staffSession } from './auth.js';
import { dashboard } from './dashboard.js';
import { deletionPreview, deleteRecord } from './cleanup.js';
import { searchCustomers, createCustomer, customerId, customerDetail, listOrders, orderDetail, listReturns } from './customers.js';

const id = () => crypto.randomUUID();
const json = (value, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control':'no-store', ...headers }
});
const migrationsHint = 'Database unavailable. Apply the D1 migrations before running the app.';
const publicStock = "p.state='active' AND p.price IS NOT NULL AND s.on_hand>0";
const displayPrice = 'CASE WHEN p.discount=1 AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END';
const catalogSelect = `SELECT p.sku,p.name,p.description,${displayPrice} AS display_price,
 CASE WHEN p.discount=1 AND p.sale_price<p.price THEN p.price END AS original_price,
 p.type_id,t.name AS product_type,s.on_hand-s.reserved AS available,
 (SELECT id FROM photos WHERE sku=p.sku ORDER BY position,id LIMIT 1) AS cover,
 (SELECT group_concat(category_id) FROM product_categories WHERE sku=p.sku) AS categories
 FROM products p JOIN stock s ON s.sku=p.sku LEFT JOIN categories t ON t.id=p.type_id`;
function access(env) {
  const sql = (query, ...params) => env.DB.prepare(query).bind(...params);
  const all = async (query, ...params) => (await sql(query,...params).all()).results;
  const one = (query, ...params) => sql(query,...params).first();
  const run = (query, ...params) => sql(query,...params).run();
  return {sql, all, one, run, batch: statements => env.DB.batch(statements)};
}
const audit = (db, user, action, target, details = null) => db.sql(
  'INSERT INTO audit(actor,action,target,details) VALUES(?,?,?,?)',user.id,action,target,details);
function requireManager(user) { assert(user?.role === 'manager','Manager access required.',403); }
function transactionDay(input, today, fallback = today) {
  const day = date(input ?? fallback);
  assert(day <= today,'The date cannot be in the future.');
  return day;
}
function addStock(db, user, sku, quantity, cost, receivedOn, today, note, batch=id()) {
  if (!quantity) return [];
  return [
    db.sql('INSERT INTO batches(id,sku,cost,received_on) VALUES(?,?,?,?)',batch,sku,cost,receivedOn),
    db.sql("INSERT INTO movements(id,batch_id,kind,qty,effective_on,actor,note) VALUES(?,?,'receive',?,?,?,?)",
      id(),batch,quantity,receivedOn ?? today,user.id,note)
  ];
}
async function productPayload(db, input) {
  const audience = [...new Set((input.categories ?? []).map(Number))];
  assert(audience.length <= 30,'Too many audience categories.');
  const categoryList = await db.all('SELECT id,kind FROM categories');
  assert(audience.every(category => categoryList.some(row => row.id === category && row.kind === 'audience')), 'Unknown audience category.');
  const type = input.type_id ? Number(input.type_id) : null;
  assert(!type || categoryList.some(row => row.id === type && row.kind === 'type'),'Unknown product type.');
  const name = clean(input.name);
  const price = money(input.price);
  const description = clean(input.description,4000);
  const themes = input.themes == null ? null : [...new Map(
    clean(input.themes,500).split(/[|,]/).map(theme=>theme.trim().replace(/\s+/g,' ')).filter(Boolean)
      .map(theme=>[theme.toLowerCase(),theme])
  )];
  assert(!themes || (themes.length<=8 && themes.every(([,theme])=>theme.length<=45)),
    'Use up to eight themes of 45 characters each.');
  return {name,description,audience,type,price,themes};
}
function saveProduct(db, sku, item, state, existing) {
  assert(item.name,'Enter a product name.');
  assert(state !== 'active' || item.price != null,'Enter a valid selling price before publishing.');
  const write = existing
    ? db.sql(`UPDATE products SET name=?,description=?,type_id=?,
      price=CASE WHEN discount=1 AND sale_price IS NOT NULL AND (? IS NULL OR sale_price>=?) THEN -1 ELSE ? END,
      published_at=CASE WHEN state<>'active' AND ?='active' THEN CURRENT_TIMESTAMP ELSE published_at END,state=? WHERE sku=?`,
      item.name,item.description,item.type,item.price,item.price,item.price,state,state,sku)
    : db.sql(`INSERT INTO products(sku,name,description,type_id,price,sale_price,discount,state,published_at)
      VALUES(?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      sku,item.name,item.description,item.type,item.price,null,0,state,state);
  const statements = [write, db.sql('DELETE FROM product_categories WHERE sku=?',sku),
    ...item.audience.map(category => db.sql('INSERT INTO product_categories VALUES(?,?)',sku,category))];
  if (item.personalNote !== undefined) {
    statements.push(db.sql('UPDATE products SET personal_note=? WHERE sku=?',item.personalNote,sku));
  }
  if (item.themes) {
    statements.push(db.sql('DELETE FROM product_themes WHERE sku=?',sku),
      ...item.themes.map(([key,theme])=>db.sql('INSERT INTO product_themes VALUES(?,?,?)',sku,key,theme)));
  }
  return statements;
}
function validateListing(item,state,existing,openingQuantity=0) {
  if (state==='active' && existing?.state!=='active') {
    assert((existing?.on_hand??0)+openingQuantity>0,'Enter a starting quantity before publishing.');
  }
  if (existing?.discount && existing.sale_price!=null) {
    assert(item.price!=null && item.price>existing.sale_price,'Set a selling price above the current clearance price or end clearance first.');
  }
}
async function photoStatements(db,user,photos,sku,issue = null) {
  assert(Array.isArray(photos) && photos.length <= 16,'Select up to 16 photos.');
  const statements = [];
  const existing = sku ? Number((await db.one('SELECT COALESCE(MAX(position),-1) n FROM photos WHERE sku=?',sku)).n)+1 : 0;
  for (const [index, image] of [...new Set(photos)].entries()) {
    const row = await db.one('SELECT * FROM photos WHERE id=? AND uploader=? AND sku IS NULL AND issue_id IS NULL',image,user.id);
    assert(row,'A selected photo is unavailable. Upload it again.');
    statements.push(db.sql('UPDATE photos SET sku=?,issue_id=?,position=? WHERE id=? AND sku IS NULL AND issue_id IS NULL',
      sku,issue,index+existing,image));
  }
  return statements;
}
async function uploadPhoto(request, env, db, user) {
  const size = Number(request.headers.get('Content-Length') ?? 0);
  assert(size <= 8500000,'Photo is too large.',413);
  const form = await request.formData();
  const file = form.get('photo');
  assert(file instanceof File && file.size > 0 && file.size <= 8000000,'Choose a photo smaller than 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert(goodImage(file.type,bytes),'Upload a JPG, PNG, WebP or AVIF image.');
  const image = id();
  await env.PHOTOS.put(image,bytes,{httpMetadata:{contentType:file.type}});
  try { await db.run('INSERT INTO photos(id,uploader,mime) VALUES(?,?,?)',image,user.id,file.type); }
  catch (error) { await env.PHOTOS.delete(image); throw error; }
  return json({id:image},201);
}
async function getPhoto(env, db, user, image) {
  const photo = await db.one(`SELECT f.*,p.state,s.on_hand FROM photos f
    LEFT JOIN products p ON p.sku=f.sku LEFT JOIN stock s ON s.sku=p.sku WHERE f.id=?`,image);
  const isPublic = photo?.state === 'active' && photo.on_hand > 0;
  const allowed = user && (photo?.uploader === user.id || user.role === 'manager' || (photo?.sku && photo.state === 'active'));
  assert(photo && (isPublic || allowed),'Photo unavailable.',404);
  const object = await env.PHOTOS.get(image);
  assert(object,'Photo unavailable.',404);
  return new Response(object.body,{headers:{'Content-Type':photo.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
}
async function itemDetail(db, sku, user) {
  const visibility = user ? '' : ` AND ${publicStock}`;
  const item = await db.one(`${catalogSelect} WHERE p.sku=?${visibility}`,sku);
  assert(item,'Item unavailable.',404);
  item.photos = await db.all('SELECT id FROM photos WHERE sku=? ORDER BY position,id',sku);
  if (user?.role === 'manager') {
    Object.assign(item,await db.one(`SELECT price,sale_price,discount,state,personal_note,
      (SELECT slot FROM featured_products WHERE sku=products.sku) AS featured_slot FROM products WHERE sku=?`,sku));
    item.themes = (await db.all('SELECT theme FROM product_themes WHERE sku=? ORDER BY theme_key',sku))
      .map(row=>row.theme).join(', ');
    const [batches,movements] = await db.batch([
      db.sql(`SELECT b.id,b.received_on,b.cost,balances.on_hand,m.qty AS received_quantity,m.note AS receipt_note
        FROM batches b JOIN batch_balances balances ON balances.id=b.id
        LEFT JOIN movements m ON m.rowid=(SELECT rowid FROM movements WHERE batch_id=b.id AND kind='receive' ORDER BY rowid LIMIT 1)
        WHERE b.sku=? ORDER BY b.rowid`,sku),
      db.sql(`SELECT m.batch_id,m.kind,m.qty,m.effective_on,m.reason,m.note,u.email AS actor_email
        FROM movements m JOIN batches b ON b.id=m.batch_id LEFT JOIN users u ON u.id=m.actor
        WHERE b.sku=? ORDER BY m.rowid`,sku)
    ]);
    item.batches = batches.results;
    item.movements = movements.results;
    item.has_stock_history = item.batches.length > 0;
    item.on_hand = item.batches.reduce((sum,batch)=>sum+batch.on_hand,0);
    item.adjustments = item.movements.filter(entry=>entry.kind==='adjust').reverse()
      .map(({kind,...entry})=>entry);
  }
  if (user?.role === 'employee') {
    const state = await db.one('SELECT state FROM products WHERE sku=?',sku);
    assert(state.state === 'active','Item unavailable.',404);
    await db.run('INSERT INTO recent(user_id,sku) VALUES(?,?) ON CONFLICT(user_id,sku) DO UPDATE SET seen_at=CURRENT_TIMESTAMP',user.id,sku);
  }
  return item;
}

async function catalog(db,url,staff) {
  const where = [staff?.role === 'manager' ? '1=1' : staff ? "p.state='active'" : publicStock];
  const params = [];
  const query = clean(url.searchParams.get('q'));
  if (query) {
    where.push('(instr(lower(p.sku),lower(?))>0 OR instr(lower(p.name),lower(?))>0 OR instr(lower(p.description),lower(?))>0)');
    params.push(query,query,query);
  }
  for (const [param, expression] of [
    ['type','p.type_id=?'], ['audience','EXISTS(SELECT 1 FROM product_categories pc WHERE pc.sku=p.sku AND pc.category_id=?)']
  ]) {
    if (url.searchParams.get(param)) { where.push(expression); params.push(Number(url.searchParams.get(param)) || -1); }
  }
  const page = Math.min(100000, Math.max(1, Number.parseInt(url.searchParams.get('page') || '1',10) || 1));
  const rows = await db.all(`${catalogSelect} WHERE ${where.join(' AND ')}
     ORDER BY p.name,p.sku LIMIT 49 OFFSET ?`,...params,(page-1)*48);
  return {items:rows.slice(0,48),next:rows.length>48,page};
}

async function shopHome(db) {
  const available=`${publicStock} AND s.on_hand>s.reserved`;
  const newest='COALESCE(p.published_at,p.created_at) DESC,p.sku';
  const [featured,arrivals,clearance]=await db.batch([
    db.sql(`${catalogSelect} JOIN featured_products f ON f.sku=p.sku WHERE ${available} ORDER BY f.slot`),
    db.sql(`${catalogSelect} WHERE ${available} ORDER BY ${newest} LIMIT 4`),
    db.sql(`${catalogSelect} WHERE ${available} AND p.discount=1 AND p.sale_price<p.price ORDER BY ${newest} LIMIT 3`)
  ]);
  return {featured:featured.results,arrivals:arrivals.results,clearance:clearance.results};
}
function featureStatements(db,sku,slot) {
  const statements=[db.sql('DELETE FROM featured_products WHERE sku=? OR slot=?',sku,slot)];
  if (slot) statements.push(db.sql(`INSERT INTO featured_products(slot,sku) VALUES(?,(
    SELECT sku FROM products WHERE sku=? AND state='active' AND price IS NOT NULL))`,slot,sku));
  return statements;
}
async function salesList(db,user,view) {
  const manager = user.role === 'manager';
  const fields = manager ? ',s.order_id,o.customer_id,c.name AS customer_name,s.unit_price,u.email AS employee,(SELECT COALESCE(SUM(r.quantity),0) FROM returns r WHERE r.sale_id=s.id) AS returned' : '';
  const joins = manager ? 'LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN customers c ON c.id=o.customer_id' : '';
  const filter = !manager ? 'WHERE s.submitted_by=?' :
    view==='pending' ? "WHERE s.status='pending'" : view==='legacy' ? "WHERE s.status='approved' AND s.order_id IS NULL" : '';
  const params = manager ? [] : [user.id];
  const sales = await db.all(`SELECT s.id,s.sku,s.quantity,s.sold_on,s.status,s.submitted_at,p.name${fields}
    FROM sales s JOIN products p ON p.sku=s.sku JOIN users u ON u.id=s.submitted_by
    ${joins} ${filter} ORDER BY s.status='pending' DESC,s.submitted_at DESC,s.id LIMIT 100`,...params);
  const notes = await db.all(`SELECT n.sale_id,n.note,n.created_at FROM sale_notes n JOIN sales s ON n.sale_id=s.id
    ${filter} ORDER BY n.created_at DESC LIMIT 500`,...params);
  for (const sale of sales) sale.notes = notes.filter(note => note.sale_id === sale.id);
  return sales;
}
async function closePendingOrder(db,user,items,customer,today) {
  assert(Array.isArray(items) && items.length>0 && items.length<=20,'Select between 1 and 20 pending sale lines.');
  const ids = items.map(item=>clean(item.id,80));
  assert(new Set(ids).size===ids.length,'Select each sale line only once.');
  const placeholders = ids.map(()=>'?').join(',');
  const pending = await db.all(`SELECT * FROM sales WHERE status='pending' AND id IN (${placeholders})`,...ids);
  assert(pending.length===ids.length,'A sale is no longer pending. Refresh and try again.',409);
  const order = id();
  const lines = items.map((item,index)=>{
    const sale = pending.find(row=>row.id===ids[index]);
    const quantity = units(item.quantity ?? sale.quantity);
    const unitPrice = money(item.unit_price);
    assert(quantity>0,'Enter at least one unit per line.');
    assert(unitPrice!==null,'Enter the actual selling price for each line.');
    return {id:sale.id,sku:skuOf(item.sku || sale.sku),quantity,unitPrice,
      soldOn:transactionDay(item.sold_on,today,sale.sold_on),note:clean(item.note,2000)};
  });
  const soldOn = lines[0].soldOn;
  assert(lines.every(line=>line.soldOn===soldOn),'All items in an order must use the same sale date.');
  // The database rechecks every line inside the write batch. A concurrent closeout rolls back this entire order.
  const statements = [db.sql(`INSERT INTO orders(id,customer_id,sold_on,closed_by) VALUES(
    CASE WHEN (SELECT COUNT(*) FROM sales WHERE status='pending' AND id IN (${placeholders}))=? THEN ? END,?,?,?)`,
    ...ids,ids.length,order,customer,soldOn,user.id)];
  for (const line of lines) {
    statements.push(db.sql(`UPDATE sales SET sku=?,quantity=?,sold_on=?,unit_price=?,order_id=?,status='approved',
      reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,line.sku,line.quantity,line.soldOn,line.unitPrice,order,user.id,line.id),
      audit(db,user,'sale.approved',line.id,line.note));
    if (line.note) statements.push(db.sql('INSERT INTO sale_notes(id,sale_id,actor,note) VALUES(?,?,?,?)',id(),line.id,user.id,line.note));
  }
  statements.push(audit(db,user,'order.closed',order));
  await db.batch(statements);
  return order;
}
async function assignCustomerToSale(db,user,saleId,customer) {
  const sale = await db.one("SELECT id,order_id,sold_on FROM sales WHERE id=? AND status='approved'",saleId);
  assert(sale,'Approved sale unavailable.',404);
  const order = sale.order_id ?? id();
  const statements = sale.order_id
    ? [db.sql('UPDATE orders SET customer_id=? WHERE id=?',customer,order)]
    : [db.sql(`INSERT INTO orders(id,customer_id,sold_on,closed_by) VALUES(
      CASE WHEN (SELECT order_id FROM sales WHERE id=?) IS NULL THEN ? END,?,?,?)`,saleId,order,customer,sale.sold_on,user.id),
      db.sql('UPDATE sales SET order_id=? WHERE id=?',order,saleId)];
  await db.batch([...statements,audit(db,user,'order.customer',order)]);
  return order;
}
async function resolveImport(db,user,rowId,input,today) {
  const row = await db.one('SELECT * FROM import_rows WHERE id=?',rowId);
  assert(row,'Draft not found.',404);
  if (row.approved_at) return json({alreadyApplied:true});
  const draft = JSON.parse(row.payload);
  const merged = {...draft,...input};
  const item = await productPayload(db,merged);
  const sku = draft.sku ? skuOf(draft.sku) : merged.sku ? skuOf(merged.sku) : 'LM-'+id().slice(0,8).toUpperCase();
  const exists = await db.one('SELECT p.state,p.sale_price,p.discount,s.on_hand FROM products p JOIN stock s USING(sku) WHERE p.sku=?',sku);
  const action = input.action;
  assert(exists ? ['update','receive'].includes(action) : action === 'create',
    exists ? 'That SKU exists. Choose update listing or receive stock.' : 'Choose create for this new SKU.');
  const state = input.publish ? 'active' : exists?.state ?? 'draft';
  const quantity = action === 'update' ? 0 : units(merged.quantity,true);
  const cost = action === 'update' ? null : money(merged.unit_cost);
  const receivedOn = action === 'update' ? null : date(merged.received_on,true);
  if (receivedOn) transactionDay(receivedOn,today);
  assert(action !== 'receive' || quantity > 0,'Enter the quantity to receive.');
  assert(action !== 'create' || !input.publish || quantity > 0,'Enter opening stock before publishing.');
  if (action==='create' && quantity) assert(cost!=null,'Enter the cost per unit.');
  if (action!=='receive') validateListing(item,state,exists,quantity);
  const writes = [db.sql('INSERT INTO applied_imports VALUES(?)',rowId)];
  if (action !== 'receive') writes.push(...saveProduct(db,sku,item,state,exists));
  if (action !== 'update') writes.push(...addStock(db,user,sku,quantity,cost,receivedOn,today,'CSV import'));
  if (action !== 'receive') writes.push(...await photoStatements(db,{id:row.importer},draft.photos ?? [],sku));
  writes.push(db.sql("UPDATE import_rows SET approved_at=CURRENT_TIMESTAMP,payload=json_set(payload,'$.sku',?) WHERE id=?",sku,rowId),
    audit(db,user,'import.approve',sku,action));
  await db.batch(writes);
  return json({sku});
}
async function api(request,env,db,url) {
  const {pathname:path} = url;
  const method = request.method;
  const today = dayInZone(env.STORE_TIME_ZONE ?? 'America/Guyana');
  if (!['GET','HEAD'].includes(method)) assert(request.headers.get('Origin') === url.origin,'Invalid request origin.',403);
  const authEnabled = Boolean(env.BETTER_AUTH_SECRET);
  const auth = authEnabled && (path.startsWith('/api/auth/') || path.startsWith('/api/staff/'))
    ? buildAuth(env,db,url.origin) : null;
  if (path === '/api/auth/sign-in/magic-link' && method === 'POST') {
    assert(auth,'Staff sign-in is not configured.',503);
    await seedAdmin(env,db);
    return auth.handler(request);
  }
  if ((path === '/api/auth/magic-link/verify' && method === 'GET') ||
      (path === '/api/auth/sign-out' && method === 'POST')) {
    assert(auth,'Staff sign-in is not configured.',503);
    return auth.handler(request);
  }
  if (path === '/api/meta' && method === 'GET') {
    return json({categories:await db.all('SELECT * FROM categories ORDER BY id'),
      currency:env.STORE_CURRENCY ?? 'GYD',whatsapp:env.STORE_WHATSAPP ?? '5926366630',today});
  }
  if (path === '/api/catalog' && method === 'GET') return json(await catalog(db,url,null));
  if (path === '/api/shop-home' && method === 'GET') return json(await shopHome(db));
  const product = path.match(/^\/api\/product\/([^/]+)$/);
  if (product && method === 'GET') return json(await itemDetail(db,skuOf(decodeURIComponent(product[1])),null));
  if (path === '/api/events' && method === 'POST') {
    const input = await request.json();
    const sku = skuOf(input.sku);
    assert(['view','whatsapp'].includes(input.kind),'Invalid event.');
    const allowed = await db.one(`SELECT p.sku FROM products p JOIN stock s ON s.sku=p.sku WHERE p.sku=? AND ${publicStock}`,sku);
    if (allowed) await db.run('INSERT INTO events(sku,day,kind) VALUES(?,?,?) ON CONFLICT DO UPDATE SET total=total+1',sku,today,input.kind);
    return json({});
  }
  const photo = path.match(/^\/api\/photo\/([a-f0-9-]+)$/);
  if (photo && method === 'GET') {
    const photoAuth = authEnabled && request.headers.get('Cookie') ? buildAuth(env,db,url.origin) : null;
    const user = photoAuth ? await staffSession(request,photoAuth,db) : null;
    return getPhoto(env,db,user,photo[1]);
  }
  if (!path.startsWith('/api/staff/')) throw new HttpError(404,'Page not found.');
  assert(auth,'Staff sign-in is not configured.',503);
  const user = await staffSession(request,auth,db);
  assert(user,'Sign in to open the staff workspace.',401);
  if (path === '/api/staff/me' && method === 'GET') return json({...user,staff_whatsapp:env.STAFF_WHATSAPP || ''});
  if (path === '/api/staff/catalog' && method === 'GET') return json(await catalog(db,url,user));
  if (path === '/api/staff/recent' && method === 'GET') return json(await db.all(
    'SELECT p.sku,p.name FROM recent r JOIN products p ON p.sku=r.sku WHERE r.user_id=? AND p.state=\'active\' ORDER BY r.seen_at DESC LIMIT 8',user.id));
  const staffItem = path.match(/^\/api\/staff\/product\/([^/]+)$/);
  if (staffItem && method === 'GET') return json(await itemDetail(db,skuOf(decodeURIComponent(staffItem[1])),user));
  if (path === '/api/staff/photos' && method === 'POST') return uploadPhoto(request,env,db,user);
  if (path === '/api/staff/sales' && method === 'GET') return json(await salesList(db,user,url.searchParams.get('view')));
  if (path === '/api/staff/sales' && method === 'POST') {
    const input = await request.json();
    const sku = skuOf(input.sku);
    const quantity = units(input.quantity);
    const soldOn = transactionDay(input.sold_on,today);
    assert(quantity > 0,'Enter at least one unit.');
    assert(await db.one("SELECT 1 FROM products WHERE sku=? AND state='active'",sku),'That product is unavailable.',404);
    const sale = id();
    const statements = [db.sql('INSERT INTO sales(id,sku,quantity,sold_on,submitted_by) VALUES(?,?,?,?,?)',sale,sku,quantity,soldOn,user.id)];
    if (input.direct) requireManager(user);
    const approve = user.role === 'manager';
    const priceChanged = !approve && (input.price_changed === true || input.price_changed === 'yes');
    const note = clean(input.note,2000);
    assert(!priceChanged || note,'Explain the price adjustment for the manager.');
    if (note) statements.push(db.sql('INSERT INTO sale_notes(id,sale_id,actor,note) VALUES(?,?,?,?)',
      id(),sale,user.id,priceChanged ? `Price adjustment requested: ${note}` : note));
    if (approve) {
      const customer = await customerId(db,input.customer_id);
      const order = id();
      statements.push(db.sql('INSERT INTO orders(id,customer_id,sold_on,closed_by) VALUES(?,?,?,?)',order,customer,soldOn,user.id),
        db.sql("UPDATE sales SET order_id=?,status='approved',unit_price=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
          order,money(input.unit_price),user.id,sale),
        audit(db,user,'order.closed',order));
    }
    statements.push(audit(db,user,approve ? 'sale.direct' : 'sale.submit',sale));
    await db.batch(statements);
    return json({id:sale},201);
  }
  const saleNote = path.match(/^\/api\/staff\/sales\/([a-f0-9-]+)\/notes$/);
  if (saleNote && method === 'POST') {
    const note = clean((await request.json()).note,2000);
    assert(note,'Enter a note.');
    const result = await db.run(`INSERT INTO sale_notes(id,sale_id,actor,note)
      SELECT ?,s.id,?,? FROM sales s WHERE s.id=? AND s.status='pending' AND (s.submitted_by=? OR ?='manager')`,
      id(),user.id,note,saleNote[1],user.id,user.role);
    assert(result.meta.changes,'This pending sale is unavailable.',404);
    return json({});
  }
  if (path === '/api/staff/issues' && method === 'POST') {
    const input = await request.json();
    const sku = skuOf(input.sku);
    const note = clean(input.note,2000);
    assert(note,'Describe the issue.');
    assert(await db.one("SELECT 1 FROM products WHERE sku=? AND state='active'",sku),'That product is unavailable.',404);
    const issue = id();
    await db.batch([db.sql('INSERT INTO issues(id,sku,note,submitted_by) VALUES(?,?,?,?)',issue,sku,note,user.id),
      ...await photoStatements(db,user,input.photos ?? [],null,issue),audit(db,user,'issue.submit',issue)]);
    return json({id:issue},201);
  }

  requireManager(user);
  const deletion=path.match(/^\/api\/staff\/(product|customers)\/([A-Za-z0-9_-]+)\/delete$/);
  if (deletion) {
    const kind=deletion[1]==='product'?'product':'customer';
    const key=kind==='product'?skuOf(deletion[2]):deletion[2];
    if (method==='GET') return json(await deletionPreview(db,kind,key));
    if (method==='POST') return json(await deleteRecord(db,env,user,kind,key,await request.json()));
  }
  const customerRoute = path.match(/^\/api\/staff\/customers\/([a-f0-9-]+)$/);
  const orderRoute = path.match(/^\/api\/staff\/orders\/([a-f0-9-]+)$/);
  if (path === '/api/staff/customers' && method === 'GET') return json(await searchCustomers(db,url));
  if (customerRoute && method === 'GET') return json(await customerDetail(db,customerRoute[1]));
  if (path === '/api/staff/orders' && method === 'GET') return json(await listOrders(db,url));
  if (path === '/api/staff/returns' && method === 'GET') return json(await listReturns(db,url));
  if (path === '/api/staff/attention' && method === 'GET') {
    return json(await db.one("SELECT COUNT(*) AS pending FROM sales WHERE status='pending'"));
  }
  if (orderRoute && method === 'GET') return json(await orderDetail(db,orderRoute[1]));
  if (path === '/api/staff/dashboard' && method === 'GET') return json(await dashboard(db,url,today));
  if (path === '/api/staff/issues' && method === 'GET') {
    const select=`SELECT i.*,p.name,(SELECT group_concat(id) FROM photos WHERE issue_id=i.id) photos
      FROM issues i JOIN products p ON p.sku=i.sku`;
    const order=' ORDER BY i.resolved_at IS NOT NULL,i.created_at DESC,i.id';
    if (url.searchParams.get('report')!=='1') return json(await db.all(select+order+' LIMIT 100'));
    const status=url.searchParams.get('status');
    const productType=Number(url.searchParams.get('type'))||null;
    const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page')??'1',10)||1));
    const size=25;
    const where=` WHERE (? IS NULL OR p.type_id=?)${status==='open'?' AND i.resolved_at IS NULL':
      status==='resolved'?' AND i.resolved_at IS NOT NULL':''}`;
    const filters=[productType,productType];
    const [items,counts]=await Promise.all([
      db.all(select+where+order+' LIMIT ? OFFSET ?',...filters,size+1,(page-1)*size),
      db.one(`SELECT count(*) AS total, count(*) FILTER(WHERE i.resolved_at IS NULL) AS open,
        count(i.resolved_at) AS resolved FROM issues i JOIN products p ON p.sku=i.sku`+where,...filters)
    ]);
    return json({items:items.slice(0,size),counts,page,next:items.length>size});
  }
  if (path === '/api/staff/team' && method === 'GET') {
    return json(await db.all('SELECT email,role,active FROM users ORDER BY role DESC,email'));
  }
  if (path === '/api/staff/imports' && method === 'GET') {
    const imports = await db.all(`SELECT i.id,i.payload,i.created_at,i.approved_at,p.sku AS existing_sku FROM import_rows i LEFT JOIN products p ON p.sku=json_extract(i.payload,'$.sku') WHERE i.approved_at IS NULL ORDER BY i.created_at DESC LIMIT 500`);
    return json(imports.map(row=>({...row,payload:JSON.parse(row.payload)})));
  }
  if (method !== 'POST') throw new HttpError(404,'Page not found.');
  const input = await request.json();
  if (path === '/api/staff/customers') return json(await createCustomer(db,input),201);
  if (path === '/api/staff/orders') {
    const customer = await customerId(db,input.customer_id);
    return json({order_id:await closePendingOrder(db,user,input.items,customer,today)},201);
  }
  const customerAssignment = path.match(/^\/api\/staff\/sales\/([a-f0-9-]+)\/customer$/);
  if (customerAssignment) {
    const customer = await customerId(db,input.customer_id);
    return json({order_id:await assignCustomerToSale(db,user,customerAssignment[1],customer)});
  }
  if (path === '/api/staff/team') {
    const email = emailOf(input.email);
    assert(email !== user.email,'Your own access is managed by the account setup.');
    const existing = await db.one('SELECT role FROM users WHERE email=?',email);
    assert(existing?.role !== 'manager','The administrator account cannot be changed here.');
    await db.batch([db.sql(`INSERT INTO users(id,email,role,active) VALUES(?,?,'employee',?)
      ON CONFLICT(email) DO UPDATE SET active=excluded.active`,id(),email,input.disable ? 0 : 1),
      audit(db,user,input.disable?'team.revoke':'team.invite',email)]);
    if (input.disable) {
      await db.run('DELETE FROM "session" WHERE userId IN (SELECT id FROM "user" WHERE email=?)',email);
      return json({});
    }
    try {
      await auth.api.signInMagicLink({headers:request.headers,body:{email,callbackURL:'/staff'}});
      return json({sent:true});
    } catch (error) {
      console.error('Invitation delivery failed',error.message);
      return json({sent:false,error:'Access was enabled, but the email could not be sent. Resend the invitation after checking email setup.'},502);
    }
  }
  if (path === '/api/staff/categories') {
    const name = clean(input.name,80);
    assert(name && ['audience','type'].includes(input.kind),'Enter a name and category level.');
    if (input.id) await db.run('UPDATE categories SET name=? WHERE id=? AND kind=?',name,Number(input.id),input.kind);
    else await db.run('INSERT INTO categories(kind,name) VALUES(?,?)',input.kind,name);
    return json({});
  }
  const featured = path.match(/^\/api\/staff\/product\/([A-Za-z0-9_-]+)\/featured$/);
  if (featured) {
    const sku=skuOf(featured[1]);
    const slot=Number(input.slot);
    assert([0,1,2,3].includes(slot),'Choose a featured position.');
    const item=await db.one('SELECT state,price FROM products WHERE sku=?',sku);
    assert(item,'Product unavailable.',404);
    if (slot) assert(item.state==='active' && item.price!=null,'Publish the item before featuring it.',409);
    const writes=[...featureStatements(db,sku,slot),audit(db,user,'product.featured',sku,String(slot))];
    try { await db.batch(writes); }
    catch (error) {
      if (String(error.message).includes('NOT NULL constraint failed: featured_products.sku')) {
        throw new HttpError(409,'The item is no longer active. Refresh and try again.');
      }
      throw error;
    }
    return json({sku,slot});
  }
  const clearance = path.match(/^\/api\/staff\/product\/([A-Za-z0-9_-]+)\/clearance$/);
  if (clearance) {
    const sku=skuOf(clearance[1]);
    const product=await db.one('SELECT price,state FROM products WHERE sku=?',sku);
    assert(product,'Product unavailable.',404);
    assert(input.remove===true || product.state==='active','Only active items can be put on clearance.',409);
    const reduced=input.remove===true?null:money(input.clearance_price);
    assert(input.remove===true || (reduced!=null && product.price!=null && reduced<product.price),
      'Enter a clearance price below the selling price.');
    const [result]=await db.batch([
      db.sql(`UPDATE products SET sale_price=?,discount=? WHERE sku=? AND (? IS NULL OR (state='active' AND price>?))`,
        reduced,reduced===null?0:1,sku,reduced,reduced),
      audit(db,user,reduced===null?'product.clearance.end':'product.clearance.set',sku)
    ]);
    assert(result.meta.changes,'The listing status or selling price changed. Refresh and try again.',409);
    return json({sku});
  }
  if (path === '/api/staff/product') {
    const existingSku = input.existing_sku ? skuOf(input.existing_sku) : null;
    const sku = existingSku ?? (input.sku ? skuOf(input.sku) : 'LM-'+id().slice(0,8).toUpperCase());
    const existing = await db.one(`SELECT p.state,p.sale_price,p.discount,s.on_hand,
      EXISTS(SELECT 1 FROM batches b WHERE b.sku=p.sku) AS has_stock_history
      FROM products p JOIN stock s USING(sku) WHERE p.sku=?`,sku);
    assert(existingSku ? existing : !existing, existingSku ? 'Product unavailable.' : 'This SKU already exists.',409);
    const item = await productPayload(db,input);
    if (input.personal_note !== undefined) item.personalNote=clean(input.personal_note,4000);
    const state = input.state ?? 'draft';
    assert(['draft','active','archived'].includes(state),'Select a listing status.');
    const featuredSlot=Number(input.featured_slot??0);
    assert([0,1,2,3].includes(featuredSlot),'Choose a featured position.');
    assert(!featuredSlot || (!existing && state==='active'),'Choose a featured position on a new active listing.',409);
    const openingQuantity=units(input.quantity,true)??0;
    const unitCost=money(input.unit_cost);
    if (openingQuantity) {
      assert(!existing?.has_stock_history,'Starting stock is already recorded for this SKU.',409);
      assert(unitCost!=null,'Enter the cost per unit.');
    }
    validateListing(item,state,existing,openingQuantity);
    const statements = [...saveProduct(db,sku,item,state,existing),
      ...addStock(db,user,sku,openingQuantity,unitCost,today,today,null,`opening:${sku}`),
      ...await photoStatements(db,user,input.photos ?? [],sku)];
    if (featuredSlot) statements.push(...featureStatements(db,sku,featuredSlot),audit(db,user,'product.featured',sku,String(featuredSlot)));
    if (Array.isArray(input.remove_photos)) {
      for (const image of input.remove_photos.slice(0,100)) statements.push(db.sql('DELETE FROM photos WHERE id=? AND sku=?',image,sku));
    }
    if (Array.isArray(input.photo_order) && input.photo_order.length) {
      statements.push(db.sql(`WITH requested AS (
        SELECT value AS id, MIN(key) AS priority FROM json_each(?) GROUP BY value
      ), ranked AS MATERIALIZED (
        SELECT p.id, ROW_NUMBER() OVER (ORDER BY r.priority IS NULL,r.priority,p.position,p.id)-1 AS position
        FROM photos p LEFT JOIN requested r ON r.id=p.id WHERE p.sku=?
      ) UPDATE photos SET position=ranked.position FROM ranked WHERE photos.id=ranked.id`,
      JSON.stringify(input.photo_order),sku));
    }
    statements.push(audit(db,user,existing ? 'product.update' : 'product.create',sku,state));
    await db.batch(statements);
    return json({sku});
  }
  if (path === '/api/staff/receipts') {
    const sku = skuOf(input.sku);
    const count = units(input.quantity);
    assert(count > 0,'Enter at least one unit.');
    assert(await db.one('SELECT 1 FROM products WHERE sku=?',sku),'Product unavailable.',404);
    const received = transactionDay(date(input.received_on,true)??today,today);
    await db.batch([...addStock(db,user,sku,count,money(input.unit_cost),received,today,clean(input.note,500)),
      audit(db,user,'stock.receive',sku,String(count))]);
    return json({});
  }
  if (path === '/api/staff/adjustments') {
    const batch = await db.one('SELECT * FROM batch_balances WHERE id=?',input.batch ?? '');
    assert(batch,'Batch unavailable.',404);
    const count = units(input.quantity);
    assert(count>0,'Enter at least one unit.');
    assert(['add','remove'].includes(input.direction),'Select a stock change.');
    const reason = input.reason;
    assert(['damaged','missing','miscount','other'].includes(reason),'Select an adjustment reason.');
    const details = clean(input.note,500);
    assert(reason!=='other' || details,'Enter details for this adjustment.');
    const change = input.direction==='add' ? count : -count;
    await db.batch([db.sql("INSERT INTO movements(id,batch_id,kind,qty,effective_on,actor,reason,note) VALUES(?,?,'adjust',?,?,?,?,?)",
      id(),batch.id,change,today,user.id,reason,details||null),
      audit(db,user,'stock.adjust',batch.sku,`${change} · ${reason}${details ? ` · ${details}` : ''}`)]);
    return json({});
  }
  const review = path.match(/^\/api\/staff\/sales\/([a-f0-9-]+)\/review$/);
  if (review) {
    const sale = await db.one('SELECT * FROM sales WHERE id=? AND status=\'pending\'',review[1]);
    assert(sale,'This sale is no longer pending.',409);
    assert(['approved','canceled','pending'].includes(input.status),'Select a review action.');
    if (input.status==='approved') {
      const customer = await customerId(db,input.customer_id);
      return json({order_id:await closePendingOrder(db,user,[{...input,id:sale.id}],customer,today)});
    }
    const sku = input.status === 'canceled' ? sale.sku : skuOf(input.sku || sale.sku);
    const quantity = input.status === 'canceled' ? sale.quantity : units(input.quantity ?? sale.quantity);
    assert(quantity > 0,'Enter at least one unit.');
    const soldOn = transactionDay(input.sold_on,today,sale.sold_on);
    const price = money(input.unit_price);
    const result = await db.run(`UPDATE sales SET sku=?,quantity=?,sold_on=?,status=?,unit_price=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='pending'`,sku,quantity,soldOn,input.status,price,user.id,sale.id);
    assert(result.meta.changes,'This sale is no longer pending.',409);
    await db.batch([audit(db,user,'sale.'+input.status,sale.id,clean(input.note,2000)),
      ...(input.note ? [db.sql('INSERT INTO sale_notes(id,sale_id,actor,note) VALUES(?,?,?,?)',
      id(),sale.id,user.id,clean(input.note,2000))] : [])]);
    return json({});
  }
  const returned = path.match(/^\/api\/staff\/sales\/([a-f0-9-]+)\/return$/);
  if (returned) {
    const sale = await db.one("SELECT * FROM sales WHERE id=? AND status='approved'",returned[1]);
    assert(sale,'Approved sale unavailable.',404);
    const reason = clean(input.note,2000);
    assert(reason,'Enter a return reason.');
    const when = transactionDay(input.returned_on,today);
    assert(when >= sale.sold_on,'Return date cannot precede the sale.');
    const quantity = units(input.quantity ?? sale.quantity);
    assert(quantity>0,'Enter at least one unit.');
    const refund = money(input.refund) ?? quantity*sale.unit_price;
    await db.batch([db.sql('INSERT INTO returns VALUES(?,?,?,?,?,?,?,?)',
      id(),sale.id,when,input.restock ? 1 : 0,reason,user.id,quantity,refund),audit(db,user,'sale.return',sale.id,reason)]);
    return json({});
  }
  const issue = path.match(/^\/api\/staff\/issues\/([a-f0-9-]+)\/resolve$/);
  if (issue) {
    const report = await db.one('SELECT * FROM issues WHERE id=? AND resolved_at IS NULL',issue[1]);
    assert(report,'This issue is no longer open.',409);
    const reason = clean(input.note,2000);
    assert(reason,'Enter a resolution.');
    await db.batch([db.sql('UPDATE issues SET resolution=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND resolved_at IS NULL',
      reason,user.id,report.id),audit(db,user,'issue.resolve',report.id,reason)]);
    return json({});
  }
  if (path === '/api/staff/imports') {
    const key = clean(input.key,100);
    assert(/^[a-f0-9]{64}$/.test(key),'Invalid import row.');
    const draft = input.payload;
    const sku = draft.sku ? skuOf(draft.sku) : '';
    await productPayload(db,draft);
    units(draft.quantity,true);
    if (draft.received_on) transactionDay(draft.received_on,today);
    await photoStatements(db,user,draft.photos ?? [],null);
    const rowId = await hashToken(user.id+':'+key);
    await db.run('INSERT OR IGNORE INTO import_rows(id,importer,payload) VALUES(?,?,?)',rowId,user.id,JSON.stringify({...draft,sku}));
    return json({id:rowId});
  }
  const importRow = path.match(/^\/api\/staff\/imports\/([a-f0-9]+)\/approve$/);
  if (importRow) return resolveImport(db,user,importRow[1],input,today);
  throw new HttpError(404,'Page not found.');
}

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request,env,access(env),url);
      if (url.pathname === '/' || url.pathname === '/staff' || /^\/products\/[^/]+$/.test(url.pathname)) {
        const response = await env.ASSETS.fetch(new Request(new URL('/index.html',url.origin),request));
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
        headers.set('Referrer-Policy','strict-origin-when-cross-origin');
        return new Response(response.body,{status:response.status,headers});
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) return json({error:error.message},error.status);
      if (error instanceof SyntaxError) return json({error:'Invalid request data.'},400);
      const message = String(error.message);
      for (const readable of ['Insufficient available stock','Insufficient batch stock','Reserved stock cannot be removed','Enter the actual selling price','Return exceeds the remaining sold quantity']) {
        if (message.includes(readable)) return json({error:readable+'.'},409);
      }
      if (message.includes('NOT NULL constraint failed: orders.id')) return json({error:'The sale changed. Refresh and try again.'},409);
      if (message.includes('CHECK constraint failed: price>=0')) return json({error:'The clearance price changed. Refresh and try again.'},409);
      if (message.includes('UNIQUE constraint failed')) return json({error:'This record already exists. Refresh and try again.'},409);
      console.error(message);
      return json({error:message.includes('no such table') ? migrationsHint : 'The request could not be completed.'},500);
    }
  }
};
