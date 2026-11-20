import { assert, clean, emailOf } from './helpers.js';

const orderTotals = `SELECT o.id,o.sold_on,o.customer_id,c.name AS customer_name,
  SUM(s.quantity*s.unit_price) AS gross,
  SUM(COALESCE((SELECT SUM(r.refund) FROM returns r WHERE r.sale_id=s.id),0)) AS refunds,
  COUNT(s.id) AS line_count
  FROM orders o JOIN sales s ON s.order_id=o.id AND s.status='approved'
  LEFT JOIN customers c ON c.id=o.customer_id`;
const orderSort = ' GROUP BY o.id ORDER BY o.sold_on DESC,o.created_at DESC,o.id DESC';

function paging(url) {
  const page = Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page') ?? '1',10) || 1));
  return {page,size:30,offset:(page-1)*30};
}
function paged(rows,pager) {
  return {items:rows.slice(0,pager.size),page:pager.page,next:rows.length>pager.size};
}
export async function searchCustomers(db,url) {
  const pager = paging(url);
  const query = clean(url.searchParams.get('q'));
  const digits = /^[+\d().\s-]+$/.test(query) ? query.replace(/\D/g,'') : '';
  const rows = await db.all(`SELECT id,name,phone,email FROM customers
    WHERE ?='' OR instr(lower(name),lower(?))>0 OR instr(lower(COALESCE(email,'')),lower(?))>0
    OR (?<>'' AND instr(COALESCE(phone_digits,''),?)>0)
    ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?`,query,query,query,digits,digits,pager.size+1,pager.offset);
  return paged(rows,pager);
}
export async function createCustomer(db,input) {
  const name = clean(input.name,120);
  assert(name,'Enter the customer’s name.');
  const phone = clean(input.phone,32) || null;
  const digits = phone?.replace(/\D/g,'') ?? null;
  assert(!phone || (/^[+\d().\s-]+$/.test(phone) && digits.length>=5 && digits.length<=20),'Enter a valid phone number.');
  const email = clean(input.email) ? emailOf(input.email) : null;
  const existing = await db.one('SELECT 1 FROM customers WHERE phone_digits=? OR email=?',digits,email);
  assert(!existing,'A customer already uses that phone or email. Find them with customer search.',409);
  const id = crypto.randomUUID();
  await db.run('INSERT INTO customers(id,name,phone,phone_digits,email) VALUES(?,?,?,?,?)',id,name,phone,digits,email);
  return {id,name,phone,email};
}
export async function customerId(db,value) {
  if (value == null || value === '') return null;
  const id = clean(value,80);
  assert(await db.one('SELECT id FROM customers WHERE id=?',id),'Customer unavailable.',404);
  return id;
}
export async function listOrders(db,url) {
  const pager = paging(url);
  const customer = await customerId(db,url.searchParams.get('customer'));
  const rows = await db.all(orderTotals + ' WHERE (? IS NULL OR o.customer_id=?)' + orderSort + ' LIMIT ? OFFSET ?',
    customer,customer,pager.size+1,pager.offset);
  return paged(rows,pager);
}
export async function customerDetail(db,id) {
  const customer = await db.one('SELECT id,name,phone,email FROM customers WHERE id=?',id);
  assert(customer,'Customer unavailable.',404);
  return customer;
}
export async function orderDetail(db,id) {
  const order = await db.one(orderTotals + ' WHERE o.id=? GROUP BY o.id',id);
  assert(order,'Order unavailable.',404);
  order.lines = await db.all(`SELECT s.id,s.sku,p.name,s.quantity,s.unit_price FROM sales s
    JOIN products p ON p.sku=s.sku WHERE s.order_id=? AND s.status='approved' ORDER BY s.submitted_at,s.id`,id);
  const returns = await db.all(`SELECT r.sale_id,r.returned_on,r.quantity,r.refund,r.restock
    FROM returns r JOIN sales s ON s.id=r.sale_id WHERE s.order_id=? ORDER BY r.returned_on,r.id`,id);
  for (const line of order.lines) line.returns = returns.filter(entry=>entry.sale_id===line.id);
  return order;
}
