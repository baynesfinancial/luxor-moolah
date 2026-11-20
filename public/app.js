import { parseCSV, draftRows, rowKey } from './csv.js';

const main = document.querySelector('#main');
const toast = document.querySelector('#toast');
let meta;
let staff;
let activeTab;
let timer;
const workspaceViewKey = 'luxor-workspace-view';
const wantsStaffPreview = () => location.pathname==='/staff' && sessionStorage.getItem(workspaceViewKey)==='staff';
const staffPreview = wantsStaffPreview();
const $ = (query,scope=document) => scope.querySelector(query);
const $$ = (query,scope=document) => [...scope.querySelectorAll(query)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price = value => value == null ? '—' : new Intl.NumberFormat('en',{style:'currency',currency:meta.currency,currencyDisplay:'code',maximumFractionDigits:value%100?2:0}).format(value/100);
const amount = value => value == null ? '' : String(value/100);
const option = (value,label,selected) => `<option value="${esc(value)}"${String(value)===String(selected)?' selected':''}>${esc(label)}</option>`;
const options = (kind,selected,first) => option('',first,selected)+meta.categories.filter(row=>row.kind===kind).map(row=>option(row.id,row.name,selected)).join('');
const list = (value,separator=',') => String(value??'').split(separator).filter(Boolean);
const badge = (text,pending=false) => `<span class="badge${pending?' pending':''}">${esc(text)}</span>`;
const img = (asset,alt,cls='photo') => `<img class="${cls}" src="/api/photo/${esc(asset)}${staffPreview?'?view=staff':''}" alt="${esc(alt)}" loading="lazy">`;
const blank = name => `<div class="placeholder" aria-hidden="true">${esc(name?.slice(0,2).toUpperCase() || 'LM')}</div>`;
const empty = message => `<div class="empty">${esc(message)}</div>`;
const button = (label,extra='') => `<button class="button ${extra}">${esc(label)}</button>`;
const updateMeta = async () => { meta=await api('/api/meta'); };
const groupedMoney = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const format = form => {
  const data=Object.fromEntries(new FormData(form));
  for (const input of $$('[data-money]',form)) {
    if (groupedMoney.test(data[input.name])) data[input.name]=data[input.name].replaceAll(',','');
  }
  return data;
};
function notify(message) {
  toast.textContent=message;
  clearTimeout(timer);
  timer=setTimeout(()=>{toast.textContent='';},5500);
}
async function api(path, data) {
  const body = data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data);
  const headers=body && !(data instanceof FormData)?{'Content-Type':'application/json'}:{};
  if (staffPreview && path.startsWith('/api/staff/')) headers['X-Workspace-View']='staff';
  const response = await fetch(path,{method:data===undefined?'GET':'POST',body,headers});
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
function commaAmount(value) {
  const raw=String(value??'').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return raw;
  const [whole,fraction]=raw.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?`.${fraction}`:'');
}
function moneyField(name,label,value='',extra='') {
  return field(name,label,commaAmount(value),'text',`inputmode="decimal" data-money ${extra}`);
}
main.addEventListener('change',event=>{
  if (event.target.matches('[data-money]')) event.target.value=commaAmount(event.target.value);
});
function text(name,label,value='',extra='') {
  return `<label class="span">${esc(label)}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
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
  const availability=isStaff ? badge(`${Math.max(p.available,0)} available`) : p.available<=0?badge('Pending Sale',true):
    p.available===1?badge('Only 1 left',true):'';
  const type=`<span class="small">${esc(p.product_type || p.sku)}</span>`;
  return `<a class="product-card" href="${link}">${p.cover?img(p.cover,p.name):blank(p.name)}
    <div class="product-copy">${isStaff?type:`<div class="storefront-card-meta">${type}${availability}</div>`}
    <h3>${esc(p.name)}</h3>${p.display_price!=null?`<p${isStaff?'':' class="storefront-price"'}>${esc(price(p.display_price))}
      ${!isStaff&&p.original_price!=null?`<del aria-label="Original price ${esc(price(p.original_price))}">${esc(price(p.original_price))}</del>`:''}</p>`:''}${isStaff?availability:''}</div></a>`;
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
async function renderShop() {
  const {featured,arrivals,clearance}=await api('/api/shop-home').catch(()=>({featured:[],arrivals:[],clearance:[]}));
  const hero=[...featured,...arrivals,...clearance].find(item=>item.cover);
  const anchor=featured.length?'featured':arrivals.length?'just-in':'catalog';
  main.innerHTML=`<div class="storefront-home"><section class="storefront-hero"><div class="shell storefront-hero-grid${hero?'':' storefront-hero-simple'}">
    <div class="storefront-hero-copy"><h1>Small batches.<br><em>One-of-a-kind finds.</em></h1>
    <p>Gifts and everyday favorites in limited quantities. See what’s in the shop today.</p>
    <a href="#${anchor}" class="button gold">${featured.length?'Browse the featured edit':arrivals.length?'See what’s new':'Browse the shop'}</a></div>
    ${hero?`<a class="storefront-hero-photo" href="/products/${encodeURIComponent(hero.sku)}">${img(hero.cover,hero.name)}<span>${esc(hero.name)}</span></a>`:''}</div></section>
    ${featured.length?`<section class="shell storefront-section" id="featured" aria-labelledby="featured-heading">
      <div class="storefront-heading"><h2 id="featured-heading">The Featured Edit</h2><a href="#catalog">Shop all</a></div>
      <div class="cards storefront-featured">${featured.map(item=>productCard(item,false)).join('')}</div></section>`:''}
    ${arrivals.length?`<section class="storefront-arrivals storefront-section" id="just-in" aria-labelledby="arrivals-heading"><div class="shell">
      <div class="storefront-heading"><h2 id="arrivals-heading">Just In</h2></div>
      <div class="cards">${arrivals.map(item=>productCard(item,false)).join('')}</div></div></section>`:''}
    ${clearance.length?`<section class="shell storefront-last storefront-section" id="last-chance" aria-labelledby="clearance-heading">
      <div class="storefront-last-copy"><h2 id="clearance-heading">Last Chance</h2><p>Clearance finds, while they last.</p></div>
      <div class="cards">${clearance.map(item=>productCard(item,false)).join('')}</div></section>`:''}
    <section class="shell storefront-section" id="catalog"><h2>Shop the collection</h2>${catalogFilters()}</section></div>`;
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
    ${item.available<=0?badge('Pending Sale',true):item.available===1?badge('Only 1 left',true):badge('Available')}</div>
    <h1 class="display">${esc(item.name)}</h1><p class="price storefront-price">${esc(price(item.display_price))}
      ${item.original_price!=null?`<del aria-label="Original price ${esc(price(item.original_price))}">${esc(price(item.original_price))}</del>`:''}</p>
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
const managerSections = [['Overview','▦'],['Orders','▤'],['Customers','◇'],['Inventory','▧'],['Reports','▥'],['Team','○']];
const homepageLabels={featured:'Featured',arrivals:'Just In',clearance:'Last Chance'};
let attentionRevision=0;

function switchWorkspaceView(view) {
  if (view==='staff') sessionStorage.setItem(workspaceViewKey,'staff');
  else sessionStorage.removeItem(workspaceViewKey);
  location.assign(staffLink(view==='staff'?'Inventory':'Team'));
}

async function openStaff() {
  try { staff=await api('/api/staff/me'); }
  catch (error) {
    if (error.status!==401) throw error;
    sessionStorage.removeItem(workspaceViewKey);
    return signIn();
  }
  const manager=staff.role==='manager';
  const params=new URLSearchParams(location.search);
  const sku=params.get('sku');
  const aliases={Dashboard:'Overview',Sales:'Orders','CSV upload':'Inventory',Categories:'Inventory','Damage reports':'Reports'};
  const requested=params.get('tab');
  if (manager) {
    if (requested==='Sales' && !params.has('view')) params.set('view','pending');
    if (requested==='CSV upload') params.set('view','upload');
    if (requested==='Damage reports') params.set('view','damage');
    if (requested==='Categories') params.set('view','categories');
  }
  const tabs=manager?managerSections:[['Inventory','▧'],['My sales','▤']];
  let tab=(manager?aliases[requested]:null)||requested;
  if (manager && tab==='Reports' && ['low','aging'].includes(params.get('view'))) tab='Inventory';
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
    <div class="workspace-content">${manager?'<div id="homepage-alerts" role="status" hidden></div>':''}
      ${staff.previewing_staff?`<div class="workspace-preview actions">
        <p><strong>Staff preview</strong> · Sales and damage reports are saved to this store under your account.</p>
        <button type="button" class="button secondary" id="exit-staff-preview">Return to admin view</button>
      </div>`:''}<div id="staffbody"></div></div></div>`;
  $('#workspace-menu').addEventListener('click',event=>{
    const open=$('#workspace-sidebar').classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });
  $('#exit-staff-preview')?.addEventListener('click',()=>switchWorkspaceView('admin'));
  $('#signout').addEventListener('click',async()=>{
    try { await api('/api/auth/sign-out',{}); sessionStorage.removeItem(workspaceViewKey); location.assign('/staff'); }
    catch(error){notify(error.message);}
  });
  if (manager) refreshWorkspaceAttention();
  await loadTab(activeTab,sku,params);
}
async function refreshWorkspaceAttention() {
  const target=$('#homepage-alerts');
  if (!target) return;
  const revision=++attentionRevision;
  try {
    const {pending,homepage=[]}=await api('/api/staff/attention');
    if (!target.isConnected || revision!==attentionRevision) return;
    setPendingCount(pending);
    target.hidden=!homepage.length;
    target.innerHTML=homepage.map(entry=>`<p><strong>${esc(entry.name)} sold out.</strong>
      <a href="${esc(staffLink('Inventory',{view:'homepage'}))}#homepage-pick-${entry.section}-${entry.slot}">Refill ${esc(homepageLabels[entry.section])} picks</a></p>`).join('');
  } catch { /* The notifications are supplementary. */ }
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
function subnav(tab,views,current,params={}) {
  return `<nav class="workspace-subnav" aria-label="${esc(tab)} views">${views.map(([key,label])=>
    `<a href="${esc(staffLink(tab,{...params,view:key}))}" ${key===current?'aria-current="page"':''}>${esc(label)}</a>`).join('')}</nav>`;
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
const inventoryViews=[['all','All inventory'],['low','Low-stock sellers'],['aging','Stock over 90 days'],['upload','CSV upload'],['categories','Categories'],['homepage','Homepage picks']];
async function renderInventoryPage(body,params) {
  const view=inventoryViews.some(([key])=>key===params.get('view'))?params.get('view'):'all';
  body.innerHTML=workspaceHeading('Inventory',
    `<a class="button secondary" href="${esc(staffLink('Inventory',{view:'upload'}))}">Upload CSV</a>
    <button type="button" class="button" id="new-product" aria-controls="inventory-action" aria-expanded="false">Add item</button>`)+
    subnav('Inventory',inventoryViews,view)+'<div id="inventory-action"></div><div id="inventory-page"></div>';
  const actions=$('#inventory-action',body);
  const add=$('#new-product',body);
  function closeAction() {
    actions.replaceChildren();
    add.setAttribute('aria-expanded','false');
    add.focus();
  }
  actions.addEventListener('keydown',event=>{
    if (event.key==='Escape' && !event.defaultPrevented) closeAction();
  });
  add.addEventListener('click',()=>{
    if (add.getAttribute('aria-expanded')==='true') return closeAction();
    add.setAttribute('aria-expanded','true');
    renderProductEditor(actions,null);
    $('[data-close-inventory]',actions).addEventListener('click',closeAction);
    $('input',actions).focus();
  });
  const content=$('#inventory-page',body);
  if (view==='upload') return renderImport(content);
  if (view==='categories') return renderCategories(content);
  if (view==='homepage') {
    await renderHomepagePicks(content);
    if (location.hash.startsWith('#homepage-pick-')) document.getElementById(location.hash.slice(1))?.scrollIntoView?.();
    return;
  }
  if (view==='all') return renderStaffInventory(content);
  const days=overviewDays(params.get('days'));
  const productType=Number(params.get('type'))||null;
  const query=overviewQuery(days);
  if (productType) query.set('type',productType);
  const data=await api('/api/staff/dashboard?'+query);
  const age=view==='aging';
  const rows=age?data.age:data.low;
  const slow=age?[]:data.slow;
  const hasInventory=rows.length>0 || slow.length>0 || (age && data.snapshot.unknown_age>0);
  const itemLink=sku=>'/staff?sku='+encodeURIComponent(sku);
  const metrics=age?[
    ['Units over 90 days',rows.reduce((sum,row)=>sum+row.units,0)],
    ['Inventory cost',price(rows.reduce((sum,row)=>sum+(row.value??0),0))],
    ['Units with unknown age',data.snapshot.unknown_age]
  ]:[['Matching SKUs',rows.length],['Units available',rows.reduce((sum,row)=>sum+row.available,0)]];
  content.innerHTML=`<h2>${age?'Stock over 90 days':'Low-stock sellers'}</h2>${reportMetrics(metrics)}
    ${hasInventory||productType||params.get('filtered')==='1'?`<div class="frame"><form class="filter-grid" id="inventory-filter">
      ${age?'':`<label>Sales period<select name="days">${[7,30,90].map(value=>option(value,`Last ${value} days`,days)).join('')}</select></label>`}
      <label>Product type<select name="type">${options('type',productType,'All product types')}</select></label>
      <div class="form-action">${button('Apply filters')}</div></form></div>`:''}
    ${rows.length?reportPanel(age?'Aged inventory':'Last units available',
      (age?'':`<p class="small">Items sold in the last ${days} days with three or fewer units available.</p>`)+
      reportTable(age?['Product','Oldest batch','Aged units','Cost']:['Product','Available','SKU'],
        rows.map(row=>[row.name,...(age?[row.oldest,row.units,price(row.value)]:[row.available,row.sku])]),age?2:1,
        index=>itemLink(rows[index].sku))):''}
    ${slow.length?reportPanel('No approved sales in this period',reportTable(['Product','Available','SKU'],
      slow.map(row=>[row.name,row.available,row.sku]),1,index=>itemLink(slow[index].sku))):''}`;
  const filter=$('#inventory-filter',content);
  if (filter) formHandler(filter,async values=>{
    location.assign(staffLink('Inventory',{view,days:values.days??days,type:values.type,filtered:1}));
  });
}
async function renderHomepagePicks(target) {
  const {display,assignments,overrides,pinned,choices}=await api('/api/staff/homepage-picks');
  const sections=[
    {key:'featured',title:'Featured',slots:5,hint:'The first three available picks appear. The remaining picks are backups.'},
    {key:'arrivals',title:'Just In',slots:4,hint:'The first two eligible pins appear. Open spots use the newest available listings published in the past 14 days.'},
    {key:'clearance',title:'Last Chance',slots:3,hint:'The first eligible pin appears. The automatic pick is the available item that has been on clearance the longest.'}
  ];
  target.innerHTML=`<h2>Homepage picks</h2>${sections.map(({key,title,slots,hint})=>{
    const featured=key==='featured';
    const selected=featured?assignments:overrides.filter(row=>row.section===key);
    const eligible=featured?selected.filter(row=>choices[key].some(item=>item.sku===row.sku)):pinned.filter(row=>row.section===key);
    const showing=display[key].map(item=>esc(item.name)).join(' · ')||'No eligible picks';
    return `<section class="frame homepage-pick-section"><h3>${title}</h3><p class="small">${hint}</p>
      <p class="small">${eligible.length} of ${slots} picks available</p>
      <p><strong>Currently showing</strong> ${showing}</p>
      ${Array.from({length:slots},(_,index)=>{
        const slot=index+1;
        const current=selected.find(row=>row.slot===slot);
        const available=choices[key];
        const absent=current&&!available.some(row=>row.sku===current.sku);
        const label=`${title} position ${slot}`;
        const fallback=featured?'No pick':'Automatic';
        const inactive=current&&!eligible.some(row=>row.slot===slot);
        const backup=current&&!inactive&&!display[key].some(row=>row.sku===current.sku);
        return `<form id="homepage-pick-${key}-${slot}" class="filter-grid homepage-pick-form" data-homepage-pick="${key}" data-slot="${slot}">
          <label>${label}<select name="sku">${option('',fallback,current?.sku??'')}
          ${absent?option(current.sku,`${current.name} (currently unavailable)`,current.sku):''}
          ${available.map(item=>option(item.sku,`${item.name} · ${item.sku}`,current?.sku)).join('')}</select></label>
          <div class="form-action">${button('Save pick','secondary')}</div>
          ${inactive?`<small class="span">${featured?'This pick is hidden while unavailable.':'This pin is inactive. An eligible backup or an automatic pick can take its place.'}</small>`:
            backup?'<small class="span">Available backup</small>':''}</form>`;
      }).join('')}</section>`;
  }).join('')}`;
  $$('[data-homepage-pick]',target).forEach(form=>formHandler(form,async data=>{
    await api('/api/staff/homepage-picks',{...data,section:form.dataset.homepagePick,slot:form.dataset.slot});
    await renderHomepagePicks(target);
    refreshWorkspaceAttention();
    notify('Homepage pick saved.');
  }));
}
function audienceInputs(selected=[]) {
  return `<fieldset class="span"><legend>Audience categories</legend><div class="controls">${meta.categories.filter(c=>c.kind==='audience')
    .map(c=>`<label class="check"><input type="checkbox" name="category" value="${c.id}" ${selected.map(String).includes(String(c.id))?'checked':''}>${esc(c.name)}</label>`).join('')}</div></fieldset>`;
}
function itemFields(item={},existing=false,{openingStock='',personalNote=''}={}) {
  return `${field('sku','SKU',item.sku??'','text',existing?'readonly':'placeholder="Assign automatically if blank"')}
    ${field('name','Product name',item.name,'text','required')}
    <label>Product type<select name="type_id">${options('type',item.type_id,'Select type')}</select></label>
    ${moneyField('price','Sales price',item.price)}${openingStock}
    ${text('description','Description',item.description)}${personalNote}${audienceInputs(item.categories??[])}
    <div class="span">${field('themes','Product themes',item.themes,'text','placeholder="Animal mugs, woodland gifts"')}
    <small>Separate themes with commas. Use the same theme on similar products to compare sales across SKUs.</small></div>`;
}
function normalizeItem(data,form) {
  data.categories=new FormData(form).getAll('category');
  return data;
}
function productPhotoPicker(form) {
  const input=form.elements.files;
  const list=$('[data-photo-queue]',form);
  const queued=new Map();
  function show() {
    list.replaceChildren();
    for (const [key,entry] of queued) {
      const row=document.createElement('li');
      const name=document.createElement('span');
      name.textContent=entry.file.name;
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='button secondary';
      remove.textContent='Remove';
      remove.setAttribute('aria-label','Remove '+entry.file.name);
      remove.addEventListener('click',()=>{queued.delete(key);show();input.focus();});
      row.append(name,remove);
      list.append(row);
    }
  }
  input.addEventListener('change',()=>{
    for (const file of input.files) {
      const key=JSON.stringify([file.name,file.size,file.lastModified,file.type]);
      if (queued.has(key)) continue;
      if (queued.size>=16) {notify('You can add up to 16 photos per save. Save the item to add more later.');break;}
      queued.set(key,{file,upload:null});
    }
    input.value='';
    show();
  });
  return ()=>Promise.all([...queued.values()].map(entry=>{
    entry.upload??=upload(entry.file).catch(error=>{entry.upload=null;throw error;});
    return entry.upload;
  }));
}
function wirePhotoOrder(form) {
  const row=$('[data-photo-order]',form);
  if (!row) return;
  const cards=[...row.children];
  row.addEventListener('change',event=>{
    const control=event.target.closest('select[data-order]');
    if (!control) return;
    const card=control.closest('[data-position]');
    const from=Number(card.dataset.position)-1;
    const to=Number(control.value)-1;
    if (from===to) return;
    const other=cards[to];
    [cards[from],cards[to]]=[other,card];
    other.dataset.position=String(from+1);
    $('select',other).value=String(from+1);
    $('img',other).alt=`Photo ${from+1}`;
    card.dataset.position=String(to+1);
    $('img',card).alt=`Photo ${to+1}`;
    row.append(...cards);
    control.focus();
  });
}
function renderProductEditor(target,item) {
  const initial=item?.batches?.[0];
  const openingStock=item?`
    ${field('initial_quantity','Starting units',initial?.received_quantity??'—','text','disabled')}
    ${moneyField('initial_unit_cost','Initial unit cost',initial?.cost==null?'—':amount(initial.cost),'disabled')}
    <small class="span">Use Stock batches to add or adjust stock.</small>`:`
    ${field('quantity','Starting units','','number','min="1" step="1" required')}
    ${moneyField('unit_cost','Unit cost','','required')}`;
  const personalNote=text('personal_note','Personal note (manager only)',item?.personal_note,'maxlength="4000"');
  target.innerHTML=`<div${item?' class="item-edit-fields"':' class="frame"'}>${item?'':`<div class="actions"><h3>Add item</h3>
    <button type="button" class="button secondary" data-close-inventory>Close</button></div>`}
    <form id="product-form" class="formgrid">
    ${itemFields(item?{...item,price:amount(item.price),categories:list(item.categories)}:{},!!item,{openingStock,personalNote})}
    <label>Listing status<select name="state">${['draft','active','archived'].map(state=>option(state,state,item?.state)).join('')}</select></label>
    ${item?'':`<div data-create-feature hidden><label>Featured position<select name="featured_slot" disabled>
      ${featuredOptions(0)}</select></label><small>Choosing an occupied spot replaces its current product.</small></div>`}
    ${photoField()}<div class="span"><small>Choose photos in one or more selections. You can add more in Edit item after saving.</small>
      <ul class="photo-queue" data-photo-queue aria-live="polite"></ul></div>${item?.photos?.length?`<fieldset class="span"><legend>Current photos</legend><div class="photo-row" data-photo-order>${item.photos.map((photo,index)=>
    `<div data-position="${index+1}">${img(photo.id,'Photo '+(index+1),'issue-img')}<label>Order<select data-order="${esc(photo.id)}">${item.photos.map((_,position)=>option(position+1,position+1,index+1)).join('')}</select></label><label><input name="remove" type="checkbox" value="${esc(photo.id)}">Remove</label></div>`).join('')}</div></fieldset>`:''}
    <div class="span">${button('Save item')}</div></form></div>`;
  const form=$('#product-form',target);
  const feature=$('[data-create-feature]',form);
  if (feature) form.elements.state.addEventListener('change',()=>{
    const active=form.elements.state.value==='active';
    feature.hidden=!active;
    form.elements.featured_slot.disabled=!active;
  });
  const uploadPhotos=productPhotoPicker(form);
  wirePhotoOrder(form);
  formHandler(form,async(data,form)=>{
    normalizeItem(data,form);
    if (data.state==='active' && data.price==='') throw new Error('Enter a selling price before publishing.');
    if (data.state==='active' && item?.state!=='active' && !(Number(data.quantity)>0 || item?.on_hand>0)) {
      throw new Error('Enter a starting quantity before publishing.');
    }
    if (Number(data.quantity)>0 && data.unit_cost==='') throw new Error('Enter the cost per unit.');
    data.existing_sku=item?.sku;
    data.photos=await uploadPhotos();
    data.photo_order=$$('[data-order]',form).map(field=>field.dataset.order);
    data.remove_photos=new FormData(form).getAll('remove');
    const result=await api('/api/staff/product',data);
    notify('Item saved.');
    history.replaceState(null,'','/staff?sku='+encodeURIComponent(result.sku));
    await loadTab('Inventory',result.sku);
  });
}
function featuredOptions(selected,active=true) {
  return option(0,'Not featured',selected)+(active?[1,2,3,4,5].map(slot=>option(slot,`Spot ${slot}`,selected)).join(''):'');
}
const adjustmentReasons={damaged:'Damaged item',missing:'Missing item',miscount:'Stock count correction',other:'Other'};
function stockBatches(item) {
  const batches=item.batches??[];
  const batchLabels=new Map(batches.map((batch,index)=>[batch.id,`Batch ${index+1}`]));
  const byBatch=new Map();
  for (const entry of item.movements??[]) {
    if (!byBatch.has(entry.batch_id)) byBatch.set(entry.batch_id,[]);
    byBatch.get(entry.batch_id).push(entry);
  }
  const batchRows=batches.flatMap((batch,index)=>{
    const movements=byBatch.get(batch.id)??[];
    const labels={receive:index===0?'Initial stock':'Stock received',sale:'Sale',return:'Return to stock',damage:'Damaged item'};
    let onHand=0;
    return movements.map((entry,position)=>{
      onHand+=entry.qty;
      const units=entry.qty<0?`−${Math.abs(entry.qty)}`:`${entry.qty>0?'+':''}${entry.qty}`;
      const description=[labels[entry.kind]??adjustmentReasons[entry.reason]??'Stock adjustment',entry.note].filter(Boolean).join(' · ');
      return [batchLabels.get(batch.id),entry.kind==='receive'?(batch.received_on??'Unknown'):entry.effective_on,
        units,price(batch.cost),description].map(esc).concat(position===movements.length-1?`<strong>${onHand}</strong>`:String(onHand));
    });
  });
  return `<details class="frame" id="stock-batches"><summary>Stock batches ${badge(`${item.on_hand} on hand`)}</summary>
    <p class="small">Each receipt keeps its own date and unit cost. Use an adjustment to correct units in an existing batch.</p>
    ${dataTable(['Batch','Date','Units','Unit cost','Description','Balance'],batchRows,'No stock movements yet.')}
    <details class="frame"><summary>Receive more stock</summary><form id="receive" class="formgrid">
    ${field('quantity','Units','','number','min="1" step="1" required')}${moneyField('unit_cost','Unit cost','','required')}
    ${field('received_on','Date received or made',meta.today,'date','required')}${text('note','Receipt note (optional)','','maxlength="500"')}
    <div class="span">${button('Receive stock')}</div></form></details>
    ${batches.length?`<details class="frame"><summary>Adjust stock</summary><form id="adjust" class="formgrid">
    <label>Batch<select name="batch">${batches.map(batch=>option(batch.id,`${batchLabels.get(batch.id)} · ${batch.received_on??'Unknown date'} · ${batch.on_hand} on hand`)).join('')}</select></label>
    <label>Change<select name="direction"><option value="remove">Remove units</option><option value="add">Add units</option></select></label>
    ${field('quantity','Units','','number','min="1" step="1" required')}
    <label>Reason<select name="reason" required>${option('','Choose a reason')}${Object.entries(adjustmentReasons).map(([key,label])=>option(key,label)).join('')}</select></label>
    ${text('note','Details (required for Other)','','maxlength="500"')}
    <div class="span">${button('Record adjustment')}</div></form></details>`:''}
    </details>`;
}
async function renderStaffProduct(body,sku) {
  const item=await api('/api/staff/product/'+encodeURIComponent(sku));
  const manager=staff.role==='manager';
  const contact=staff.staff_whatsapp?waLink(staff.staff_whatsapp,`Question about ${item.name} (${sku}). ${location.origin}/staff?sku=${encodeURIComponent(sku)}`):'';
  body.innerHTML=`<a class="small" href="/staff?tab=Inventory">← Inventory</a><div class="detail">${gallery(item)}
    <section><h2>${esc(item.name)}</h2><p>${badge(item.sku)} ${badge(`${Math.max(item.available,0)} available`)}</p>
    <p><strong>${esc(price(item.display_price))}</strong>${item.discount?' · Clearance':''}</p>
    ${item.description?`<p>${esc(item.description)}</p>`:''}${contact?`<a target="_blank" rel="noopener" class="button secondary" href="${esc(contact)}">Message inventory manager ↗</a>`:''}
    ${item.available>0?`<div class="frame"><h3>Record a sale</h3><form id="sell" class="formgrid">
    ${field('quantity','Units',1,'number',`min="1" max="${item.available}" required`)}
    ${field('sold_on','Sale date',meta.today,'date','required')}
    ${manager?moneyField('unit_price','Actual price per unit',amount(item.display_price),'required')+customerPicker():`
      ${moneyField('listed_price','Listed price per unit',item.display_price==null?'—':amount(item.display_price),'disabled')}
      <label class="check span"><input type="checkbox" name="price_changed" value="yes">Sale price differed from the listed price</label>
      ${text('note','Sale note for manager',undefined,'maxlength="2000"')}
      <small class="span">If the price changed, include the actual price and why it changed.</small>`}
    <div class="span controls">${button(manager?'Record and approve sale':'Submit for review')}</div></form></div>`:''}
    ${manager?'':`<details class="frame"><summary>Report a damaged item</summary><form id="issue" class="formgrid">${text('note','What happened?')}${photoField(false)}
    <div class="span">${button('Send report')}</div></form></details>`}
    ${manager&&item.state==='active'?`<details class="frame"><summary>${item.discount?'Manage clearance':'Put on clearance'}</summary>
      <form id="clearance" class="formgrid"><p class="span small">Sales price ${esc(price(item.price))}.</p>
      ${moneyField('clearance_price','Clearance price',item.discount?amount(item.sale_price):'','required')}
      <div class="span controls">${button('Save clearance price')}
      ${item.discount?'<button type="submit" class="button secondary" value="end" formnovalidate>End clearance</button>':''}</div></form></details>`:''}
    </section></div>
    ${manager?`<details class="frame"><summary>Edit item</summary><div id="product-editor"></div></details>
      ${item.state==='active'||item.featured_slot?`<details class="frame"><summary>Homepage feature${item.featured_slot?` · Spot ${item.featured_slot}`:''}</summary>
        <form id="feature-product" class="formgrid"><label>Featured position<select name="slot">
        ${featuredOptions(item.featured_slot??0,item.state==='active')}
        </select></label><div>${button('Save featured position')}</div>
        <small class="span">Choosing an occupied spot replaces its current product. Only available items appear on the homepage.
        <a href="${esc(staffLink('Inventory',{view:'homepage'}))}">Manage homepage picks</a></small></form></details>`:''}
      ${stockBatches(item)}
      <div class="frame"><button type="button" class="button danger" data-delete-record>Delete product</button></div>`:''}`;
  wireGallery(item);
  const reload=()=>loadTab('Inventory',item.sku);
  if (manager && $('#sell')) wireCustomerPicker($('#sell'));
  const priceChanged=$('#sell [name="price_changed"]');
  if (priceChanged) priceChanged.addEventListener('change',()=>{
    $('#sell [name="note"]').required=priceChanged.checked;
  });
  if ($('#sell')) formHandler($('#sell'),async data=>{
    if (data.price_changed && !data.note?.trim()) throw new Error('Explain the price adjustment for the manager.');
    await api('/api/staff/sales',{...data,sku:item.sku});
    notify(manager?'Sale approved.':'Sale submitted.');
    if (manager) refreshWorkspaceAttention();
    await reload();
  });
  if ($('#issue')) formHandler($('#issue'),async(data,form)=>{
    await api('/api/staff/issues',{sku:item.sku,note:data.note,photos:await selectedPhotos(form)});
    notify('Damage report sent.'); form.reset();
  });
  if (manager) {
    wireDeleteRecord('/api/staff/product/'+encodeURIComponent(item.sku)+'/delete','product','Inventory');
    renderProductEditor($('#product-editor'),item);
    const featureForm=$('#feature-product');
    if (featureForm) formHandler(featureForm,async data=>{
      await api('/api/staff/product/'+encodeURIComponent(item.sku)+'/featured',data);
      notify('Featured position saved.');
      refreshWorkspaceAttention();
      await reload();
    });
    const refreshStock=async()=>{
      await reload();
      const stock=$('#stock-batches',body);
      if (stock) stock.open=true;
    };
    formHandler($('#receive'),async data=>{
      await api('/api/staff/receipts',{...data,sku:item.sku});
      notify('Stock received.');
      await refreshStock();
    });
    if ($('#adjust')) formHandler($('#adjust'),async data=>{
      await api('/api/staff/adjustments',data);
      notify('Stock adjusted.');
      await refreshStock();
    });
    if ($('#clearance')) formHandler($('#clearance'),async(data,_,submit)=>{
      const remove=submit?.value==='end';
      await api('/api/staff/product/'+encodeURIComponent(item.sku)+'/clearance',{...data,remove});
      notify(remove?'Clearance ended.':'Clearance price saved.');
      await reload();
    });
  }
}
function table(headers,rows) {
  return dataTable(headers,rows.map(row=>row.map(esc)));
}
function dataTable(headers,rows,message='No records for this report.') {
  return rows.length?`<div class="tablewrap"><table><thead><tr>${headers.map(title=>`<th scope="col">${esc(title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(message);
}
function wireDeleteRecord(path,kind,returnTo) {
  const trigger=$('[data-delete-record]');
  trigger.addEventListener('click',async()=>{
    trigger.disabled=true;
    try {
      const record=await api(path);
      const product=kind==='product';
      const labels={orders:'Orders',sales:'Sales and sale notes',returns:'Returns and refunds',moves:'Stock movements',
        batches:'Stock batches',issues:'Damage reports',files:'Photo files',imports:'CSV import records'};
      const dialog=document.createElement('dialog');
      dialog.className='delete-dialog';
      dialog.setAttribute('aria-labelledby','delete-title');
      dialog.innerHTML=`<h2 id="delete-title">Permanently delete ${kind}?</h2>
        <p><strong>${esc(record.name)}</strong> ${esc(product?`· ${record.id}`:[record.phone,record.email].filter(Boolean).join(' · '))}</p>
        ${record.photos.length?`<div class="photo-row">${record.photos.map((id,index)=>img(id,`${record.name}, photo ${index+1}`,'issue-img')).join('')}</div>`:''}
        <p>${product?'This removes the product and its history from inventory and reports. Other products on shared orders remain.':'This removes the customer, their orders, sales and refunds. Stock is recalculated and reports are updated.'}</p>
        <dl>${Object.entries(record.counts).filter(([,count])=>count>0).map(([key,count])=>`<div><dt>${esc(labels[key])}</dt><dd>${count}</dd></div>`).join('')}</dl>
        <div class="controls" data-delete-first><button type="button" class="button secondary" autofocus data-delete-cancel>Cancel</button>
        <button type="button" class="button danger" data-delete-continue>Yes, continue</button></div>
        <form data-delete-final hidden>${field('confirmation','Type DELETE to confirm','','text','required autocomplete="off"')}
        <div class="controls"><button type="button" class="button secondary" data-delete-cancel>Cancel</button>
        <button type="submit" class="button danger" disabled>Delete permanently</button></div></form>
        <p data-delete-error role="alert"></p>`;
      const form=$('[data-delete-final]',dialog);
      const input=$('input',form);
      const submit=$('button[type=submit]',form);
      const error=$('[data-delete-error]',dialog);
      let deleting=false;
      $$('[data-delete-cancel]',dialog).forEach(button=>button.addEventListener('click',()=>dialog.close()));
      dialog.addEventListener('cancel',event=>{if (deleting) event.preventDefault();});
      dialog.addEventListener('close',()=>{dialog.remove();trigger.focus();},{once:true});
      $('[data-delete-continue]',dialog).addEventListener('click',()=>{
        $('[data-delete-first]',dialog).hidden=true;
        form.hidden=false;
        input.focus();
      });
      input.addEventListener('input',()=>{submit.disabled=input.value!=='DELETE';});
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if (input.value!=='DELETE'||deleting) return;
        deleting=true;
        submit.disabled=true;
        input.disabled=true;
        const cancel=$('[data-delete-cancel]',form);
        cancel.disabled=true;
        try {
          const result=await api(path,{confirmation:input.value,snapshot:record.snapshot});
          dialog.close();
          history.replaceState(null,'',staffLink(returnTo));
          await loadTab(returnTo);
          refreshWorkspaceAttention();
          notify(result.cleanupPending?'Product deleted. Photo file cleanup will retry on the next product deletion.':`${record.name} deleted.`);
        } catch (failure) {
          error.textContent=failure.message;
          deleting=false;
          input.disabled=false;
          cancel.disabled=false;
          submit.disabled=failure.status===409;
        }
      });
      document.body.append(dialog);
      dialog.showModal();
    } catch (error) { notify(error.message); }
    finally { trigger.disabled=false; }
  });
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
        ${field('sold_on','Sale date',sale.sold_on,'date','required')}${moneyField('unit_price','Actual price per unit',amount(sale.unit_price))}
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
      notify('Sale updated.'); refreshWorkspaceAttention(); await renderSales(body,view);
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
    ${moneyField('refund','Total refund','','placeholder="Defaults to original unit price"')}
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
    <div class="customer-picker-search"><label>Find a customer<input type="search" data-search placeholder="Name, phone, or email" autocomplete="off"></label>
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
        <h4>Purchase history</h4><div data-orders></div></section>
        <div class="frame"><button type="button" class="button danger" data-delete-record>Delete customer</button></div>`;
    wireDeleteRecord('/api/staff/customers/'+encodeURIComponent(customer.id)+'/delete','customer','Customers');
    return displayOrders($('[data-orders]',body),customer.id);
  }
  body.innerHTML=workspaceHeading('Customers')+`
    <form class="filter-grid customer-search" id="customer-search">${field('q','Search by name, phone, or email','','search','placeholder="Search customers"')}
      <div class="form-action">${button('Search','secondary')}</div></form>
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
function renderIssueCards(target,issues,refresh) {
  target.innerHTML=`<section class="frame report-results"><h2>Damage log</h2>
    ${issues.length?issues.map(issue=>`<details class="report-row damage-row">
    <summary><span class="report-row-title">${esc(issue.name)}</span>
    <span class="report-row-key">${badge(issue.resolved_at?'Resolved':'Open',!issue.resolved_at)}</span></summary>
    <div class="damage-detail"><p class="small">${staffAnchor('/staff?sku='+encodeURIComponent(issue.sku),issue.sku)} · Reported ${esc(issue.created_at.slice(0,10))}</p>
    <p>${esc(issue.note)}</p><div class="photo-row">${list(issue.photos).map(photo=>
      `<a href="/api/photo/${esc(photo)}" target="_blank" rel="noopener">${img(photo,'Damage report photo','issue-img')}</a>`).join('')}</div>
    ${issue.resolved_at?`<p><strong>Resolution</strong> ${esc(issue.resolution)}</p>`:`<form data-resolve="${esc(issue.id)}" class="formgrid">${text('note','Manager resolution')}
    <div class="span">${button('Resolve report')}</div></form>`}</div></details>`).join(''):empty('No damage reports match these filters.')}</section>`;
  $$('[data-resolve]',target).forEach(form=>formHandler(form,async data=>{
    await api(`/api/staff/issues/${form.dataset.resolve}/resolve`,data);notify('Report resolved.');await refresh();
  }));
}
function renderCategories(body) {
  const kinds=['audience','type'];
  body.innerHTML=kinds.map(kind=>`<div class="frame"><h3>${kind==='audience'?'Audience categories':'Product subcategories'}</h3>
   ${[{id:'',name:''},...meta.categories.filter(row=>row.kind===kind)].map(row=>`
    <form class="formgrid" data-cat="${kind}" data-id="${row.id}">
      ${field('name',row.id?'Category name':'New category',row.name,'text','required')}
      <div class="form-action">${button(row.id?'Save name':'Add category','secondary')}</div></form>`).join('')}</div>`).join('');
  $$('[data-cat]',body).forEach(form=>formHandler(form,async data=>{
    await api('/api/staff/categories',{...data,kind:form.dataset.cat,id:form.dataset.id});await updateMeta();notify('Category saved.');renderCategories(body);
  }));
}
async function renderTeam(body) {
  const people=await api('/api/staff/team');
  body.innerHTML=workspaceHeading('Team')+`<div class="frame">
    <h3>Preview the workspace</h3>
    <p class="small" id="workspace-view-help">Open the staff view using your admin sign-in.</p>
    <div class="controls workspace-view-controls">
      <label>View as<select id="workspace-view" aria-describedby="workspace-view-help">
        <option value="admin">Admin</option><option value="staff">Staff</option>
      </select></label>
      <button type="button" class="button secondary" id="open-workspace-view" disabled>Switch view</button>
    </div>
  </div><div class="frame"><h3>Invite an employee</h3><form class="formgrid" id="invite">
    ${field('email','Email address','','email','required')}<div class="form-action">${button('Send invitation')}</div></form>
    ${people.map(person=>`<div class="actions frame"><div>${esc(person.email)} <span class="small">${esc(person.role)} · ${person.active?'Access enabled':'Access revoked'}</span></div>
    ${person.role==='employee'?`<div class="controls"><button class="button secondary" data-invite="${esc(person.email)}">${person.active?'Resend invite':'Restore and invite'}</button>
    ${person.active?`<button class="button danger" data-revoke="${esc(person.email)}">Revoke access</button>`:''}</div>`:''}</div>`).join('')}</div>`;
  const view=$('#workspace-view',body);
  const applyView=$('#open-workspace-view',body);
  view.addEventListener('change',()=>{ applyView.disabled=view.value!=='staff'; });
  applyView.addEventListener('click',()=>switchWorkspaceView(view.value));
  async function change(email,disable=false) {
    try { await api('/api/staff/team',{email,disable});notify(disable?'Access revoked.':'Invitation sent.'); }
    catch(error){notify(error.message);}
    await renderTeam(body);
  }
  formHandler($('#invite'),data=>change(data.email));
  $$('[data-invite]',body).forEach(el=>el.addEventListener('click',()=>change(el.dataset.invite)));
  $$('[data-revoke]',body).forEach(el=>el.addEventListener('click',()=>change(el.dataset.revoke,true)));
}
function importMissing(item) {
  return [!item.name?'product name':'',!(Number(item.quantity)>0)?'starting quantity':'',
    item.unit_cost==null||item.unit_cost===''?'unit cost':'',item.price==null||item.price===''?'selling price':''].filter(Boolean);
}
async function renderImport(body) {
  body.innerHTML=`<div class="frame"><div class="actions"><h3>Upload a product batch</h3><div class="controls">
    <a class="button secondary" href="/luxor-import-template.csv" download>Download CSV template</a>
    <a class="button secondary" href="${esc(staffLink('Inventory'))}">Close upload</a></div></div>
    <form class="formgrid" id="upload-csv">
      <label>CSV file<input type="file" name="csv" accept=".csv,text/csv" required></label>${photoField()}<div class="span">${button('Preview rows')}</div>
    </form><div id="upload-preview" aria-live="polite"></div></div>
    <h3>Drafts awaiting approval</h3><p class="small">Open a draft to finish its stock and pricing details.</p><div id="drafts"></div>`;
  formHandler($('#upload-csv'),async (_,form)=>{
    const csv=form.elements.csv.files[0];
    const files=[...form.elements.files.files];
    const rows=draftRows(parseCSV(await csv.text()),files,meta.categories);
    const preview=$('#upload-preview');
    preview.innerHTML=table(['Row','SKU','Product','Photos','Review'],rows.map(row=>{
      const missing=importMissing(row.payload);
      const status=row.errors.join(' · ')||(missing.length?'Needs '+missing.join(', '):'Ready to add');
      return [row.number,row.payload.sku||'New SKU',row.payload.name,row.files.map(file=>file.name).join(', '),status];
    }));
    const valid=rows.filter(row=>!row.errors.length);
    const ready=valid.filter(row=>!importMissing(row.payload).length);
    if (!valid.length) {
      preview.insertAdjacentHTML('beforeend','<p class="alert">Fix the issues above, then preview the CSV again.</p>');
      return;
    }
    preview.insertAdjacentHTML('beforeend',`<div class="controls">
      ${ready.length?`<button type="button" class="button" id="publish-import">Add and publish ${ready.length} complete ${ready.length===1?'item':'items'}</button>`:''}
      <button type="button" class="button ${ready.length?'secondary':''}" id="stage">Save ${valid.length} valid rows as drafts</button></div>
      ${ready.length<valid.length?'<p class="small">Save incomplete rows as drafts to enter the missing details on this page.</p>':''}
      <div data-import-result aria-live="polite"></div>`);
    const save=$('#stage',preview);
    const publish=$('#publish-import',preview);
    const feedback=$('[data-import-result]',preview);
    const uploadsByRow=new Map();
    async function stageRow(row) {
      const key=await rowKey(row.payload,row.files);
      if (!uploadsByRow.has(row)) uploadsByRow.set(row,new Map());
      const uploaded=uploadsByRow.get(row);
      const photos=await Promise.all(row.files.map(file=>{
        if (!uploaded.has(file)) uploaded.set(file,upload(file).catch(error=>{uploaded.delete(file);throw error;}));
        return uploaded.get(file);
      }));
      return api('/api/staff/imports',{key,payload:{...row.payload,photos}});
    }
    async function run(batch,publishNow) {
      if (publishNow&&!confirm(`Add stock and publish up to ${batch.length} new items?`)) return;
      save.disabled=true;
      if (publish) publish.disabled=true;
      let added=0;
      let saved=0;
      let skipped=0;
      const issues=[];
      try {
        for (const row of batch) {
          feedback.textContent=`Processing row ${row.number}…`;
          try {
            const draft=await stageRow(row);
            if (draft.approved_at) { skipped++; continue; }
            if (!publishNow||draft.existing_sku) { saved++; continue; }
            const result=await api(`/api/staff/imports/${draft.id}/approve`,{action:'create',publish:true});
            if (result.alreadyApplied) skipped++;
            else added++;
          } catch (error) { issues.push(`Row ${row.number}: ${error.message}`); }
        }
        await showDrafts();
      } catch (error) { issues.push(error.message); }
      finally {
        save.disabled=false;
        if (publish) publish.disabled=false;
      }
      const result=[added&&`${added} added and published`,saved&&`${saved} saved for draft review`,
        skipped&&`${skipped} already imported`].filter(Boolean).join(' · ');
      feedback.innerHTML=`${result?`<p>${esc(result)}.</p>`:''}
        ${added?`<a href="${esc(staffLink('Inventory'))}">View inventory</a>`:''}
        ${issues.length?`<ul class="alert">${issues.map(message=>`<li>${esc(message)}</li>`).join('')}</ul>`:''}`;
    }
    save.addEventListener('click',()=>run(valid,false));
    publish?.addEventListener('click',()=>run(ready,true));
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
    const missing=importMissing(item);
    return `<details class="frame"><summary>${esc(item.name||'Unnamed item')} · ${esc(item.sku||'Assign SKU')}
       ${exists?badge('Existing SKU',true):missing.length?badge('Needs details',true):badge('Ready to add')}</summary>
       ${!exists&&missing.length?`<p class="small">Still needed to publish: ${esc(missing.join(', '))}.</p>`:''}
       <div class="photo-row">${(item.photos||[]).map(photo=>img(photo,'Draft photo','issue-img')).join('')}</div>
       <form class="formgrid" data-draft="${row.id}">${itemFields(item,!!item.sku)}
       ${field('quantity','Starting quantity',item.quantity,'number','min="0"')}
       ${moneyField('unit_cost','Unit cost',item.unit_cost)}
       ${field('received_on','Date received',item.received_on,'date')}
       <label>Action<select name="action">${exists?'<option value="">Choose an action</option><option value="update">Update listing details</option>':'<option value="create">Create item</option>'}</select></label>
       <label class="check"><input type="checkbox" name="publish" ${exists?'':'checked'}>Publish listing</label><div class="span">${button(exists?'Apply update':'Add to inventory')}</div>
       </form></details>`;
  };
  const ready=drafts.filter(row=>!row.existing_sku&&!importMissing(row.payload).length);
  target.innerHTML=drafts.length?(ready.length?`<div class="controls"><button class="button secondary" id="approve-batch">Add and publish ${ready.length} complete ${ready.length===1?'draft':'drafts'}</button></div>`:'')+
    drafts.map(draftForm).join(''):empty('No imported drafts awaiting approval.');
  $$('[data-draft]',target).forEach(form=>formHandler(form,async data=>{
    normalizeItem(data,form);
    const source=drafts.find(row=>row.id===form.dataset.draft);
    if (source.payload.themes==null && !data.themes.trim()) delete data.themes;
    data.publish=!!data.publish;
    assertChoice(data.action);
    const missing=importMissing(data);
    if (!source.existing_sku && data.publish && missing.length) throw new Error('Enter '+missing.join(', ')+' before publishing.');
    await api(`/api/staff/imports/${form.dataset.draft}/approve`,data);
    notify('Inventory updated.');await showDrafts();
  }));
  $('#approve-batch',target)?.addEventListener('click',async event=>{
    const button=event.currentTarget;
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
          ${attentionLink('Damage reports','Open reports from staff',attention.issues,staffLink('Reports',{view:'damage'}))}
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
const reportViews=[['sales','Sales & profit'],['themes','Product themes'],['closeout','Stock closeout'],
  ['storefront','Storefront activity'],['damage','Damage reports']];

function reportMetrics(metrics) {
  return `<div class="dashboard-metrics report-metrics">${metrics.map(([label,value,caption])=>
    `<div class="dashboard-metric"><span class="dashboard-metric-label">${esc(label)}</span>
      <strong>${esc(value)}</strong>${caption?`<small>${esc(caption)}</small>`:''}</div>`).join('')}</div>`;
}
function reportTable(headers,rows,keyColumn=1,itemLink=null) {
  const cards=rows.map((row,index)=>`<details class="report-row"><summary>
    <span class="report-row-title">${esc(row[0])}</span>
    <span class="report-row-key"><small>${esc(headers[keyColumn])}</small>${esc(row[keyColumn])}</span>
    </summary><dl>${headers.map((header,i)=>i===0||i===keyColumn?'':`<div><dt>${esc(header)}</dt><dd>${esc(row[i])}</dd></div>`).join('')}
    ${itemLink?`<div><dt>Item</dt><dd>${staffAnchor(itemLink(index),'View item')}</dd></div>`:''}</dl></details>`);
  const desktop=itemLink?dataTable(headers,rows.map((row,index)=>[staffAnchor(itemLink(index),row[0]),...row.slice(1).map(esc)])):table(headers,rows);
  return rows.length?`<div class="report-desktop">${desktop}</div><div class="report-mobile">${cards.join('')}</div>`:
    empty('No records match these filters.');
}
function reportPanel(title,contents) {
  return `<section class="frame report-results"><h2>${esc(title)}</h2>${contents}</section>`;
}
function drawReport(view,data,sort) {
  const compareOk=data.coverage && data.prior.start>=data.coverage;
  const delta=(value,prior)=>compareOk?`${value>prior?'+':''}${value-prior}`:'—';
  const byName=item=>`${item.name} · ${item.sku}`;
  const total=(rows,key)=>rows.reduce((sum,row)=>sum+(row[key]??0),0);
  if (view==='sales') {
    const {sales,previous}=data;
    return {
      metrics:[['Gross sales',price(sales.revenue),'Before refunds'],
        ['Net sales',price(netSales(sales)),'Gross sales less refunds'],
        ['Refunds',price(sales.refund),`${sales.returned} units returned`],
        ['Gross profit',price(sales.profit),sales.unknown?`${sales.unknown} entries with missing cost`:'Net sales less cost of goods sold']],
      results: (sales.units || sales.returned || (compareOk && (previous.units || previous.returned)))?reportPanel('Sales results',
        `<p class="small">${esc(data.span.start)} to ${esc(data.span.end)} · Comparison ${esc(data.prior.start)} to ${esc(data.prior.end)}</p>
        ${!data.coverage||data.span.start<data.coverage?'<p class="small">Historical coverage is incomplete for the selected period.</p>':''}
        ${reportTable(['Measure','Selected period','Comparison period'],[
          ['Gross sales',price(sales.revenue),compareOk?price(previous.revenue):'—'],
          ['Net sales',price(netSales(sales)),compareOk?price(netSales(previous)):'—'],
          ['Refunds',price(sales.refund),compareOk?price(previous.refund):'—'],
          ['Gross profit',price(sales.profit),compareOk?price(previous.profit):'—'],
          ['Units sold',sales.units,compareOk?previous.units:'—'],
          ['Units returned',sales.returned,compareOk?previous.returned:'—']])}`):''
    };
  }
  if (view==='themes') return {
    metrics:[['Top theme',data.themeTrends.find(row=>row.units>0)?.name??'—'],
      ['Units sold',data.sales.units],['Themes with sales',data.themeTrends.filter(row=>row.units>0).length]],
    results:(data.themeTrends.length?reportPanel('Sales by theme','<p class="small">Sold-out products count toward their themes. An item can count toward more than one theme.</p>'+
      reportTable(['Theme','Units sold','Distinct SKUs sold','Prior units','Change'],data.themeTrends.map(row=>[
        row.name,row.units,row.sku_count,compareOk?row.previous:'—',delta(row.units,row.previous)
      ]))):'')+(data.trends.length?reportPanel('Trending SKUs',reportTable(['Product','Units sold','Prior units','Change'],data.trends.map(row=>[
        byName(row),row.units,compareOk?row.previous:'—',delta(row.units,row.previous)]))):'')
  };
  if (view==='closeout') return {
    metrics:[['Matching SKUs',data.closeout.length],['Units received',total(data.closeout,'received')],['Closing units',total(data.closeout,'closing')]],
    results:data.closeout.length?reportPanel('Stock movement by SKU',reportTable(['Product','Opening','Received','Sold','Restocked','Adjusted','Closing'],
      data.closeout.map(row=>[byName(row),row.opening,row.received,row.sold,row.restocked,row.adjusted,row.closing]),6)):''
  };
  const least=sort==='least';
  const listings=[...data.interest].sort((a,b)=>(least?a.views-b.views:b.views-a.views) || a.name.localeCompare(b.name));
  return {
    metrics:[['Product views',total(listings,'views')],['WhatsApp clicks',total(listings,'clicks')],['Active listings',listings.length]],
    results:listings.length?reportPanel(least?'Least-viewed active listings':'Most-viewed active listings',
      reportTable(['Product','Published','Views','Units sold','WhatsApp clicks'],
        listings.map(row=>[byName(row),row.published_at?.slice(0,10)||'—',row.views,row.units_sold??0,row.clicks]),2)):''
  };
}
async function renderDashboard(body,params) {
  const requested=params.get('view') || ({'#theme-trends':'themes','#stock-closeout':'closeout'})[location.hash];
  const view=reportViews.some(([key])=>key===requested)?requested:'sales';
  const title=reportViews.find(([key])=>key===view)[1];
  const days=overviewDays(params.get('days'));
  const compare=view==='sales'||view==='themes';
  const dated=view!=='damage';
  body.innerHTML=workspaceHeading('Reports')+
    subnav('Reports',reportViews,view,params.has('days')?{days}:{})+
    `<h2>${esc(title)}</h2><div id="report-metrics" aria-live="polite"></div>
    <div class="frame report-filters" hidden><form id="daterange" class="filter-grid">
    ${dated?`<label>Period<select name="preset">
      ${[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['3m','Last three calendar months'],['month','This month'],['custom','Custom dates']].map(([key,label])=>option(key,label,days)).join('')}
    </select></label>
    ${field('start','From',addDays(meta.today,1-days),'date','required')}${field('end','Through',meta.today,'date','required')}`:''}
    <label>Product type<select name="type">${options('type',null,'All product types')}</select></label>
    ${compare?`<label>Compare with<select name="compare"><option value="previous">Previous equivalent period</option><option value="year">Same period last year</option></select></label>`:''}
    ${view==='closeout'?field('sku','SKU','','text','placeholder="All SKUs"'):''}
    ${view==='damage'?`<label>Status<select name="status"><option value="">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option></select></label>`:''}
    ${view==='storefront'?'<label>Sort by<select name="sort"><option value="most">Most viewed</option><option value="least">Least viewed</option></select></label>':''}
    <div class="form-action">${button('Apply filters')}</div></form></div><div id="report" aria-live="polite"></div>`;
  const form=$('#daterange',body);
  const metrics=$('#report-metrics',body);
  const target=$('#report',body);
  const filterPanel=form.closest('.report-filters');
  let version=0;
  async function refresh() {
    const request=++version;
    target.innerHTML=empty('Loading report…');
    metrics.innerHTML='';
    try {
      const query=new URLSearchParams(format(form));
      if (view==='damage') {
        query.set('report','1');
        if (form.dataset.page) query.set('page',form.dataset.page);
      }
      const data=await api((view==='damage'?'/api/staff/issues?':'/api/staff/dashboard?')+query);
      if (request!==version) return;
      if (view==='damage') {
        metrics.innerHTML=reportMetrics([['Matching reports',data.counts.total],['Open',data.counts.open],['Resolved',data.counts.resolved]]);
        const hasData=data.counts.total>0;
        if (data.items.length) {
          renderIssueCards(target,data.items,refresh);
        } else {
          target.innerHTML=filterPanel.hidden&&!hasData?'':'<p class="small">No damage reports match these filters.</p>';
        }
        paginate(target,data,next=>{
          form.dataset.page=String(next);
          return refresh();
        });
        filterPanel.hidden=filterPanel.hidden&&!hasData;
      } else {
        const report=drawReport(view,data,query.get('sort'));
        const hasHistory=(view==='sales'||view==='themes') ? data.hasSales : view==='closeout' && data.hasStockHistory;
        filterPanel.hidden=view!=='storefront' && filterPanel.hidden && !report.results && !hasHistory;
        metrics.innerHTML=reportMetrics(report.metrics);
        target.innerHTML=report.results || (filterPanel.hidden?'':'<p class="small">No records match these filters.</p>');
      }
    } catch(error) { if (request===version) target.innerHTML=empty(error.message); }
  }
  formHandler(form,async values=>{
    if (values.sku?.trim() && !/^[A-Z0-9][A-Z0-9_-]{0,39}$/i.test(values.sku.trim())) throw new Error('Enter a valid SKU.');
    delete form.dataset.page;
    await refresh();
  });
  if (dated) {
    form.elements.preset.addEventListener('change',()=>{
      const preset=form.elements.preset.value;
      if (preset==='custom') return;
      form.elements.start.value=preset==='3m'?monthsBack(meta.today,2):preset==='month'?meta.today.slice(0,7)+'-01':addDays(meta.today,1-Number(preset));
      form.elements.end.value=meta.today;
    });
    for(const name of ['start','end']) form.elements[name].addEventListener('change',()=>{form.elements.preset.value='custom';});
  }
  await refresh();
}
async function boot() {
  try {
    await updateMeta();
    if (location.pathname==='/staff') return await openStaff();
    const item=location.pathname.match(/^\/products\/([^/]+)$/);
    if(item) return await renderPublicProduct(decodeURIComponent(item[1]));
    return await renderShop();
  } catch(error) {
    main.innerHTML=`<div class="shell section"><h2>${error.status===404?'Item unavailable':'Luxor Moolah'}</h2>
    ${empty(error.message)}<a class="button secondary" href="/">Back to the shop</a></div>`;
  }
}
window.addEventListener('popstate',()=>boot());
window.addEventListener('pageshow',event=>{
  if (event.persisted && staffPreview!==wantsStaffPreview()) location.reload();
});
boot();
