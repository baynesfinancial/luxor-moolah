export const headers = ['sku','name','description','categories','subcategory','quantity','unit_cost','price','sale_price','received_on','image_files','themes'];

export function parseCSV(content) {
  const source=content.replace(/^\uFEFF/,'');
  const rows=[];
  let row=[];
  let field='';
  let quoted=false;
  let closedQuote=false;
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(quoted){
      if(char!=='"') field+=char;
      else if(source[index+1]==='"'){field+='"';index++;}
      else{quoted=false;closedQuote=true;}
      continue;
    }
    if(char===','||char==='\n'||char==='\r'){
      row.push(field);field='';closedQuote=false;
      if(char!==','){
        rows.push(row);row=[];
        if(char==='\r'&&source[index+1]==='\n')index++;
      }
    }else if(char==='"'&&!field&&!closedQuote){quoted=true;}
    else{
      if(closedQuote||char==='"')throw new Error('Unexpected characters after a quoted CSV field.');
      field+=char;
    }
  }
  if(quoted)throw new Error('The CSV contains an unclosed quote.');
  if(row.length||field||closedQuote)rows.push([...row,field]);
  return rows;
}
const split = value => String(value).split('|').map(value=>value.trim()).filter(Boolean);
export function draftRows(table,files,categories){
  const heading=table[0]?.map(name=>name.trim().toLowerCase())??[];
  if(!heading.includes('name'))throw new Error('Include a name column and use the downloadable CSV template.');
  if(heading.length!==new Set(heading).size)throw new Error('The CSV contains duplicate headers.');
  const rows=[];
  const bySku=new Map();
  for(const [index,row] of table.slice(1).entries()){
    if(!row.some(value=>value.trim()))continue;
    const fields=Object.fromEntries(headers.map(name=>[name,row[heading.indexOf(name)]?.trim()??'']));
    if (!heading.includes('themes')) delete fields.themes;
    const errors=[];
    if(row.length!==heading.length)errors.push('Field count does not match the CSV header');
    const sku=fields.sku.toUpperCase();
    if(sku&&!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(sku))errors.push('Invalid SKU');
    if(sku&&bySku.has(sku)){
      errors.push('Duplicate SKU in this CSV');
      bySku.get(sku).errors.push('Duplicate SKU in this CSV');
    }
    const audience=split(fields.categories).map(name=>{
      const match=categories.find(c=>c.kind==='audience'&&c.name.toLowerCase()===name.toLowerCase());
      if(!match)errors.push('Unknown audience '+name);
      return match?.id;
    }).filter(Boolean);
    const type=categories.find(c=>c.kind==='type'&&c.name.toLowerCase()===fields.subcategory.toLowerCase());
    if(fields.subcategory&&!type)errors.push('Unknown product type '+fields.subcategory);
    const fileList=split(fields.image_files).map(name=>{
      const matches=files.filter(file=>file.name===name);
      if(matches.length!==1)errors.push((matches.length?'Ambiguous photo ':'Missing photo ')+name);
      return matches[0];
    }).filter(Boolean);
    if(new Set(fileList).size!==fileList.length)errors.push('Photo filename is listed more than once');
    if(fileList.length>16)errors.push('More than 16 photos');
    if(fields.quantity&&(!/^\d+$/.test(fields.quantity)||Number(fields.quantity)>1_000_000))errors.push('Invalid quantity');
    for(const amount of ['price','unit_cost','sale_price']){
      if(fields[amount]&&!/^\d{1,10}(\.\d{1,2})?$/.test(fields[amount]))errors.push('Invalid '+amount.replaceAll('_',' '));
    }
    if(fields.sale_price&&(!fields.price||Number(fields.sale_price)>Number(fields.price)))errors.push('Sale price needs a regular price and cannot exceed it');
    if(fields.received_on&&(!/^\d{4}-\d{2}-\d{2}$/.test(fields.received_on)||!Number.isFinite(Date.parse(fields.received_on))||
      new Date(fields.received_on).toISOString().slice(0,10)!==fields.received_on))errors.push('Invalid received date');
    const entry={number:index+2,errors,files:fileList,payload:{...fields,sku,categories:audience,type_id:type?.id??null}};
    rows.push(entry);
    if(sku&&!bySku.has(sku))bySku.set(sku,entry);
  }
  return rows;
}
const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function rowKey(payload,files){
  const photos=await Promise.all(files.map(async file=>hex(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))));
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([payload,photos]))));
}
