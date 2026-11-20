import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { draftRows, parseCSV } from '../public/csv.js';
import { date, dayInZone, money, skuOf } from '../src/helpers.js';
import { dashboard } from '../src/dashboard.js';
import { createCustomer, listOrders, orderDetail, searchCustomers } from '../src/customers.js';

function database() {
  const db=new DatabaseSync(':memory:');
  for (const file of ['0001_inventory.sql','0002_better_auth.sql','0003_customer_orders.sql','0004_product_themes.sql']) {
    db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  db.exec(`INSERT INTO users VALUES('manager','admin@example.com','manager',1),('employee','staff@example.com','employee',1);
    INSERT INTO products(sku,name,price,state) VALUES('LM15','Brown bear mug',150000,'active');
    INSERT INTO batches(id,sku,received_on,cost) VALUES('old','LM15','2026-01-01',90000),('new','LM15','2026-01-30',100000);
    INSERT INTO movements(id,batch_id,kind,qty,effective_on) VALUES
      ('old-in','old','receive',1,'2026-01-01'),('new-in','new','receive',2,'2026-01-30');`);
  return db;
}
test('stock reservation, duplicate approval, lot cost and dated return',()=>{
  const db=database();
  const insert=db.prepare("INSERT INTO sales(id,sku,quantity,sold_on,submitted_by) VALUES(?,'LM15',?,'2026-01-31','employee')");
  insert.run('s1',2);
  assert.deepEqual({...db.prepare('SELECT * FROM stock').get()},{sku:'LM15',on_hand:3,reserved:2});
  assert.throws(()=>insert.run('s2',2),/Insufficient available/);
  insert.run('s2',1);
  assert.throws(()=>insert.run('s3',1),/Insufficient available/);
  db.exec("UPDATE sales SET status='canceled' WHERE id='s2'");
  assert.throws(()=>db.exec("UPDATE sales SET status='approved' WHERE id='s1'"),/actual selling price/);
  db.exec("UPDATE sales SET status='approved',unit_price=150000,reviewed_by='manager' WHERE id='s1'");
  db.exec("UPDATE sales SET status='approved' WHERE id='s1'");
  assert.deepEqual({...db.prepare('SELECT * FROM stock').get()},{sku:'LM15',on_hand:1,reserved:0});
  const movements=db.prepare("SELECT batch_id,qty,effective_on FROM movements WHERE kind='sale' ORDER BY batch_id").all().map(row=>({...row}));
  assert.deepEqual(movements,[{batch_id:'new',qty:-1,effective_on:'2026-01-31'},{batch_id:'old',qty:-1,effective_on:'2026-01-31'}]);
  db.exec("INSERT INTO returns VALUES('r1','s1','2026-02-03',1,'Returned','manager',1,150000)");
  assert.equal(db.prepare('SELECT on_hand FROM stock').get().on_hand,2);
  assert.throws(()=>db.exec("INSERT INTO returns VALUES('r2','s1','2026-02-03',1,'Duplicate','manager',2,300000)"),/remaining sold quantity/);
  db.exec("INSERT INTO returns VALUES('r3','s1','2026-02-03',1,'Returned','manager',1,150000)");
  assert.equal(db.prepare('SELECT on_hand FROM stock').get().on_hand,3);
});
test('CSV supports quoted descriptions and duplicate or missing photos are flagged',()=>{
  const rows=parseCSV('\uFEFFsku,name,description,categories,subcategory,quantity,unit_cost,price,image_files\r\n'+
    'lm15,Brown mug,"Brown, with ""ears""",Men,Mugs,2,900,1500,a.jpg|b.jpg\r\n'+
    'LM15,Bear mug,test,Men,Mugs,1,900,1500,a.jpg');
  const result=draftRows(rows,[{name:'a.jpg'}],[{id:1,kind:'audience',name:'Men'},{id:5,kind:'type',name:'Mugs'}]);
  assert.equal(result[0].payload.description,'Brown, with "ears"');
  assert.equal(result[0].payload.type_id,5);
  assert.equal(result[0].payload.themes,undefined);
  assert.match(result[0].errors.join(' '),/Missing photo b.jpg/);
  assert.match(result[0].errors.join(' '),/Duplicate SKU/);
  assert.match(result[1].errors.join(' '),/Duplicate SKU/);
  assert.throws(()=>parseCSV('name\n"unterminated'),/unclosed quote/);
});
test('stock and pricing validators preserve input meaning',()=>{
  assert.equal(money('1500.20'),150020);
  assert.throws(()=>money('1,500.20'));
  assert.throws(()=>date('2026-02-30'));
  assert.equal(skuOf(' lm15 '),'LM15');
  assert.equal(dayInZone('America/Guyana',new Date('2026-11-20T01:00:00Z')),'2026-11-19');
});

test('customer search, grouped order history and returns count each line once',async()=>{
  const sqlite=database();
  const db={
    async one(query,...params) { return sqlite.prepare(query).get(...params); },
    async all(query,...params) { return sqlite.prepare(query).all(...params); },
    async run(query,...params) { return sqlite.prepare(query).run(...params); }
  };
  const customer=await createCustomer(db,{name:'Alex Customer',phone:'+592 (555) 0199',email:'Alex@Example.com'});
  await assert.rejects(()=>createCustomer(db,{name:'Duplicate',phone:'5925550199'}),/already uses/);
  for(const q of ['Alex','555-0199','alex@example.com']) {
    const results=await searchCustomers(db,new URL('https://shop.test/?'+new URLSearchParams({q})));
    assert.equal(results.items[0].id,customer.id);
  }
  sqlite.prepare("INSERT INTO orders(id,customer_id,sold_on,closed_by) VALUES('o1',?,'2026-01-31','manager')").run(customer.id);
  sqlite.exec(`INSERT INTO sales(id,sku,quantity,sold_on,submitted_by,order_id) VALUES
    ('s1','LM15',1,'2026-01-31','employee','o1'),('s2','LM15',2,'2026-01-31','employee','o1');
    UPDATE sales SET status='approved',unit_price=150000 WHERE id IN ('s1','s2');
    INSERT INTO returns VALUES('r1','s2','2026-02-03',1,'Returned','manager',1,150000),
                              ('r2','s2','2026-02-05',0,'Returned','manager',1,100000);`);
  const history=await listOrders(db,new URL('https://shop.test/?customer='+customer.id));
  assert.equal(history.items.length,1);
  assert.equal(history.items[0].line_count,2);
  assert.equal(history.items[0].gross,450000);
  assert.equal(history.items[0].refunds,250000);
  const detail=await orderDetail(db,'o1');
  assert.equal(detail.lines.find(line=>line.id==='s2').returns.length,2);
  assert.equal(sqlite.prepare('SELECT on_hand FROM stock').get().on_hand,1);
});

test('theme reporting groups distinct sold-out SKUs across periods',async()=>{
  const sqlite=database();
  sqlite.exec(`INSERT INTO products(sku,name,price,state) VALUES('LM16','Owl mug',180000,'active');
    INSERT INTO batches(id,sku,received_on,cost) VALUES('owl','LM16','2026-02-01',95000);
    INSERT INTO movements(id,batch_id,kind,qty,effective_on) VALUES('owl-in','owl','receive',1,'2026-02-01');
    INSERT INTO product_themes VALUES('LM15','animal mugs','Animal mugs'),('LM16','animal mugs','animal mugs');
    INSERT INTO sales(id,sku,quantity,sold_on,submitted_by) VALUES
      ('s1','LM15',2,'2026-02-11','employee'),('s2','LM16',1,'2026-02-12','employee'),('s3','LM15',1,'2026-01-10','employee');
    UPDATE sales SET status='approved',unit_price=150000;`);
  assert.ok(sqlite.prepare('SELECT * FROM stock').all().every(row=>row.on_hand===0));
  const db={
    async one(query,...params) { return sqlite.prepare(query).get(...params); },
    async all(query,...params) { return sqlite.prepare(query).all(...params); }
  };
  const result=await dashboard(db,new URL('https://shop.test/?start=2026-02-01&end=2026-02-28&summary=1'),'2026-02-28');
  assert.deepEqual(result.themeTrends.map(row=>({...row})),[{name:'Animal mugs',units:3,previous:1,change:2,sku_count:2}]);
});
