import { assert,date,offsetDay,skuOf } from './helpers.js';

function period(start,end) {
  const days = Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  assert(days > 0 && days <= 3660,'Choose a date range of up to ten years.');
  return {start,end,days};
}
function lastYear(day) {
  const year = Number(day.slice(0,4))-1;
  const monthDay = day.slice(4);
  const equivalent = String(year)+monthDay;
  return monthDay === '-02-29' && new Date(equivalent).toISOString().slice(0,10) !== equivalent
    ? String(year)+'-02-28' : equivalent;
}
async function salesIn(db,span,type) {
  return db.all(`WITH costs AS (
   SELECT m.sale_id,SUM(-m.qty*b.cost) AS cost, SUM(b.cost IS NULL)>0 AS unknown
   FROM movements m JOIN batches b ON b.id=m.batch_id WHERE m.kind='sale' GROUP BY m.sale_id
  ), return_costs AS (
   SELECT a.return_id,SUM(a.quantity*b.cost) AS cost,SUM(b.cost IS NULL)>0 AS unknown
   FROM return_allocations a JOIN movements m ON m.id=a.movement_id JOIN batches b ON b.id=m.batch_id GROUP BY a.return_id
  )
  SELECT s.sold_on AS day,s.sku,p.name,s.quantity,s.quantity*s.unit_price AS revenue,
   CASE WHEN c.unknown=1 THEN NULL ELSE s.quantity*s.unit_price-c.cost END AS profit,0 AS returned,0 AS refund
  FROM sales s JOIN products p ON p.sku=s.sku LEFT JOIN costs c ON c.sale_id=s.id
  WHERE s.status='approved' AND s.sold_on BETWEEN ? AND ? AND (? IS NULL OR p.type_id=?)
  UNION ALL
  SELECT r.returned_on,s.sku,p.name,0,0,
  CASE WHEN r.restock=0 THEN -r.refund WHEN c.unknown=1 THEN NULL ELSE c.cost-r.refund END,
  r.quantity,r.refund
  FROM returns r JOIN sales s ON s.id=r.sale_id JOIN products p ON p.sku=s.sku LEFT JOIN return_costs c ON c.return_id=r.id
  WHERE r.returned_on BETWEEN ? AND ? AND (? IS NULL OR p.type_id=?)`,
  span.start,span.end,type,type,span.start,span.end,type,type);
}
function summarize(rows) {
  return rows.reduce((total,row)=>({
    units:total.units+row.quantity, revenue:total.revenue+row.revenue, returned:total.returned+row.returned,
    refund:total.refund+row.refund, profit:total.profit+(row.profit??0), unknown:total.unknown+Number(row.profit==null)
  }),{units:0,revenue:0,returned:0,refund:0,profit:0,unknown:0});
}
async function productThemeTrends(db,span,prior,type) {
  return db.all(`WITH sku_sales AS (
    SELECT s.sku,
      SUM(CASE WHEN s.sold_on BETWEEN ? AND ? THEN s.quantity ELSE 0 END) AS units,
      SUM(CASE WHEN s.sold_on BETWEEN ? AND ? THEN s.quantity ELSE 0 END) AS previous
    FROM sales s JOIN products p ON p.sku=s.sku
    WHERE s.status='approved' AND (? IS NULL OR p.type_id=?)
      AND (s.sold_on BETWEEN ? AND ? OR s.sold_on BETWEEN ? AND ?)
    GROUP BY s.sku
  )
  SELECT MIN(t.theme) AS name,SUM(s.units) AS units,SUM(s.previous) AS previous,
    SUM(s.units-s.previous) AS change,SUM(s.units>0) AS sku_count
  FROM sku_sales s JOIN product_themes t ON t.sku=s.sku
  GROUP BY t.theme_key ORDER BY units DESC,change DESC,name COLLATE NOCASE`,
  span.start,span.end,prior.start,prior.end,type,type,span.start,span.end,prior.start,prior.end);
}
export async function dashboard(db,url,today) {
  const params = url.searchParams;
  const span = period(date(params.get('start') ?? offsetDay(today,-29)),date(params.get('end') ?? today));
  const summary = params.get('summary')==='1';
  const compare = params.get('compare') || 'previous';
  const prior = compare === 'year' ? period(lastYear(span.start),lastYear(span.end)) :
    period(offsetDay(span.start,-span.days),offsetDay(span.start,-1));
  const type = Number(params.get('type')) || null;
  const closeoutSku = params.get('sku')?.trim() ? skuOf(params.get('sku')) : null;
  const cutoff = offsetDay(today,-90);
  const coverage = await db.one(`SELECT MIN(day) AS since FROM
    (SELECT MIN(date(created_at)) AS day FROM movements UNION ALL SELECT MIN(sold_on) FROM sales WHERE status='approved')`);
  const [sales,former,snapshot,age,attention,interest,themeTrends,closeout] = await Promise.all([
    salesIn(db,span,type),salesIn(db,prior,type),
    db.one(`SELECT COALESCE(SUM(b.on_hand*b.cost),0) AS value,
      COALESCE(SUM(CASE WHEN b.cost IS NULL THEN b.on_hand ELSE 0 END),0) AS unknown_cost,
      COALESCE(SUM(CASE WHEN b.received_on IS NULL THEN b.on_hand ELSE 0 END),0) AS unknown_age,
      COALESCE(SUM(b.on_hand),0) AS units
      FROM batch_balances b JOIN products p ON p.sku=b.sku WHERE b.on_hand>0 AND (? IS NULL OR p.type_id=?)`,type,type),
    db.all(`SELECT b.sku,p.name,SUM(b.on_hand) AS units,SUM(b.on_hand*b.cost) AS value,MIN(b.received_on) AS oldest
      FROM batch_balances b JOIN products p ON p.sku=b.sku WHERE b.on_hand>0 AND b.received_on<? AND (? IS NULL OR p.type_id=?)
      GROUP BY b.sku ORDER BY oldest,b.sku`,cutoff,type,type),
    db.one(`SELECT (SELECT COUNT(*) FROM sales WHERE status='pending') AS pending,
      (SELECT COUNT(*) FROM issues WHERE resolved_at IS NULL) AS issues`),
    db.all(`SELECT p.sku,p.name,p.published_at,s.on_hand-s.reserved AS available,
      COALESCE(SUM(CASE WHEN e.kind='view' THEN e.total ELSE 0 END),0) AS views,
      COALESCE(SUM(CASE WHEN e.kind='whatsapp' THEN e.total ELSE 0 END),0) AS clicks
      FROM products p JOIN stock s ON s.sku=p.sku LEFT JOIN events e ON e.sku=p.sku AND e.day BETWEEN ? AND ?
      WHERE p.state='active' AND s.on_hand>0 AND (? IS NULL OR p.type_id=?) GROUP BY p.sku`,span.start,span.end,type,type),
    productThemeTrends(db,span,prior,type),
    summary ? [] : db.all(`WITH flow AS (
     SELECT b.sku,
      SUM(CASE WHEN m.effective_on<? THEN m.qty ELSE 0 END) opening,
      SUM(CASE WHEN m.effective_on BETWEEN ? AND ? AND m.kind='receive' THEN m.qty ELSE 0 END) received,
      SUM(CASE WHEN m.effective_on BETWEEN ? AND ? AND m.kind='sale' THEN -m.qty ELSE 0 END) sold,
      SUM(CASE WHEN m.effective_on BETWEEN ? AND ? AND m.kind='return' THEN m.qty ELSE 0 END) restocked,
      SUM(CASE WHEN m.effective_on BETWEEN ? AND ? AND m.kind IN ('adjust','damage') THEN m.qty ELSE 0 END) adjusted,
      SUM(CASE WHEN m.effective_on<=? THEN m.qty ELSE 0 END) closing
     FROM movements m JOIN batches b ON m.batch_id=b.id WHERE m.effective_on<=? GROUP BY b.sku
    ) SELECT f.*,p.name FROM flow f JOIN products p ON p.sku=f.sku WHERE (? IS NULL OR p.type_id=?) AND (? IS NULL OR f.sku=?) ORDER BY p.name LIMIT 1000`,
      span.start,span.start,span.end,span.start,span.end,span.start,span.end,span.start,span.end,span.end,span.end,type,type,closeoutSku,closeoutSku)
  ]);
  const sumBySku = rows => rows.reduce((items,row)=>{
    const item = items.get(row.sku) ?? {sku:row.sku,name:row.name,units:0};
    item.units += row.quantity;
    items.set(row.sku,item);
    return items;
  },new Map());
  const current = sumBySku(sales);
  const previous = sumBySku(former);
  const trends = Array.from(new Set([...current.keys(),...previous.keys()]),sku=>{
    const item = current.get(sku) ?? {...previous.get(sku),units:0};
    return {...item,previous:previous.get(sku)?.units??0,change:item.units-(previous.get(sku)?.units??0)};
  }).sort((a,b)=>b.change-a.change);
  const group = params.get('group') || 'day';
  const series = new Map();
  for (const row of sales) {
    const day = new Date(row.day+'T12:00:00Z').getUTCDay();
    const bucket = group === 'month' ? row.day.slice(0,7) :
      group === 'week' ? offsetDay(row.day,-((day+6)%7)) : row.day;
    series.set(bucket,[...(series.get(bucket)??[]),row]);
  }
  const overviewSeries = [];
  if (summary) {
    const width = Math.ceil(span.days/7);
    for (let index=0;index<span.days;index+=width) {
      const start=offsetDay(span.start,index), end=offsetDay(span.start,Math.min(index+width,span.days)-1);
      const priorStart=offsetDay(prior.start,index), priorEnd=offsetDay(prior.start,Math.min(index+width,span.days)-1);
      const currentBucket=summarize(sales.filter(row=>row.day>=start && row.day<=end));
      const priorBucket=summarize(former.filter(row=>row.day>=priorStart && row.day<=priorEnd));
      overviewSeries.push({start,end,priorStart,priorEnd,net:currentBucket.revenue-currentBucket.refund,
        previous:priorBucket.revenue-priorBucket.refund});
    }
  }
  return {span,prior,coverage:coverage.since,overviewSeries,sales:summarize(sales),previous:summarize(former),snapshot,
    age,attention,interest,trends,themeTrends,closeout,
    slow:interest.filter(item=>!current.get(item.sku)?.units),
    low:interest.filter(item=>item.available<=3 && current.get(item.sku)?.units>0)
      .sort((a,b)=>current.get(b.sku).units-current.get(a.sku).units),
    series:[...series.keys()].sort().map(bucket=>({bucket,...summarize(series.get(bucket))}))};
}
