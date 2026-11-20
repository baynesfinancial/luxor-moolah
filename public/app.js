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
async function openStaff() {
  try { staff=await api('/api/staff/me'); }
  catch (error) { if (error.status===401) return signIn(); throw error; }
  const manager=staff.role==='manager';
  const params=new URLSearchParams(location.search);
  const sku=params.get('sku');
  const tabs=manager?['Dashboard','Inventory','Sales','Damage reports','CSV upload','Categories','Team']:['Inventory','My sales'];
  activeTab=tabs.includes(params.get('tab'))?params.get('tab'):sku?'Inventory':tabs[0];
  main.innerHTML=`<div class="shell section"><div class="sectionhead"><div><h2>${manager?'Manager dashboard':'Staff workspace'}</h2>
    <span class="small">${esc(staff.email)}</span></div><button class="button secondary" id="signout">Sign out</button></div>
    <nav class="tabs" aria-label="Staff sections">${tabs.map(tab=>`<button type="button" data-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</nav>
    <div id="staffbody"></div></div>`;
  $('#signout').addEventListener('click',async()=>{try { await api('/api/auth/sign-out',{}); location.assign('/staff'); } catch(error){notify(error.message);} });
  $$('[data-tab]').forEach(element=>element.addEventListener('click',()=>{
    history.pushState(null,'','/staff?tab='+encodeURIComponent(element.dataset.tab));
    loadTab(element.dataset.tab);
  }));
  await loadTab(activeTab,sku);
}
async function loadTab(tab,sku=null) {
  activeTab=tab;
  $$('[data-tab]').forEach(element=>element.classList.toggle('active',element.dataset.tab===tab));
  const body=$('#staffbody');
  body.innerHTML=empty('Loading…');
  try {
    if (tab==='Inventory') {
      if (sku) return await renderStaffProduct(body,sku);
      return await renderStaffInventory(body);
    }
    if (tab==='Sales'||tab==='My sales') return await renderSales(body);
    if (tab==='Damage reports') return await renderIssues(body);
    if (tab==='CSV upload') return await renderImport(body);
    if (tab==='Categories') return renderCategories(body);
    if (tab==='Team') return await renderTeam(body);
    return await renderDashboard(body);
  } catch (error) { body.innerHTML=empty(error.message); }
}
async function renderStaffInventory(body) {
  const recent=await api('/api/staff/recent');
  body.innerHTML=`${staff.role==='manager'?'<div class="actions"><h3>Inventory</h3><button class="button" id="new-product">Add item</button></div><div id="product-editor"></div>':''}
    ${recent.length?`<div class="controls"><span class="small">Recently opened</span>${recent.map(item=>`<a class="button secondary" href="/staff?sku=${esc(item.sku)}">${esc(item.name)}</a>`).join('')}</div>`:''}${catalogFilters()}`;
  $('#new-product')?.addEventListener('click',()=>renderProductEditor($('#product-editor'),null));
  wireCatalog(true);
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
    ${text('description','Description',item.description)}${audienceInputs(item.categories??[])}`;
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
  return rows.length?`<div class="tablewrap"><table><thead><tr>${headers.map(title=>`<th scope="col">${esc(title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty('No records for this report.');
}
async function renderSales(body) {
  const sales=await api('/api/staff/sales');
  const manager=staff.role==='manager';
  body.innerHTML=`<h3>${manager?'Sale approvals':'My sales'}</h3>${sales.length?sales.map(sale=>
    `<details class="frame" ${sale.status==='pending'?'open':''}><summary>${esc(sale.name)} · ${sale.quantity} · ${esc(sale.sold_on)} · ${badge(sale.returned>=sale.quantity?'Returned':sale.returned>0?'Partially returned':sale.status,sale.status==='pending')}</summary>
      ${manager?`<p class="small">${esc(sale.employee)} · submitted ${esc(sale.submitted_at)}</p>`:''}
      ${sale.notes.map(note=>`<p>${esc(note.note)}</p>`).join('')}
      ${sale.status==='pending'?(manager?`<form data-review="${sale.id}" class="formgrid">
        ${field('sku','SKU',sale.sku,'text','required')}${field('quantity','Units',sale.quantity,'number','min="1" required')}
        ${field('sold_on','Sale date',sale.sold_on,'date','required')}${field('unit_price','Actual price per unit',amount(sale.unit_price),'number','min="0" step="0.01"')}
        ${text('note','Review note')}<div class="span controls"><button class="button" value="approved">Approve</button>
        <button class="button secondary" value="pending">Save correction</button><button class="button danger" value="canceled">Cancel sale</button></div></form>`:
        `<form data-note="${sale.id}" class="formgrid">${text('note','Correction note')}<div class="span">${button('Send note')}</div></form>`):
        manager && sale.status==='approved' && sale.returned<sale.quantity ? `<form data-return="${sale.id}" class="formgrid">
          ${field('returned_on','Return date',meta.today,'date','required')}<label class="check"><input name="restock" type="checkbox" checked>Return units to stock</label>
          ${field('quantity','Units returned',sale.quantity-sale.returned,'number',`min="1" max="${sale.quantity-sale.returned}" required`)}
          ${field('refund','Total refund','','number','min="0" step="0.01" placeholder="Defaults to original unit price"')}
          ${text('note','Return reason')}<div class="span">${button('Record return','secondary')}</div></form>`:''}
    </details>`).join(''):empty('No sales recorded yet.')}`;
  $$('[data-review]',body).forEach(form=>formHandler(form,async(data,_,submit)=>{
    await api(`/api/staff/sales/${form.dataset.review}/review`,{...data,status:submit.value});
    notify('Sale updated.'); await renderSales(body);
  }));
  $$('[data-note]',body).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/sales/${form.dataset.note}/notes`,data); notify('Note sent.'); await renderSales(body);
  }));
  $$('[data-return]',body).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/sales/${form.dataset.return}/return`,{...data,restock:!!data.restock}); notify('Return recorded.'); await renderSales(body);
  }));
}
async function renderIssues(body) {
  const issues=await api('/api/staff/issues');
  body.innerHTML=`<h3>Damage reports</h3>${issues.length?issues.map(issue=>`<div class="frame">
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
  body.innerHTML=`<div class="frame"><h3>Invite an employee</h3><form class="formgrid" id="invite">
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
async function renderDashboard(body) {
  body.innerHTML=`<form id="daterange" class="formgrid">
    <label>Period<select name="preset"><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="3m">Last three calendar months</option><option value="month">This month</option><option value="custom">Custom dates</option></select></label>
    ${field('start','From',addDays(meta.today,-29),'date','required')}${field('end','Through',meta.today,'date','required')}
    <label>Compare with<select name="compare"><option value="previous">Previous equivalent period</option><option value="year">Same period last year</option></select></label>
    <label>Group results<select name="group"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
    <label>Product type<select name="type">${options('type',null,'All product types')}</select></label>
    ${field('sku','Closeout SKU','','text','placeholder="All SKUs"')}
    <div class="span">${button('Apply filters')}</div></form><div id="report"></div>`;
  const form=$('#daterange');
  const refresh=async values=>{
    const report=$('#report');
    report.innerHTML=empty('Loading reports…');
    try { const data=await api('/api/staff/dashboard?'+new URLSearchParams(values)); drawDashboard(report,data); }
    catch(error){report.innerHTML=empty(error.message);}
  };
  formHandler(form,refresh);
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
}
function drawDashboard(report,data) {
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
    ${section('Stock closeout',['SKU','Opening','Received','Sold','Restocked','Adjusted','Closing'],
      data.closeout.map(r=>[byName(r),r.opening,r.received,r.sold,r.restocked,r.adjusted,r.closing]))}
    ${section('Stock over 90 days',['Product','Oldest batch','Units','Cost'],data.age.map(r=>[byName(r),r.oldest,r.units,price(r.value)]))}
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
