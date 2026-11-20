import { parseCSV, draftRows, rowKey } from './csv.js';

const main = document.querySelector('#main');
const toast = document.querySelector('#toast');
let meta;
let staff;
let activeTab;
let timer;
const $ = (query,scope=document) => scope.querySelector(query);
const $$ = (query,scope=document) => [...scope.querySelectorAll(query)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price = value => value == null ? '—' : new Intl.NumberFormat('en',{style:'currency',currency:meta.currency,currencyDisplay:'code',maximumFractionDigits:value%100?2:0}).format(value/100);
const amount = value => value == null ? '' : String(value/100);
const option = (value,label,selected) => `<option value="${esc(value)}"${String(value)===String(selected)?' selected':''}>${esc(label)}</option>`;
const options = (kind,selected,first) => option('',first,selected)+meta.categories.filter(row=>row.kind===kind).map(row=>option(row.id,row.name,selected)).join('');
const list = (value,separator=',') => String(value??'').split(separator).filter(Boolean);
const badge = (text,pending=false) => `<span class="badge${pending?' pending':''}">${esc(text)}</span>`;
const img = (asset,alt,cls='photo') => `<img class="${cls}" src="/api/photo/${esc(asset)}" alt="${esc(alt)}" loading="lazy">`;
const blank = name => `<div class="placeholder" aria-hidden="true">${esc(name?.slice(0,2).toUpperCase() || 'LM')}</div>`;
const empty = message => `<div class="empty">${esc(message)}</div>`;
const button = (label,extra='') => `<button class="button ${extra}">${esc(label)}</button>`;
const updateMeta = async () => { meta=await api('/api/meta'); };
const format = input => Object.fromEntries(new FormData(input));
function notify(message) {
  toast.textContent=message;
  clearTimeout(timer);
  timer=setTimeout(()=>{toast.textContent='';},5500);
}
async function api(path, data) {
  const body = data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data);
  const response = await fetch(path,{method:data===undefined?'GET':'POST',body,
    headers:body && !(data instanceof FormData)?{'Content-Type':'application/json'}:{}});
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(result.error ?? result.message ?? 'The request could not be completed.'),{status:response.status});
  return result;
}
function formHandler(form, action) {
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=event.submitter;
    if (submit) submit.disabled=true;
    try { await action(format(form),form,submit); }
    catch (error) { notify(error.message); }
    finally { if (submit) submit.disabled=false; }
  });
}
function field(name,label,value='',type='text',extra='') {
  return `<label>${esc(label)}<input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
}
function text(name,label,value='') {
  return `<label class="span">${esc(label)}<textarea name="${name}">${esc(value)}</textarea></label>`;
}
function photoField(multiple=true) {
  return `<label class="span">${multiple?'Photos':'Photo'}<input name="files" type="file" accept="image/jpeg,image/png,image/webp,image/avif" ${multiple?'multiple':''}></label>`;
}
async function upload(file) {
  const form=new FormData(); form.append('photo',file);
  return (await api('/api/staff/photos',form)).id;
}
async function selectedPhotos(form) {
  return Promise.all([...form.elements.files.files].map(upload));
}
function waLink(phone,message) {
  return `https://wa.me/${String(phone).replace(/\D/g,'')}?text=${encodeURIComponent(message)}`;
}
function catalogFilters() {
  return `<form class="filters" id="filters"><label class="filter-search">Search
      <input name="q" type="search" placeholder="Try a product name or SKU" autocomplete="off">
    </label><label>Category<select name="audience">${options('audience',null,'All categories')}</select></label>
    <label>Product type<select name="type">${options('type',null,'All product types')}</select></label></form>
    <div id="catalog-results" aria-live="polite"></div>`;
}
function productCard(p,isStaff) {
  const link=isStaff?`/staff?sku=${encodeURIComponent(p.sku)}`:`/products/${encodeURIComponent(p.sku)}`;
  const availability=isStaff ? badge(`${Math.max(p.available,0)} available`) : p.available<=0?badge('Pending Sale',true):'';
  return `<a class="product-card" href="${link}">${p.cover?img(p.cover,p.name):blank(p.name)}
    <div class="product-copy"><span class="small">${esc(p.product_type || p.sku)}</span>
    <h3>${esc(p.name)}</h3>${p.display_price!=null?`<p>${esc(price(p.display_price))}</p>`:''}${availability}</div></a>`;
}
function wireCatalog(isStaff=false) {
  const filters=$('#filters');
  const target=$('#catalog-results');
  let revision=0;
  let delayed;
  async function load(page=1) {
    const current=++revision;
    const params=new URLSearchParams({...format(filters),page});
    try {
      const result=await api(`${isStaff?'/api/staff/catalog':'/api/catalog'}?${params}`);
      if (current!==revision || !target.isConnected) return;
      target.innerHTML=result.items.length ? `<div class="cards">${result.items.map(p=>productCard(p,isStaff)).join('')}</div>
      <div class="actions section">${page>1?'<button id="previous" class="button secondary">Previous</button>':'<span></span>'}
      ${result.next?'<button id="more" class="button secondary">Next products</button>':''}</div>` :
        empty(isStaff?'No inventory items match this search.':'No products match this search.');
      $('#more',target)?.addEventListener('click',()=>load(page+1));
      $('#previous',target)?.addEventListener('click',()=>load(page-1));
    } catch (error) { if (current===revision) target.innerHTML=empty(error.message); }
  }
  filters.addEventListener('submit',event=>{event.preventDefault();load();});
  filters.addEventListener('input',()=>{clearTimeout(delayed);delayed=setTimeout(load,180);});
  load();
}
function renderShop() {
  main.innerHTML=`<section class="hero"><div class="shell"><div class="art" aria-hidden="true"><div class="ribbon"></div></div>
    <h1>Find a gift worth <em>giving.</em></h1><p>Browse mugs, fragrances, gift sets, and more from Luxor Moolah.</p>
    <a href="#catalog" class="button gold">Browse the shop ↓</a></div></section>
    <section class="shell section" id="catalog"><h2>Shop the collection</h2>${catalogFilters()}</section>`;
  wireCatalog();
}
function gallery(item) {
  const ids=item.photos.map(photo=>photo.id);
  return `<div><div id="large-photo">${ids.length?img(ids[0],item.name):blank(item.name)}</div>
    <div class="thumbs">${ids.length>1?ids.map((value,index)=>`<button type="button" data-photo="${esc(value)}" aria-label="View photo ${index+1}">${img(value,'')}</button>`).join(''):''}</div></div>`;
}
function wireGallery(item) {
  $$('[data-photo]').forEach(target=>target.addEventListener('click',()=>{
    $('#large-photo').innerHTML=img(target.dataset.photo,item.name);
  }));
}
function sendEvent(sku, kind) {
  fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku,kind}),keepalive:true}).catch(()=>{});
}
async function renderPublicProduct(sku) {
  const item=await api('/api/product/'+encodeURIComponent(sku));
  document.title=item.name+' | Luxor Moolah';
  const message=`Hi! I'm interested in ${item.name} (${item.sku}). ${location.origin}/products/${encodeURIComponent(item.sku)}`;
  main.innerHTML=`<div class="shell section"><a class="small" href="/#catalog">← Back to the shop</a>
    <div class="detail">${gallery(item)}<section><div class="controls">${badge(item.product_type || item.sku)}
    ${item.available<=0?badge('Pending Sale',true):badge('Available')}</div>
    <h1 class="display">${esc(item.name)}</h1><p class="price">${esc(price(item.display_price))}</p>
    <p class="small">SKU ${esc(item.sku)}</p>${item.description?`<p>${esc(item.description)}</p>`:''}
    ${meta.whatsapp?`<a class="button" id="whatsapp" href="${esc(waLink(meta.whatsapp,message))}" rel="noopener noreferrer" target="_blank">Ask on WhatsApp ↗</a>`: ''}
    </section></div></div>`;
  wireGallery(item);
  try {
    const key='view:'+item.sku;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key,'1'); sendEvent(item.sku,'view'); }
  } catch { sendEvent(item.sku,'view'); }
  $('#whatsapp')?.addEventListener('click',()=>sendEvent(item.sku,'whatsapp'));
}
function signIn() {
  main.innerHTML=`<div class="shell"><section class="signin frame"><h2>Staff sign-in</h2>
    <p>Enter the email address your manager invited. We’ll send you a one-time sign-in link.</p>
    ${new URLSearchParams(location.search).has('error')?'<p class="alert">This link could not be used. Request a new one below.</p>':''}
    <form id="signin-form">${field('email','Email address','','email','required autocomplete="email"')}${button('Email me a sign-in link')}</form><p id="signin-feedback" role="status"></p></section></div>`;
  formHandler($('#signin-form'),async data=>{
    await api('/api/auth/sign-in/magic-link',{...data,callbackURL:'/staff',errorCallbackURL:'/staff'});
    $('#signin-feedback').textContent='If this email has staff access, check your inbox for a sign-in link.';
  });
}
const staffLink = (tab,values={}) => '/staff?'+new URLSearchParams({tab,...values});
const managerSections = [['Overview','▦'],['Orders','▤'],['Customers','◇'],['Inventory','▧'],['Reports','▥'],['Damage reports','⚑'],['Team','○']];

async function openStaff() {
  try { staff=await api('/api/staff/me'); }
  catch (error) { if (error.status===401) return signIn(); throw error; }
  const manager=staff.role==='manager';
  const params=new URLSearchParams(location.search);
  const sku=params.get('sku');
  const aliases={Dashboard:'Overview',Sales:'Orders','CSV upload':'Inventory',Categories:'Inventory'};
  const requested=params.get('tab');
  if (manager) {
    if (requested==='Sales' && !params.has('view')) params.set('view','pending');
    if (requested==='CSV upload') params.set('view','upload');
    if (requested==='Categories') params.set('view','categories');
  }
  const tabs=manager?managerSections:[['Inventory','▧'],['My sales','▤']];
  const tab=(manager?aliases[requested]:null)||requested;
  activeTab=tabs.some(section=>section[0]===tab)?tab:sku?'Inventory':tabs[0][0];
  document.body.classList.add('staff-workspace');
  main.innerHTML=`<div class="workspace">
    <button type="button" class="button secondary workspace-menu" id="workspace-menu" aria-controls="workspace-sidebar" aria-expanded="false">☰ Menu</button>
    <aside class="workspace-sidebar" id="workspace-sidebar">
      <a class="brand" href="/staff">Luxor <em>Moolah</em></a>
      <nav class="workspace-nav" aria-label="Staff sections">${tabs.map(([name,icon])=>`
        <a href="${esc(staffLink(name,name==='Orders'?{view:'pending'}:{}))}" ${name===activeTab?'aria-current="page"':''}>
        <span class="workspace-icon" aria-hidden="true">${icon}</span>${esc(name)}
        ${name==='Orders'?'<span id="workspace-pending" class="count-badge" hidden></span>':''}</a>`).join('')}</nav>
      <div class="workspace-account"><span class="small">${esc(staff.email)}</span>
        <div class="controls"><a href="/">View storefront</a><button class="button secondary" id="signout">Sign out</button></div>
      </div>
    </aside>
    <div class="workspace-content" id="staffbody"></div></div>`;
  $('#workspace-menu').addEventListener('click',event=>{
    const open=$('#workspace-sidebar').classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });
  $('#signout').addEventListener('click',async()=>{try { await api('/api/auth/sign-out',{}); location.assign('/staff'); } catch(error){notify(error.message);} });
  if (manager && activeTab!=='Overview') refreshPendingCount();
  await loadTab(activeTab,sku,params);
}
async function refreshPendingCount() {
  try { setPendingCount((await api('/api/staff/attention')).pending); } catch { /* The badge is supplementary. */ }
}
function setPendingCount(count) {
  const target=$('#workspace-pending');
  if (!target) return;
  target.textContent=count;
  target.hidden=!count;
  target.setAttribute('aria-label',`${count} pending approvals`);
}
function workspaceHeading(title,actions='') {
  return `<div class="workspace-heading"><h1>${esc(title)}</h1>${actions?'<div class="controls">'+actions+'</div>':''}</div>`;
}
function subnav(tab,views,current) {
  return `<nav class="workspace-subnav" aria-label="${esc(tab)} views">${views.map(([key,label])=>
    `<a href="${esc(staffLink(tab,{view:key}))}" ${key===current?'aria-current="page"':''}>${esc(label)}</a>`).join('')}</nav>`;
}
async function loadTab(tab,sku=null,params=new URLSearchParams(location.search)) {
  const body=$('#staffbody');
  body.innerHTML=empty('Loading…');
  try {
    if (tab==='Inventory') {
      if (sku) return await renderStaffProduct(body,sku);
      if (staff.role==='manager') return await renderInventoryPage(body,params);
      return await renderStaffInventory(body);
    }
    if (tab==='My sales') return await renderSales(body);
    if (tab==='Orders') {
      if (params.has('order')) return await renderOrders(body,params.get('order'),params.get('view'));
      return await renderOrdersPage(body,params.get('view'));
    }
    if (tab==='Customers') return await renderCustomers(body,params.get('customer'));
    if (tab==='Damage reports') return await renderIssues(body);
    if (tab==='Team') return await renderTeam(body);
    if (tab==='Reports') return await renderDashboard(body,params);
    return await renderOverview(body,params);
  } catch (error) { body.innerHTML=empty(error.message); }
}
async function renderStaffInventory(body) {
  const recent=await api('/api/staff/recent');
  body.innerHTML=`${staff.role==='manager'?'<div id="product-editor"></div>':workspaceHeading('Inventory')}
    ${recent.length?`<div class="controls"><span class="small">Recently opened</span>${recent.map(item=>`<a class="button secondary" href="/staff?sku=${esc(item.sku)}">${esc(item.name)}</a>`).join('')}</div>`:''}${catalogFilters()}`;
  wireCatalog(true);
}
const inventoryViews=[['all','All inventory'],['low','Low-stock sellers'],['aging','Stock over 90 days'],['upload','CSV upload'],['categories','Categories']];
async function renderInventoryPage(body,params) {
  const view=inventoryViews.some(([key])=>key===params.get('view'))?params.get('view'):'all';
  body.innerHTML=workspaceHeading('Inventory',
    `<a class="button secondary" href="${esc(staffLink('Inventory',{view:'upload'}))}">Upload CSV</a>
    <button class="button secondary" id="receive-stock">Receive stock</button><button class="button" id="new-product">Add item</button>`)+
    subnav('Inventory',inventoryViews,view)+'<div id="inventory-action"></div><div id="inventory-page"></div>';
  const actions=$('#inventory-action',body);
  $('#new-product',body).addEventListener('click',()=>renderProductEditor(actions,null));
  $('#receive-stock',body).addEventListener('click',()=>{
    actions.innerHTML=`<section class="frame"><h2>Receive stock</h2><form class="formgrid">
      ${field('sku','SKU','','text','required')}${field('quantity','Units','','number','min="1" required')}
      ${field('unit_cost','Unit cost','','number','min="0" step="0.01"')}
      ${field('received_on','Date received or made',meta.today,'date')}${text('note','Receipt note')}
      <div class="span">${button('Receive stock')}</div></form></section>`;
    formHandler($('form',actions),async data=>{
      await api('/api/staff/receipts',data);
      notify('Stock received.'); await renderInventoryPage(body,params);
    });
    $('input',actions).focus();
  });
  const content=$('#inventory-page',body);
  if (view==='upload') return renderImport(content);
  if (view==='categories') return renderCategories(content);
  if (view==='all') return renderStaffInventory(content);
  const days=overviewDays(params.get('days'));
  const data=await api('/api/staff/dashboard?'+overviewQuery(days));
  const age=view==='aging';
  const rows=age?data.age:data.low;
  content.innerHTML=`<section class="frame"><h2>${age?'Stock over 90 days':'Low-stock sellers'}</h2>
    ${age?'':`<p class="small">Items sold in the last ${days} days with three or fewer units available.</p>`}
    ${dataTable(age?['Product','Oldest batch','Aged units','Cost']:['Product','Available'],
      rows.map(row=>[staffAnchor('/staff?sku='+encodeURIComponent(row.sku),row.name+' · '+row.sku),
        ...(age?[esc(row.oldest),row.units,esc(price(row.value))]:[row.available])]),'No matching products.')}</section>`;
}
function audienceInputs(selected=[]) {
  return `<fieldset class="span"><legend>Audience categories</legend><div class="controls">${meta.categories.filter(c=>c.kind==='audience')
    .map(c=>`<label class="check"><input type="checkbox" name="category" value="${c.id}" ${selected.map(String).includes(String(c.id))?'checked':''}>${esc(c.name)}</label>`).join('')}</div></fieldset>`;
}
function itemFields(item={},existing=false) {
  return `${field('sku','SKU',item.sku??'','text',existing?'readonly':'placeholder="Assign automatically if blank"')}
    ${field('name','Product name',item.name,'text','required')}
    <label>Product type<select name="type_id">${options('type',item.type_id,'Select type')}</select></label>
    ${field('price','Regular selling price',item.price,'number','min="0" step="0.01"')}
    ${field('sale_price','Sale price',item.sale_price,'number','min="0" step="0.01"')}
    <label class="check"><input name="discount" type="checkbox" ${item.discount?'checked':''}>Use sale price on storefront</label>
    ${text('description','Description',item.description)}${audienceInputs(item.categories??[])}
    <div class="span">${field('themes','Product themes',item.themes,'text','placeholder="Animal mugs, woodland gifts"')}
    <small>Separate themes with commas. Use the same theme on similar products to compare sales across SKUs.</small></div>`;
}
function normalizeItem(data,form) {
  data.categories=new FormData(form).getAll('category');
  data.discount=form.elements.discount.checked;
  return data;
}
function renderProductEditor(target,item) {
  target.innerHTML=`<div class="frame"><h3>${item?'Edit item':'Add item'}</h3><form id="product-form" class="formgrid">
    ${itemFields(item?{...item,price:amount(item.price),sale_price:amount(item.sale_price),categories:list(item.categories)}:{},!!item)}
    <label>Listing status<select name="state">${['draft','active','archived'].map(state=>option(state,state,item?.state)).join('')}</select></label>
    ${photoField()}${item?.photos?.length?`<fieldset class="span"><legend>Current photos</legend><div class="photo-row">${item.photos.map((photo,index)=>
    `<div>${img(photo.id,'Photo '+(index+1),'issue-img')}<label>Order<input data-order="${photo.id}" type="number" min="1" value="${index+1}"></label><label><input name="remove" type="checkbox" value="${photo.id}">Remove</label></div>`).join('')}</div></fieldset>`:''}
    <div class="span">${button('Save item')}</div></form></div>`;
  formHandler($('#product-form',target),async(data,form)=>{
    normalizeItem(data,form);
    data.existing_sku=item?.sku;
    data.photos=await selectedPhotos(form);
    data.photo_order=$$('[data-order]',form).sort((a,b)=>Number(a.value)-Number(b.value)).map(field=>field.dataset.order);
    data.remove_photos=new FormData(form).getAll('remove');
    const result=await api('/api/staff/product',data);
    notify('Item saved.');
    history.replaceState(null,'','/staff?sku='+encodeURIComponent(result.sku));
    await loadTab('Inventory',result.sku);
  });
}
async function renderStaffProduct(body,sku) {
  const item=await api('/api/staff/product/'+encodeURIComponent(sku));
  const manager=staff.role==='manager';
  const contact=staff.staff_whatsapp?waLink(staff.staff_whatsapp,`Question about ${item.name} (${sku}). ${location.origin}/staff?sku=${encodeURIComponent(sku)}`):'';
  body.innerHTML=`<a class="small" href="/staff?tab=Inventory">← Inventory</a><div class="detail">${gallery(item)}
    <section><h2>${esc(item.name)}</h2><p>${badge(item.sku)} ${badge(`${Math.max(item.available,0)} available`)}</p>
    ${item.description?`<p>${esc(item.description)}</p>`:''}${contact?`<a target="_blank" rel="noopener" class="button secondary" href="${esc(contact)}">Message inventory manager ↗</a>`:''}
    ${item.available>0?`<div class="frame"><h3>Record a sale</h3><form id="sell" class="formgrid">
    ${field('quantity','Units',1,'number',`min="1" max="${item.available}" required`)}
    ${field('sold_on','Sale date',meta.today,'date','required')}
    ${manager?field('unit_price','Actual price per unit',amount(item.display_price),'number','min="0" step="0.01"'):''}
    ${manager?customerPicker():''}
    <div class="span controls">${button('Submit for review')}${manager?'<button class="button secondary" value="direct">Approve now</button>':''}</div></form></div>`:''}
    <details class="frame"><summary>Report a damaged item</summary><form id="issue" class="formgrid">${text('note','What happened?')}${photoField(false)}
    <div class="span">${button('Send report')}</div></form></details></section></div>
    ${manager?`<div id="product-editor"></div><div class="frame"><h3>Receive stock</h3><form id="receive" class="formgrid">
    ${field('quantity','Units','','number','min="1" required')}${field('unit_cost','Unit cost','','number','min="0" step="0.01"')}
    ${field('received_on','Date received or made',meta.today,'date')}${text('note','Receipt note')}
    <div class="span">${button('Receive stock')}</div></form></div>
    <div class="frame"><h3>Stock batches</h3>${table(['Received','On hand','Unit cost'],item.batches.map(b=>[b.received_on??'Unknown',b.on_hand,price(b.cost)]))}
    ${item.batches.length?`<form id="adjust" class="formgrid"><label>Batch<select name="batch">${item.batches.map(batch=>option(batch.id,`${batch.received_on??'Unknown date'} · ${batch.on_hand} on hand`)).join('')}</select></label>
    <label>Change<select name="direction"><option value="remove">Remove units</option><option value="add">Add units</option></select></label>
    ${field('quantity','Units','','number','min="1" required')}${text('note','Reason')}
    <div class="span">${button('Record adjustment')}</div></form>`:''}</div>`:''}`;
  wireGallery(item);
  const reload=()=>loadTab('Inventory',item.sku);
  if (manager && $('#sell')) wireCustomerPicker($('#sell'));
  if ($('#sell')) formHandler($('#sell'),async(data,form,submit)=>{
    await api('/api/staff/sales',{...data,sku:item.sku,direct:submit?.value==='direct'});
    notify(submit?.value==='direct'?'Sale approved.':'Sale submitted.');
    await reload();
  });
  formHandler($('#issue'),async(data,form)=>{
    await api('/api/staff/issues',{sku:item.sku,note:data.note,photos:await selectedPhotos(form)});
    notify('Damage report sent.'); form.reset();
  });
  if (manager) {
    renderProductEditor($('#product-editor'),item);
    formHandler($('#receive'),async data=>{await api('/api/staff/receipts',{...data,sku:item.sku});notify('Stock received.');await reload();});
    if ($('#adjust')) formHandler($('#adjust'),async data=>{await api('/api/staff/adjustments',data);notify('Stock adjusted.');await reload();});
  }
}
function table(headers,rows) {
  return dataTable(headers,rows.map(row=>row.map(esc)));
}
function dataTable(headers,rows,message='No records for this report.') {
  return rows.length?`<div class="tablewrap"><table><thead><tr>${headers.map(title=>`<th scope="col">${esc(title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(message);
}
function staffAnchor(url,label) {
  return `<a href="${esc(url)}">${esc(label)}</a>`;
}
async function renderSales(body,view) {
  const sales=await api('/api/staff/sales'+(view?'?view='+view:''));
  const manager=staff.role==='manager';
  const pendingCount=sales.filter(sale=>sale.status==='pending').length;
  body.innerHTML=`${manager?'':workspaceHeading('My sales')}
    ${manager && pendingCount>1?`<details class="frame"><summary>Close selected items as one order</summary>
      <p class="small">Select the pending items below and enter each selling price. Use the same sale date for all items.</p>
      <form id="close-order" class="formgrid">${customerPicker()}
        <div class="span">${button('Approve selected items as one order')}</div></form></details>`:''}
    ${sales.length?sales.map(sale=>
    `<details class="frame" ${sale.status==='pending'?'open':''}><summary>${esc(sale.name)} · ${sale.quantity} · ${esc(sale.sold_on)} · ${badge(sale.returned>=sale.quantity?'Returned':sale.returned>0?'Partially returned':sale.status,sale.status==='pending')}</summary>
      ${manager?`<p class="small">${esc(sale.employee)} · submitted ${esc(sale.submitted_at)}</p>`:''}
      ${manager && sale.order_id?`<p class="small">${esc(sale.customer_name||'Walk-in')} · <a href="${orderLink(sale.order_id)}">View order</a></p>`:''}
      ${manager && sale.status==='approved' && !sale.order_id?`<details><summary>Attach a customer</summary>
        <form class="formgrid" data-assign="${sale.id}">${customerPicker()}<div class="span">${button('Save customer','secondary')}</div></form></details>`:''}
      ${sale.notes.map(note=>`<p>${esc(note.note)}</p>`).join('')}
      ${sale.status==='pending'?(manager?`<form data-review="${sale.id}" class="formgrid">
        ${field('sku','SKU',sale.sku,'text','required')}${field('quantity','Units',sale.quantity,'number','min="1" required')}
        ${field('sold_on','Sale date',sale.sold_on,'date','required')}${field('unit_price','Actual price per unit',amount(sale.unit_price),'number','min="0" step="0.01"')}
        ${text('note','Review note')}${customerPicker()}
        ${pendingCount>1?'<label class="check span"><input type="checkbox" name="group">Include in selected order</label>':''}
        <div class="span controls"><button class="button" value="approved">Approve</button>
        <button class="button secondary" value="pending">Save correction</button><button class="button danger" value="canceled">Cancel sale</button></div></form>`:
        `<form data-note="${sale.id}" class="formgrid">${text('note','Correction note')}<div class="span">${button('Send note')}</div></form>`):
        manager && sale.status==='approved' && sale.returned<sale.quantity ? returnForm(sale.id,sale.quantity-sale.returned):''}
    </details>`).join(''):empty(view==='pending'?'There are no sales waiting for approval.':'No sales recorded yet.')}`;
  $$('[data-review]',body).forEach(form=>{
    wireCustomerPicker(form);
    formHandler(form,async(data,_,submit)=>{
      await api(`/api/staff/sales/${form.dataset.review}/review`,{...data,status:submit.value});
      notify('Sale updated.'); refreshPendingCount(); await renderSales(body,view);
    });
  });
  $$('[data-assign]',body).forEach(form=>{
    wireCustomerPicker(form);
    formHandler(form,async data=>{
      if (!data.customer_id) throw new Error('Select a customer first.');
      await api(`/api/staff/sales/${form.dataset.assign}/customer`,data);
      notify('Customer attached.'); await renderSales(body,view);
    });
  });
  const group=$('#close-order',body);
  if (group) {
    wireCustomerPicker(group);
    formHandler(group,async data=>{
      const selected=$$('[data-review]',body).filter(form=>form.elements.group?.checked);
      if (selected.length<2) throw new Error('Select at least two pending items below.');
      const items=selected.map(form=>({...format(form),id:form.dataset.review}));
      if (items.some(item=>item.customer_id && item.customer_id!==data.customer_id))
        throw new Error('Use the customer picker in the grouped order for all selected items.');
      const result=await api('/api/staff/orders',{customer_id:data.customer_id,items});
      notify('Order closed.'); location.assign(orderLink(result.order_id));
    });
  }
  $$('[data-note]',body).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/sales/${form.dataset.note}/notes`,data); notify('Note sent.'); await renderSales(body,view);
  }));
  wireReturns(body,()=>renderSales(body,view));
}
function returnForm(id,remaining) {
  return `<form data-return="${esc(id)}" class="formgrid">
    ${field('returned_on','Return date',meta.today,'date','required')}<label class="check"><input name="restock" type="checkbox" checked>Return units to stock</label>
    ${field('quantity','Units returned',remaining,'number',`min="1" max="${remaining}" required`)}
    ${field('refund','Total refund','','number','min="0" step="0.01" placeholder="Defaults to original unit price"')}
    ${text('note','Return reason')}<div class="span">${button('Record return','secondary')}</div></form>`;
}
function wireReturns(body,refresh) {
  $$('[data-return]',body).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/sales/${form.dataset.return}/return`,{...data,restock:!!data.restock});
    notify('Return recorded.'); await refresh();
  }));
}
const orderLink = (id,view='all') => staffLink('Orders',{view,order:id});
const customerLink = id => '/staff?tab=Customers&customer='+encodeURIComponent(id);
function customerPicker(customer=null) {
  return `<fieldset class="span" data-picker><legend>Customer (optional)</legend>
    <input type="hidden" name="customer_id" value="${esc(customer?.id)}">
    <div class="controls"><span class="small" data-selected aria-live="polite">${esc(customer?.name||'Walk-in')}</span>
      <button type="button" class="button secondary" data-clear>Use walk-in</button></div>
    <div class="controls"><label>Find a customer<input type="search" data-search placeholder="Name, phone, or email" autocomplete="off"></label>
      <button type="button" class="button secondary" data-find>Search</button></div>
    <div data-matches aria-live="polite"></div>
    <details><summary>Add a new customer</summary><div class="formgrid">
      <label>Name<input data-customer-name autocomplete="off"></label>
      <label>Phone<input data-customer-phone type="tel" autocomplete="off"></label>
      <label>Email<input data-customer-email type="email" autocomplete="off"></label>
      <div><button type="button" class="button secondary" data-add-customer>Save and select</button></div>
    </div></details></fieldset>`;
}
function wireCustomerPicker(form) {
  const picker=$('[data-picker]',form);
  if (!picker) return;
  const results=$('[data-matches]',picker);
  function select(customer) {
    form.elements.customer_id.value=customer?.id??'';
    $('[data-selected]',picker).textContent=customer?.name??'Walk-in';
    results.replaceChildren();
  }
  $('[data-clear]',picker).addEventListener('click',()=>select(null));
  const search=$('[data-search]',picker);
  async function find() {
    try {
      const found=await api('/api/staff/customers?'+new URLSearchParams({q:search.value}));
      results.replaceChildren();
      if (!found.items.length) results.textContent='No customers matched.';
      for (const customer of found.items) {
        const choice=document.createElement('button');
        choice.type='button';
        choice.className='button secondary';
        choice.textContent=[customer.name,customer.phone,customer.email].filter(Boolean).join(' · ');
        choice.addEventListener('click',()=>select(customer));
        results.append(choice);
      }
    } catch(error) { notify(error.message); }
  }
  $('[data-find]',picker).addEventListener('click',find);
  search.addEventListener('keydown',event=>{
    if (event.key==='Enter') { event.preventDefault(); find(); }
  });
  $('[data-add-customer]',picker).addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try {
      const customer=await api('/api/staff/customers',{
        name:$('[data-customer-name]',picker).value,
        phone:$('[data-customer-phone]',picker).value,
        email:$('[data-customer-email]',picker).value
      });
      select(customer);
      button.closest('details').open=false;
      notify('Customer added and selected.');
    } catch(error) { notify(error.message); }
    finally {button.disabled=false;}
  });
}
function paginate(target,result,refresh) {
  const controls=document.createElement('div');
  controls.className='controls';
  for (const [label,page,visible] of [['Previous',result.page-1,result.page>1],['Next',result.page+1,result.next]]) {
    if (!visible) continue;
    const button=document.createElement('button');
    button.type='button';
    button.className='button secondary';
    button.textContent=label;
    button.addEventListener('click',()=>refresh(page).catch(error=>notify(error.message)));
    controls.append(button);
  }
  target.append(controls);
}
async function displayOrders(target,customer=null,page=1) {
  const query=new URLSearchParams({page});
  if (customer) query.set('customer',customer);
  const result=await api('/api/staff/orders?'+query);
  target.innerHTML=result.items.length?result.items.map(order=>`<a class="order-row frame" href="${orderLink(order.id)}">
    <strong>Order ${esc(order.id.slice(0,8).toUpperCase())}</strong>
    <span>${esc(order.sold_on)} · ${esc(order.customer_name||'Walk-in')} · ${order.line_count} ${order.line_count===1?'line':'lines'}</span>
    <span>${esc(price(order.gross-order.refunds))}</span></a>`).join(''):empty('No orders yet.');
  paginate(target,result,next=>displayOrders(target,customer,next));
}
async function renderCustomers(body,id) {
  if (id) {
    const customer=await api('/api/staff/customers/'+encodeURIComponent(id));
    body.innerHTML=workspaceHeading(customer.name)+`<a href="/staff?tab=Customers">← Customers</a>
      <section class="frame"><p>${esc([customer.phone,customer.email].filter(Boolean).join(' · '))}</p>
        <h4>Purchase history</h4><div data-orders></div></section>`;
    return displayOrders($('[data-orders]',body),customer.id);
  }
  body.innerHTML=workspaceHeading('Customers')+`
    <form class="formgrid" id="customer-search">${field('q','Search customers','','search','placeholder="Name, phone, or email"')}
      <div>${button('Search','secondary')}</div></form>
    <details class="frame"><summary>Add a customer</summary><form class="formgrid" id="customer-create">
      ${field('name','Name','','text','required')}${field('phone','Phone','','tel')}${field('email','Email','','email')}
      <div class="span">${button('Save customer')}</div></form></details><div data-results></div>`;
  const target=$('[data-results]',body);
  const refresh=async(q='',page=1)=>{
    const result=await api('/api/staff/customers?'+new URLSearchParams({q,page}));
    target.innerHTML=result.items.length?result.items.map(customer=>`<a class="order-row frame" href="${customerLink(customer.id)}">
      <strong>${esc(customer.name)}</strong><span>${esc([customer.phone,customer.email].filter(Boolean).join(' · '))}</span></a>`).join(''):empty('No customers matched.');
    paginate(target,result,next=>refresh(q,next));
  };
  formHandler($('#customer-search',body),data=>refresh(data.q));
  formHandler($('#customer-create',body),async data=>{
    const customer=await api('/api/staff/customers',data);
    location.assign(customerLink(customer.id));
  });
  await refresh();
}
const orderViews=[['pending','Pending approval'],['all','All orders'],['returns','Returns']];
async function renderOrdersPage(body,requested) {
  const view=['pending','all','returns','legacy'].includes(requested)?requested:'all';
  body.innerHTML=workspaceHeading('Orders')+subnav('Orders',orderViews,view)+'<div id="orders-page"></div>';
  const target=$('#orders-page',body);
  if (view==='pending' || view==='legacy') return renderSales(target,view);
  if (view==='returns') return renderReturns(target);
  target.innerHTML=`<p class="small">${staffAnchor(staffLink('Orders',{view:'legacy'}),'Older sales without an order')}</p><div data-orders></div>`;
  return displayOrders($('[data-orders]',target));
}
async function renderReturns(target,page=1) {
  const result=await api('/api/staff/returns?'+new URLSearchParams({page}));
  target.innerHTML=`<section class="frame"><h2>Return history</h2>${dataTable(
    ['Returned','Item','Order','Customer','Units','Refund','Restocked','Reason'],
    result.items.map(row=>[esc(row.returned_on),esc(row.name+' · '+row.sku),
      row.order_id?staffAnchor(orderLink(row.order_id,'returns'),'Order '+row.order_id.slice(0,8).toUpperCase()):
        staffAnchor(staffLink('Orders',{view:'legacy'}),'Older sale'),
      esc(row.customer_name||(row.order_id?'Walk-in':'—')),row.quantity,esc(price(row.refund)),row.restock?'Yes':'No',esc(row.reason)]),
    'No returns recorded yet.')}</section>`;
  paginate(target,result,next=>renderReturns(target,next));
}
async function renderOrders(body,id,from='all') {
  const order=await api('/api/staff/orders/'+encodeURIComponent(id));
  const returns=order.lines.flatMap(line=>line.returns.map(entry=>[line.name,line.sku,entry.returned_on,entry.quantity,price(entry.refund),entry.restock?'Yes':'No']));
  const returnable=order.lines.map(line=>({...line,remaining:line.quantity-line.returns.reduce((sum,entry)=>sum+entry.quantity,0)}))
    .filter(line=>line.remaining>0);
  const back=from==='returns'?'returns':'all';
  body.innerHTML=workspaceHeading('Order '+order.id.slice(0,8).toUpperCase())+`<div class="controls">${staffAnchor(staffLink('Orders',{view:back}),back==='returns'?'← Returns':'← All orders')}
    ${order.customer_id?`<a href="${customerLink(order.customer_id)}">Customer history</a>`:''}
    <button type="button" class="button secondary" data-print>Print order summary</button></div>
    <section class="frame order-summary"><h3>Order ${esc(order.id.slice(0,8).toUpperCase())}</h3>
    <p>${esc(order.sold_on)} · ${esc(order.customer_name||'Walk-in')}</p>
    ${table(['Item','SKU','Units','Unit price','Line total'],order.lines.map(line=>[line.name,line.sku,line.quantity,price(line.unit_price),price(line.unit_price*line.quantity)]))}
    ${returns.length?`<h4>Returns</h4>${table(['Item','SKU','Date','Units','Refund','Restocked'],returns)}`:''}
    <p><strong>Gross</strong> ${price(order.gross)} · <strong>Refunds</strong> ${price(order.refunds)} · <strong>Net</strong> ${price(order.gross-order.refunds)}</p></section>
    ${returnable.map(line=>`<details class="frame"><summary>Return item · ${esc(line.name)} (${esc(line.sku)})</summary>${returnForm(line.id,line.remaining)}</details>`).join('')}
    <details class="frame"><summary>Change order customer</summary><form class="formgrid" data-customer-change>
      ${customerPicker({id:order.customer_id,name:order.customer_name})}<div class="span">${button('Save customer','secondary')}</div></form></details>`;
  $('[data-print]',body).addEventListener('click',()=>window.print());
  wireReturns(body,()=>renderOrders(body,id,from));
  const form=$('[data-customer-change]',body);
  wireCustomerPicker(form);
  formHandler(form,async data=>{
    await api(`/api/staff/sales/${order.lines[0].id}/customer`,data);
    notify('Order customer updated.'); await renderOrders(body,id,from);
  });
}
async function renderIssues(body) {
  const issues=await api('/api/staff/issues');
  body.innerHTML=workspaceHeading('Damage reports')+`${issues.length?issues.map(issue=>`<div class="frame">
    <div class="actions"><a href="/staff?sku=${esc(issue.sku)}">${esc(issue.name)} · ${esc(issue.sku)}</a>
    ${badge(issue.resolved_at?'Resolved':'Needs review',!issue.resolved_at)}</div>
    <p>${esc(issue.note)}</p><div class="photo-row">${list(issue.photos).map(photo=>
      `<a href="/api/photo/${esc(photo)}" target="_blank" rel="noopener">${img(photo,'Damage report photo','issue-img')}</a>`).join('')}</div>
    ${issue.resolved_at?`<p>${esc(issue.resolution)}</p>`:`<form data-resolve="${issue.id}" class="formgrid">${text('note','Manager resolution')}
    <div class="span">${button('Resolve report')}</div></form>`}</div>`).join(''):empty('No damage reports.')}`;
  $$('[data-resolve]',body).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/issues/${form.dataset.resolve}/resolve`,data);notify('Report resolved.');await renderIssues(body);
  }));
}
function renderCategories(body) {
  const kinds=['audience','type'];
  body.innerHTML=kinds.map(kind=>`<div class="frame"><h3>${kind==='audience'?'Audience categories':'Product subcategories'}</h3>
   ${[{id:'',name:''},...meta.categories.filter(row=>row.kind===kind)].map(row=>`
    <form class="formgrid" data-cat="${kind}" data-id="${row.id}">
      ${field('name',row.id?'Category name':'New category',row.name,'text','required')}
      <div>${button(row.id?'Save name':'Add category','secondary')}</div></form>`).join('')}</div>`).join('');
  $$('[data-cat]',body).forEach(form=>formHandler(form,async data=>{
    await api('/api/staff/categories',{...data,kind:form.dataset.cat,id:form.dataset.id});await updateMeta();notify('Category saved.');renderCategories(body);
  }));
}
async function renderTeam(body) {
  const people=await api('/api/staff/team');
  body.innerHTML=workspaceHeading('Team')+`<div class="frame"><h3>Invite an employee</h3><form class="formgrid" id="invite">
    ${field('email','Email address','','email','required')}<div>${button('Send invitation')}</div></form>
    ${people.map(person=>`<div class="actions frame"><div>${esc(person.email)} <span class="small">${esc(person.role)} · ${person.active?'Access enabled':'Access revoked'}</span></div>
    ${person.role==='employee'?`<div class="controls"><button class="button secondary" data-invite="${esc(person.email)}">${person.active?'Resend invite':'Restore and invite'}</button>
    ${person.active?`<button class="button danger" data-revoke="${esc(person.email)}">Revoke access</button>`:''}</div>`:''}</div>`).join('')}</div>`;
  async function change(email,disable=false) {
    try { await api('/api/staff/team',{email,disable});notify(disable?'Access revoked.':'Invitation sent.'); }
    catch(error){notify(error.message);}
    await renderTeam(body);
  }
  formHandler($('#invite'),data=>change(data.email));
  $$('[data-invite]',body).forEach(el=>el.addEventListener('click',()=>change(el.dataset.invite)));
  $$('[data-revoke]',body).forEach(el=>el.addEventListener('click',()=>change(el.dataset.revoke,true)));
}
async function renderImport(body) {
  body.innerHTML=`<div class="frame"><div class="actions"><h3>Upload a product batch</h3><a class="button secondary" href="/luxor-import-template.csv" download>Download CSV template</a></div>
    <form class="formgrid" id="upload-csv">
      <label>CSV file<input type="file" name="csv" accept=".csv,text/csv" required></label>${photoField()}<div class="span">${button('Preview rows')}</div>
    </form><div id="upload-preview" aria-live="polite"></div></div>
    <h3>Drafts awaiting approval</h3><div id="drafts"></div>`;
  formHandler($('#upload-csv'),async (_,form)=>{
    const csv=form.elements.csv.files[0];
    const files=[...form.elements.files.files];
    const rows=draftRows(parseCSV(await csv.text()),files,meta.categories);
    const preview=$('#upload-preview');
    preview.innerHTML=table(['Row','SKU','Product','Photos','Review'],rows.map(row=>[row.number,row.payload.sku||'New SKU',row.payload.name,
      row.files.map(file=>file.name).join(', '),row.errors.join(' · ')||'Valid']));
    const ready=rows.filter(row=>!row.errors.length);
    if (!ready.length) return;
    preview.insertAdjacentHTML('beforeend',`<button class="button" id="stage">Save ${ready.length} valid rows as drafts</button>`);
    $('#stage').addEventListener('click',async event=>{
      const button=event.currentTarget;
      button.disabled=true;
      let done=0;
      const rejected=[];
      for (const row of ready) {
        try {
          button.textContent=`Saving row ${row.number}…`;
          const key=await rowKey(row.payload,row.files);
          const photos=await Promise.all(row.files.map(upload));
          await api('/api/staff/imports',{key,payload:{...row.payload,photos}});
          done++;
        } catch (error) { rejected.push(`Row ${row.number}: ${error.message}`); }
      }
      notify(`${done} rows saved for review.`);
      button.textContent=`${done} rows saved`;
      if (rejected.length) {
        button.disabled=false;button.textContent='Retry batch';
        preview.insertAdjacentHTML('beforeend',`<ul class="alert">${rejected.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`);
      }
      await showDrafts();
    });
  });
  await showDrafts();
}
async function showDrafts() {
  const target=$('#drafts');
  if (!target) return;
  const drafts=await api('/api/staff/imports');
  const draftForm=row=>{
    const item=row.payload;
    const exists=!!row.existing_sku;
    return `<details class="frame"><summary>${esc(item.name||'Unnamed item')} · ${esc(item.sku||'Assign SKU')}
       ${exists?badge('Existing SKU',true):''}</summary>
       <div class="photo-row">${(item.photos||[]).map(photo=>img(photo,'Draft photo','issue-img')).join('')}</div>
       <form class="formgrid" data-draft="${row.id}">${itemFields(item,!!item.sku)}
       ${field('quantity','Opening or incoming units',item.quantity,'number','min="0"')}
       ${field('unit_cost','Unit cost',item.unit_cost,'number','min="0" step="0.01"')}
       ${field('received_on','Date received',item.received_on,'date')}
       <label>Action<select name="action">${exists?'<option value="">Choose an action</option><option value="update">Update listing details</option><option value="receive">Receive additional stock only</option>':'<option value="create">Create item</option>'}</select></label>
       <label class="check"><input type="checkbox" name="publish">Publish listing</label><div class="span">${button('Approve this row')}</div>
       </form></details>`;
  };
  target.innerHTML=drafts.length?`<div class="controls"><button class="button secondary" id="approve-batch">Approve complete new items and publish</button></div>`+
    drafts.map(draftForm).join(''):empty('No imported drafts awaiting approval.');
  $$('[data-draft]',target).forEach(form=>formHandler(form,async data=>{
    normalizeItem(data,form);
    const source=drafts.find(row=>row.id===form.dataset.draft);
    if (source.payload.themes==null && !data.themes.trim()) delete data.themes;
    data.publish=!!data.publish;
    assertChoice(data.action);
    await api(`/api/staff/imports/${form.dataset.draft}/approve`,data);
    notify('Draft approved.');await showDrafts();
  }));
  $('#approve-batch',target)?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    const ready=drafts.filter(row=>!row.existing_sku&&row.payload.name&&row.payload.price!==''&&row.payload.price!=null&&Number(row.payload.quantity)>0);
    if (!ready.length) return notify('No complete new drafts are ready for batch approval.');
    if (!confirm(`Add stock and publish ${ready.length} new items?`)) return;
    button.disabled=true;
    const pending=[];
    for(const row of ready) {
      try { await api(`/api/staff/imports/${row.id}/approve`,{action:'create',publish:true}); }
      catch(error){pending.push((row.payload.sku||row.payload.name)+': '+error.message);}
    }
    notify(`${ready.length-pending.length} drafts approved and published.`);
    await showDrafts();
    if(pending.length) target.insertAdjacentHTML('afterbegin',`<ul class="alert">${pending.map(message=>`<li>${esc(message)}</li>`).join('')}</ul>`);
  });
}
function assertChoice(action) { if(!action) throw new Error('Choose how to apply this draft.'); }

function addDays(value,amount) {
  const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);
}
function monthsBack(value,amount) {
  const date=new Date(value.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()-amount);
  return date.toISOString().slice(0,10);
}
const overviewPeriods=[7,30,90];
function overviewDays(value) {
  return overviewPeriods.includes(Number(value))?Number(value):30;
}
function overviewQuery(days) {
  return new URLSearchParams({start:addDays(meta.today,1-days),end:meta.today,summary:1});
}
function dashboardMetric(label,value,note,link,tone='') {
  return `<a class="dashboard-metric ${tone}" href="${esc(link)}">
    <span class="dashboard-metric-label">${esc(label)} <span aria-hidden="true">↗</span></span>
    <strong>${esc(value)}</strong><small>${esc(note)}</small></a>`;
}
const dateShort=value=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const netSales=values=>values.revenue-values.refund;
function overviewChart(data,compare) {
  const series=data.overviewSeries;
  const hasCurrent=data.coverage && data.span.end>=data.coverage;
  const hasComparison=compare && data.coverage && data.prior.start>=data.coverage;
  const values=series.flatMap(row=>hasComparison?[row.net,row.previous]:[row.net]);
  const max=Math.max(1,...values), min=Math.min(0,...values);
  const scale=max-min;
  const range=(from,to)=>dateShort(from)+(from===to?'':'–'+dateShort(to));
  const makeBar=(value,label,previous=false)=>`<button type="button" class="dashboard-bar${previous?' prior':''}"
    data-scale="${100*Math.abs(value)/scale}" data-negative="${value<0}" data-point="${esc(label)}"
    aria-label="${esc(label)}" title="${esc(label)}"></button>`;
  const bars=series.map(row=>{
    const current=makeBar(row.net,range(row.start,row.end)+' · Net sales · '+price(row.net));
    const previous=hasComparison?makeBar(row.previous,range(row.priorStart,row.priorEnd)+' · Previous period · '+price(row.previous),true):'';
    return `<div class="dashboard-bar-group"><div class="dashboard-bar-rail">${current}${previous}</div><small>${dateShort(row.start)}</small></div>`;
  }).join('');
  const legend='<span><i></i> Net sales</span>'+(hasComparison?'<span><i class="prior"></i> Previous period</span>':'');
  return `<section class="frame dashboard-panel"><div class="dashboard-panel-heading"><h2>Sales over time</h2>
    <div class="dashboard-legend">${legend}</div></div>
    ${hasCurrent?`<div class="dashboard-chart" data-zero="${100*max/scale}">${bars}</div>
      <p class="small dashboard-chart-caption" aria-live="polite">Select a bar to see the amount.</p>`:empty('No sales history for this period.')}
    ${compare && !hasComparison?'<p class="small">There’s no complete history for the comparison period yet.</p>':''}</section>`;
}
function overviewThemes(themes,canCompare,days) {
  const current=themes.filter(theme=>theme.units>0);
  if (canCompare) current.sort((a,b)=>b.change-a.change || b.units-a.units);
  return `<section class="frame dashboard-panel dashboard-themes"><div class="dashboard-panel-heading"><h2>Product themes</h2>
    ${staffAnchor(staffLink('Reports',{days})+'#theme-trends','View trends')}</div>
    ${current.length?dataTable(['Theme','Units sold',...(canCompare?['Change']:[])],current.slice(0,3).map(theme=>[
      esc(theme.name),theme.units,...(canCompare?[(theme.change>0?'+':'')+theme.change]:[])
    ])):empty('Add themes to similar products to see what’s selling across SKUs.')}</section>`;
}
function wireOverviewChart(target) {
  const chart=$('.dashboard-chart',target);
  if (!chart) return;
  chart.style.setProperty('--zero',chart.dataset.zero+'%');
  for (const bar of $$('.dashboard-bar',chart)) {
    bar.style.setProperty('--bar-height',bar.dataset.scale+'%');
    bar.addEventListener('click',()=>$('.dashboard-chart-caption',target).textContent=bar.dataset.point);
  }
}
async function renderOverview(body,params) {
  let days=overviewDays(params.get('days'));
  let compare=params.get('compare')!=='0';
  body.innerHTML=workspaceHeading('Store overview',
    `<label>Sales period<select id="overview-period">${overviewPeriods.map(day=>option(day,`Last ${day} days`,days)).join('')}</select></label>
    <label class="check"><input id="overview-compare" type="checkbox" ${compare?'checked':''}> Compare period</label>`)+
    '<div id="overview-content" aria-live="polite"></div>';
  const target=$('#overview-content',body);
  const period=$('#overview-period',body);
  const comparison=$('#overview-compare',body);
  let version=0;
  async function refresh() {
    const request=++version;
    target.innerHTML=empty('Loading overview…');
    try {
      const [data,orders]=await Promise.all([api('/api/staff/dashboard?'+overviewQuery(days)),api('/api/staff/orders')]);
      if (request!==version) return;
      const {sales,previous,snapshot,attention,age,low}=data;
      setPendingCount(attention.pending);
      const reports=staffLink('Reports',{days});
      const inventory=staffLink('Inventory');
      const approvals=staffLink('Orders',{view:'pending'});
      const aging=staffLink('Inventory',{view:'aging'});
      const lowStock=staffLink('Inventory',{view:'low',days});
      const inventoryCost=price(snapshot.value);
      const completePrior=data.coverage && data.prior.start>=data.coverage;
      const delta=netSales(sales)-netSales(previous);
      const salesNote=compare && completePrior?`${delta>0?'+':''}${price(delta)} vs. previous period`:'Sales less refunds';
      const attentionLink=(label,note,count,url)=>`<a class="attention-link" href="${esc(url)}">
        <span><strong>${esc(label)}</strong><small>${esc(note)}</small></span>${badge(String(count),count>0)}</a>`;
      target.innerHTML=`<section class="dashboard-section" aria-labelledby="sales-metrics"><h2 id="sales-metrics">Sales</h2>
        <div class="dashboard-metrics dashboard-sales">
        ${dashboardMetric('Net sales',price(netSales(sales)),salesNote,reports,'plum')}
        ${dashboardMetric('Units sold',sales.units,`Last ${days} days`,reports)}
        ${dashboardMetric('Pending approvals',attention.pending,'Awaiting manager review',approvals,'sand')}
        </div></section>
        <section class="dashboard-section" aria-labelledby="inventory-metrics"><h2 id="inventory-metrics">Inventory</h2>
        <div class="dashboard-metrics dashboard-stock">
        ${dashboardMetric('Units on hand',snapshot.units,'Current stock',inventory)}
        ${dashboardMetric('Inventory cost',inventoryCost,snapshot.unknown_cost?`${snapshot.unknown_cost} units with unknown cost`:'Current stock at cost',inventory)}
        ${dashboardMetric('Stock over 90 days',age.reduce((total,row)=>total+row.units,0),snapshot.unknown_age?`${snapshot.unknown_age} units with unknown age`:'Units in older batches',aging)}
        ${dashboardMetric('Low-stock sellers',low.length,`Last units of items sold in ${days} days`,lowStock)}
        </div></section>
        <div class="dashboard-columns">${overviewChart(data,compare)}
          <div class="dashboard-side"><section class="frame dashboard-panel dashboard-attention"><h2>Needs attention</h2>
          ${attentionLink('Pending approvals','Sales waiting for review',attention.pending,approvals)}
          ${attentionLink('Damage reports','Open reports from staff',attention.issues,staffLink('Damage reports'))}
          ${attentionLink('Low-stock sellers','Last units available',low.length,lowStock)}</section>
          ${overviewThemes(data.themeTrends,compare && completePrior,days)}</div>
        </div>
        <section class="frame dashboard-panel"><div class="dashboard-panel-heading"><h2>Recent orders</h2>
          ${staffAnchor(staffLink('Orders',{view:'all'}),'View all orders')}</div>
          ${dataTable(['Order','Date','Customer','Line items','Net total'],orders.items.slice(0,5).map(order=>[
            staffAnchor(orderLink(order.id),'Order '+order.id.slice(0,8).toUpperCase()),esc(order.sold_on),
            order.customer_id?staffAnchor(customerLink(order.customer_id),order.customer_name):'Walk-in',
            order.line_count,esc(price(order.gross-order.refunds))]),'No orders have been closed yet.')}</section>`;
      wireOverviewChart(target);
    } catch(error) {
      if (request===version) target.innerHTML=empty(error.message);
    }
  }
  const change=()=>{
    days=Number(period.value);
    compare=comparison.checked;
    history.replaceState(null,'',staffLink('Overview',{days,compare:compare?1:0}));
    refresh();
  };
  period.addEventListener('change',change);
  comparison.addEventListener('change',change);
  await refresh();
}
async function renderDashboard(body,params) {
  const days=overviewDays(params.get('days'));
  let closeoutSku='';
  body.innerHTML=workspaceHeading('Reports')+`<div class="frame"><form id="daterange" class="formgrid">
    <label>Period<select name="preset"><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="3m">Last three calendar months</option><option value="month">This month</option><option value="custom">Custom dates</option></select></label>
    ${field('start','From',addDays(meta.today,1-days),'date','required')}${field('end','Through',meta.today,'date','required')}
    <label>Compare with<select name="compare"><option value="previous">Previous equivalent period</option><option value="year">Same period last year</option></select></label>
    <label>Group results<select name="group"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
    <label>Product type<select name="type">${options('type',null,'All product types')}</select></label>
    <div class="span">${button('Apply filters')}</div></form></div><div id="report"></div>`;
  const form=$('#daterange',body);
  if (days===7) form.elements.preset.value='7';
  if (days===90) form.elements.preset.value='custom';
  let reportVersion=0;
  const refresh=async (values,showCloseout=false)=>{
    const request=++reportVersion;
    const report=$('#report',body);
    report.innerHTML=empty('Loading reports…');
    try {
      const data=await api('/api/staff/dashboard?'+new URLSearchParams({...values,sku:closeoutSku}));
      if (request!==reportVersion) return;
      drawDashboard(report,data,closeoutSku,showCloseout || location.hash==='#stock-closeout');
      formHandler($('#closeout-filter',report),async filters=>{
        const value=filters.sku.trim();
        if (value && !/^[A-Z0-9][A-Z0-9_-]{0,39}$/i.test(value)) throw new Error('Enter a valid SKU.');
        closeoutSku=value;
        await refresh(format(form),true);
      });
    } catch(error){if (request===reportVersion) report.innerHTML=empty(error.message);}
  };
  formHandler(form,values=>refresh(values));
  form.elements.preset.addEventListener('change',()=>{
    const preset=form.elements.preset.value;
    if(preset==='custom') return;
    form.elements.start.value=preset==='3m'?monthsBack(meta.today,2):preset==='month'?monthsBack(meta.today,0):addDays(meta.today,1-Number(preset));
    form.elements.end.value=meta.today;
    if(preset==='3m') form.elements.group.value='month';
    refresh(format(form));
  });
  for(const name of ['start','end']) form.elements[name].addEventListener('change',()=>{form.elements.preset.value='custom';});
  await refresh(format(form));
  if (location.hash==='#theme-trends') $('#theme-trends',body)?.scrollIntoView();
}
function drawDashboard(report,data,sku,showCloseout) {
  const metric=(label,value,caption='')=>`<div class="metric"><span class="small">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(caption)}</small></div>`;
  const section=(name,head,rows)=>`<details class="frame"><summary>${esc(name)}</summary>${table(head,rows)}</details>`;
  const net=s=>s.revenue-s.refund;
  const compareOk=data.coverage && data.prior.start>=data.coverage;
  const changed=(current,previous,formatValue=x=>x)=>!compareOk?'No historical data':
    [`${current>=previous?'+':''}${formatValue(current-previous)}`,previous?`(${Math.round((current-previous)/Math.abs(previous)*100)}%)`:''].join(' ');
  const max=Math.max(1,...data.series.map(row=>row.revenue));
  const popular=[...data.interest].sort((a,b)=>b.views-a.views);
  const byName=item=>`${item.name} (${item.sku})`;
  report.innerHTML=`<div class="metrics">
    ${metric('Pending approvals',data.attention.pending,`${data.attention.issues} open damage reports`)}
    ${metric('Inventory cost',price(data.snapshot.value),`${data.snapshot.unknown_cost} units with unknown cost`)}
    ${metric('Stock over 90 days',data.age.reduce((total,item)=>total+item.units,0),`${data.snapshot.unknown_age} units with unknown age`)}
    ${metric('Net sales',price(net(data.sales)),changed(net(data.sales),net(data.previous),price))}</div>
    <div class="metrics">${metric('Units sold',data.sales.units,changed(data.sales.units,data.previous.units))}
    ${metric('Units returned',data.sales.returned)}${metric('Gross profit',price(data.sales.profit),data.sales.unknown?`${data.sales.unknown} entries with missing cost`:changed(data.sales.profit,data.previous.profit,price))}
    ${metric('Units on hand',data.snapshot.units)}</div>
    <div class="frame"><h3>Sales over time</h3><p class="small">${esc(data.span.start)} to ${esc(data.span.end)} · Comparison ${esc(data.prior.start)} to ${esc(data.prior.end)}</p>
    ${!data.coverage||data.span.start<data.coverage?'<p class="small">Historical coverage is incomplete for the selected period.</p>':''}
    ${data.series.length?`<div class="chart">${data.series.map(row=>`<div class="chart-row"><span>${esc(row.bucket)}</span>
    <meter min="0" max="${max}" value="${row.revenue}" aria-label="Gross sales for ${esc(row.bucket)}"></meter><span>${esc(price(row.revenue))}</span></div>`).join('')}</div>`:empty('No approved sales in this date range.')}</div>
    <details class="frame" id="stock-closeout" ${showCloseout?'open':''}><summary>Stock closeout</summary>
      <form id="closeout-filter" class="controls">${field('sku','Closeout SKU',sku,'text','placeholder="All SKUs"')}${button('Filter stock closeout','secondary')}</form>
      ${table(['SKU','Opening','Received','Sold','Restocked','Adjusted','Closing'],
        data.closeout.map(r=>[byName(r),r.opening,r.received,r.sold,r.restocked,r.adjusted,r.closing]))}</details>
    ${section('Stock over 90 days',['Product','Oldest batch','Units','Cost'],data.age.map(r=>[byName(r),r.oldest,r.units,price(r.value)]))}
    <details class="frame" id="theme-trends" ${location.hash==='#theme-trends'?'open':''}><summary>Product theme trends</summary>
      <p class="small">Approved units sold across SKUs, including sold-out items. An item can count toward more than one theme.</p>
      ${table(['Theme','Units sold','Distinct SKUs sold','Prior units','Change'],data.themeTrends.map(theme=>[
        theme.name,theme.units,theme.sku_count,compareOk?theme.previous:'—',compareOk?theme.change:'—'
      ]))}</details>
    ${section('Trending sales',['Product','Units','Prior units','Change'],data.trends.map(r=>[byName(r),r.units,compareOk?r.previous:'—',compareOk?r.change:'—']))}
    ${section('Low-stock sellers',['Product','Available'],data.low.map(r=>[byName(r),r.available]))}
    ${section('No approved sales in this period',['Product','Available'],data.slow.map(r=>[byName(r),r.available]))}
    ${section('Least-viewed active listings',['Product','Published','Views','WhatsApp clicks'],
      [...popular].reverse().map(r=>[byName(r),r.published_at?.slice(0,10)||'—',r.views,r.clicks]))}
    ${section('Most-viewed active listings',['Product','Published','Views','WhatsApp clicks'],
      popular.map(r=>[byName(r),r.published_at?.slice(0,10)||'—',r.views,r.clicks]))}`;
}
async function boot() {
  try {
    await updateMeta();
    if (location.pathname==='/staff') return await openStaff();
    const item=location.pathname.match(/^\/products\/([^/]+)$/);
    if(item) return await renderPublicProduct(decodeURIComponent(item[1]));
    renderShop();
  } catch(error) {
    main.innerHTML=`<div class="shell section"><h2>${error.status===404?'Item unavailable':'Luxor Moolah'}</h2>
    ${empty(error.message)}<a class="button secondary" href="/">Back to the shop</a></div>`;
  }
}
window.addEventListener('popstate',()=>boot());
boot();
