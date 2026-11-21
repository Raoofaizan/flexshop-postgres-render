
'use strict';

const COLLECTIONS=[
 'customers','invoices','inventory','jobs',
 'expenses','staff','payments','staffLedger','inventoryUses'
];

let DB=Object.fromEntries(COLLECTIONS.map(key=>[key,[]]));

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;',
 '<':'&lt;',
 '>':'&gt;',
 '"':'&quot;',
 "'":'&#39;'
}[ch]));

async function api(path,{method='GET',body}={}){
 const options={
  method,
  credentials:'same-origin',
  headers:{'X-Requested-With':'XMLHttpRequest'}
 };

 if(body!==undefined){
  options.headers['Content-Type']='application/json';
  options.body=JSON.stringify(body);
 }

 const response=await fetch('/api'+path,options);

 if(response.status===401){
  location.replace('/login.html');
  throw new Error('Session expired. Please log in again.');
 }

 let data={};
 try{data=await response.json();}catch{}

 if(!response.ok){
  throw new Error(data.error||'Server error '+response.status);
 }

 return data;
}

async function refresh(){
 DB=await api('/bootstrap');
 renderMain();
}

async function apply(path,method,body){
 try{
  const result=await api(path,{method,body});
  await refresh();
  return result;
 }catch(error){
  alert(error.message);
  return null;
 }
}

function confirmDelete(message){
 return confirm(message);
}

async function startup(){
 try{
  const me=await api('/auth/me');
  const details=document.getElementById('adminEmail');

  if(details)details.textContent=me.email;

  document.getElementById('signOut').addEventListener('click',async()=>{
   try{await api('/auth/logout',{method:'POST'});}catch{}
   location.replace('/login.html');
  });

  DB=await api('/bootstrap');
  renderNav();
  renderMain();

 }catch(error){
  document.getElementById('app').textContent=
   'Cannot load Rohi Printers Manager: '+error.message;
 }
}

function money(n){
 return '₨'+(Number(n)||0).toLocaleString(undefined,{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });
}

function today(){
 const d=new Date();
 return [
  d.getFullYear(),
  String(d.getMonth()+1).padStart(2,'0'),
  String(d.getDate()).padStart(2,'0')
 ].join('-');
}

document.getElementById('dateNow').textContent=
 new Date().toDateString();

// ---------- NAVIGATION ----------

const TABS=[
 ['dashboard','📊 Dashboard'],
 ['invoices','🧾 Invoicing'],
 ['customers','👥 Customers'],
 ['inventory','📦 Inventory'],
 ['uses','🧰 Daily Uses'],
 ['jobs','🏷️ Job Orders'],
 ['expenses','💰 Expenses & Staff'],
 ['reports','📈 Reports'],
 ['settings','⚙️ Settings']
];

let active='dashboard';

function renderNav(){
 const nav=document.getElementById('tabs');

 nav.innerHTML=TABS.map(([id,label])=>
  `<button data-t="${id}" class="${active===id?'active':''}">${label}</button>`
 ).join('');

 nav.querySelectorAll('button').forEach(b=>{
  b.onclick=()=>{
   active=b.dataset.t;
   renderNav();
   renderMain();
  };
 });
}

function renderMain(){
 const m=document.getElementById('app');

 try{
  if(active==='dashboard')m.innerHTML=viewDashboard();
  if(active==='invoices')m.innerHTML=viewInvoices();
  if(active==='customers')m.innerHTML=viewCustomers();
  if(active==='inventory')m.innerHTML=viewInventory();
  if(active==='uses')m.innerHTML=viewUses();
  if(active==='jobs')m.innerHTML=viewJobs();
  if(active==='expenses')m.innerHTML=viewExpenses();
  if(active==='reports')m.innerHTML=viewReports();
  if(active==='settings')m.innerHTML=viewSettings();

  wireEvents();

 }catch(err){
  m.innerHTML=`
   <div class="card">
    <h2>Unable to display this tab</h2>
    <p class="muted">${esc(err.message||err)}</p>
    <button class="btn" id="reloadApp">Refresh</button>
   </div>`;

  const r=document.getElementById('reloadApp');
  if(r)r.onclick=()=>location.reload();
 }
}

function custName(id){
 const c=DB.customers.find(c=>c.id===id);
 return c?c.name:'-';
}

function invoiceDue(inv){
 return Math.max(
  0,
  Number(inv.balance??(inv.total-inv.paidAmt))||0
 );
}

function paidOnInvoice(inv){
 return Number(inv.paidTotal??inv.paidAmt)||0;
}

function invoiceStatus(inv){
 return invoiceDue(inv)<=0.005?'Paid':'Due';
}

function filterTableRows(tableId,needle,countId){
 const table=document.getElementById(tableId);
 if(!table)return;

 const value=String(needle||'').trim().toLowerCase();
 let visible=0;

 table.querySelectorAll('tbody tr[data-search]').forEach(row=>{
  const show=!value||
   (row.dataset.search||'').toLowerCase().includes(value);

  row.style.display=show?'':'none';
  if(show)visible++;
 });

 const count=document.getElementById(countId);

 if(count){
  count.textContent=visible+' matching records';
 }
}

let customerSearch='';
let invoiceSearch='';
let usesDate=today();

function customerBalance(custId){
 if(!custId)return 0;

 const inv=DB.invoices.filter(i=>i.customerId===custId);
 const billed=inv.reduce((s,i)=>s+Number(i.total),0);
 const paidAtBilling=inv.reduce((s,i)=>s+Number(i.paidAmt),0);

 const ledgerPaid=DB.payments
  .filter(p=>p.customerId===custId)
  .reduce((s,p)=>s+Number(p.amount),0);

 return billed-paidAtBilling-ledgerPaid;
}

function previousBalanceForInvoice(inv){
 if(!inv?.customerId)return 0;

 const sorted=DB.invoices
  .filter(i=>i.customerId===inv.customerId)
  .sort((a,b)=>
   String(a.date).localeCompare(String(b.date))||
   String(a.createdAt||'').localeCompare(String(b.createdAt||''))||
   String(a.id).localeCompare(String(b.id))
  );

 const index=sorted.findIndex(i=>i.id===inv.id);

 return index<0?0:
  sorted.slice(0,index).reduce(
   (sum,i)=>sum+invoiceDue(i),0
  );
}

function staffBalance(staffId){
 return DB.staffLedger
  .filter(l=>l.staffId===staffId)
  .reduce((s,l)=>
   s+(l.type==='repayment'?-Number(l.amount):Number(l.amount)),0
  );
}

function customerLedgerEntries(custId){
 let entries=[];

 DB.invoices.filter(i=>i.customerId===custId).forEach(i=>{
  entries.push({
   date:i.date,
   type:'Bill',
   ref:i.no,
   debit:i.total,
   credit:0,
   invId:i.id
  });

  if(i.paidAmt>0){
   entries.push({
    date:i.date,
    type:'Payment (at billing)',
    ref:i.no,
    debit:0,
    credit:i.paidAmt
   });
  }
 });

 DB.payments.filter(p=>p.customerId===custId).forEach(p=>{
  entries.push({
   date:p.date,
   type:'Payment',
   ref:p.note||'-',
   debit:0,
   credit:Number(p.amount),
   paymentId:p.id
  });
 });

 entries.sort((a,b)=>a.date.localeCompare(b.date));

 let running=0;

 return entries.map(e=>{
  running+=e.debit-e.credit;
  return {...e,balance:running};
 });
}

function materialProfitTotal(){
 return DB.invoices.reduce(
  (s,i)=>
   s+i.items.reduce(
    (s2,it)=>
     s2+(it.sqft*((it.rate||0)-(it.purchaseRate||0))),0
   )-Number(i.discount||0),
  0
 );
}

// ---------- DASHBOARD ----------

function viewDashboard(){
 const rev=DB.invoices.reduce((s,i)=>s+Number(i.total),0);

 const due=DB.invoices.reduce(
  (s,i)=>s+invoiceDue(i),0
 );

 const exp=DB.expenses.reduce(
  (s,e)=>s+Number(e.amount),0
 );

 const profit=materialProfitTotal();

 const lowStock=DB.inventory.filter(x=>
  x.type==='roll'?x.qty<=x.rollSize:x.qty<=0
 );

 const recent=[...DB.invoices]
  .sort((a,b)=>b.date.localeCompare(a.date))
  .slice(0,6);

 const todays=[...DB.invoices]
  .filter(i=>i.date===today())
  .sort((a,b)=>
   String(b.createdAt||'').localeCompare(String(a.createdAt||''))
  );

 const todayTotal=todays.reduce(
  (sum,inv)=>sum+Number(inv.total),0
 );

 return `
 <div class="grid3">
  <div class="stat">
   <b>${money(rev)}</b>
   <span>Total Billed (after discounts)</span>
  </div>
  <div class="stat">
   <b style="color:var(--danger)">${money(due)}</b>
   <span>Outstanding Invoice Dues</span>
  </div>
  <div class="stat">
   <b style="color:var(--good)">${money(rev-exp)}</b>
   <span>Net (Billed - Expenses)</span>
  </div>
  <div class="stat">
   <b style="color:${profit>=0?'var(--good)':'var(--danger)'}">
    ${money(profit)}
   </b>
   <span>Material Margin After Discount</span>
  </div>
 </div>

 <div class="card">
  <h2>Today's Invoices — ${esc(today())} (${todays.length})</h2>

  <p class="muted">
   Today's billed amount: <b>${money(todayTotal)}</b>
  </p>

  <div class="tw">
   <table>
    <thead>
     <tr>
      <th>No</th>
      <th>Customer</th>
      <th>Date</th>
      <th class="right">Total</th>
      <th class="right">Received</th>
      <th class="right">Due</th>
      <th>Status</th>
      <th>Actions</th>
     </tr>
    </thead>
    <tbody>
     ${todays.map(i=>`
      <tr>
       <td><b>${esc(i.no)}</b></td>
       <td>${esc(custName(i.customerId))}</td>
       <td>${esc(i.date)}</td>
       <td class="right">${money(i.total)}</td>
       <td class="right">${money(paidOnInvoice(i))}</td>
       <td class="right">${money(invoiceDue(i))}</td>
       <td>
        <span class="pill ${invoiceStatus(i)==='Paid'?'paid':'due'}">
         ${invoiceStatus(i)}
        </span>
       </td>
       <td>
        <button class="btn ghost sm" data-edit-inv="${esc(i.id)}">
         Edit
        </button>
        <button class="btn ghost sm" data-print="${esc(i.id)}">
         Print
        </button>
        <button class="btn danger sm" data-del-inv2="${esc(i.id)}">
         Delete
        </button>
       </td>
      </tr>
     `).join('')||'<tr><td colspan="8">No invoices today</td></tr>'}
    </tbody>
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Recent Invoices</h2>

  <div class="tw">
   <table>
    <tr>
     <th>#</th>
     <th>Customer</th>
     <th>Date</th>
     <th class="right">Total</th>
     <th class="right">Balance</th>
     <th>Status</th>
    </tr>

    ${recent.map(i=>`
     <tr>
      <td>${esc(i.no)}</td>
      <td>${esc(custName(i.customerId))}</td>
      <td>${esc(i.date)}</td>
      <td class="right">${money(i.total)}</td>
      <td class="right">${money(invoiceDue(i))}</td>
      <td>
       <span class="pill ${invoiceStatus(i)==='Paid'?'paid':'due'}">
        ${invoiceStatus(i)}
       </span>
      </td>
     </tr>
    `).join('')||'<tr><td colspan="6">No invoices yet</td></tr>'}
   </table>
  </div>
 </div>

 ${lowStock.length?`
  <div class="card">
   <h2>⚠ Low Stock Alerts</h2>
   <div class="tw">
    <table>
     <tr><th>Company</th><th>Item</th><th>Remaining</th></tr>

     ${lowStock.map(x=>`
      <tr>
       <td>${esc(x.company)}</td>
       <td>${esc(x.name)}</td>
       <td class="lowstock">
        ${x.qty.toFixed(1)} ${esc(x.unit)}
       </td>
      </tr>
     `).join('')}
    </table>
   </div>
  </div>
 `:''}
 `;
}

// ---------- CUSTOMERS ----------

let expandedCustId='';
let viewingBillId='';

function viewCustomers(){
 const rows=DB.customers.map(c=>{
  const bal=customerBalance(c.id);

  return `
   <tr data-search="${esc([
    c.custId,c.name,c.phone,c.addr
   ].join(' '))}">
    <td><b>${esc(c.custId)}</b></td>
    <td>${esc(c.name)}</td>
    <td>${esc(c.phone||'-')}</td>
    <td>${esc(c.addr||'-')}</td>
    <td class="${bal>0?'lowstock':''}">${money(bal)}</td>
    <td>
     <button class="btn ghost sm" data-view-cust="${esc(c.id)}">
      ${expandedCustId===c.id?'Hide Ledger':'View Ledger'}
     </button>
     <button class="btn danger sm" data-del-cust="${esc(c.id)}">
      Del
     </button>
    </td>
   </tr>`;
 }).join('')||'<tr><td colspan="6">No customers yet</td></tr>';

 let panel='';
 const c=DB.customers.find(c=>c.id===expandedCustId);

 if(c){
  const entries=customerLedgerEntries(c.id);
  const totalDebit=entries.reduce((s,e)=>s+e.debit,0);
  const totalCredit=entries.reduce((s,e)=>s+e.credit,0);

  let billPanel='';
  const inv=viewingBillId?
   DB.invoices.find(i=>i.id===viewingBillId):null;

  if(inv&&inv.customerId===c.id){
   billPanel=`
   <div class="card" style="background:var(--bg)">
    <h2>Bill ${esc(inv.no)} — ${esc(inv.date)}</h2>
    <div class="tw">
     <table>
      <tr>
       <th>Item</th><th>Qty</th><th>Rate</th>
       <th class="right">Amount</th>
      </tr>

      ${inv.items.map(it=>`
       <tr>
        <td>${esc(it.desc)}</td>
        <td>${it.sqft.toFixed(2)} ${esc(it.unit||'sqft')}</td>
        <td>${money(it.rate)}</td>
        <td class="right">${money(it.amount)}</td>
       </tr>
      `).join('')}
     </table>
    </div>

    <div class="flexend">
     <b>
      Less: ${money(inv.discount||0)} |
      Total: ${money(inv.total)} |
      Ledger Received: ${money(inv.ledgerPaidAmt||0)} |
      Outstanding: ${money(invoiceDue(inv))}
     </b>
    </div>

    <button class="btn ghost sm" id="closeBillView">
     Close
    </button>
   </div>`;
  }

  panel=`
   <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
     <h2>
      Customer Ledger — ${esc(c.name)} (${esc(c.custId)})
     </h2>
     <button class="btn ghost sm" data-print-ledger="${esc(c.id)}">
      🖨 Print Ledger
     </button>
    </div>

    <p class="muted">
     Phone: ${esc(c.phone||'-')} |
     Address: ${esc(c.addr||'-')} |
     Pending:
     <b>${money(customerBalance(c.id))}</b>
    </p>

    <div class="tw">
     <table>
      <tr>
       <th>Date</th>
       <th>Type</th>
       <th>Reference</th>
       <th class="right">Debit</th>
       <th class="right">Credit</th>
       <th class="right">Balance</th>
       <th></th>
      </tr>

      ${entries.map(e=>`
       <tr>
        <td>${esc(e.date)}</td>
        <td>${esc(e.type)}</td>
        <td>${esc(e.ref)}</td>
        <td class="right">${e.debit?money(e.debit):'-'}</td>
        <td class="right">${e.credit?money(e.credit):'-'}</td>
        <td class="right">${money(e.balance)}</td>
        <td>
         ${e.invId?`
          <button class="btn ghost sm" data-view-bill="${esc(e.invId)}">
           View
          </button>
         `:e.paymentId?`
          <button class="btn danger sm" data-del-pay="${esc(e.paymentId)}">
           Del
          </button>
         `:''}
        </td>
       </tr>
      `).join('')||'<tr><td colspan="7">No ledger entries yet</td></tr>'}

      <tr style="font-weight:700">
       <td colspan="3">Totals</td>
       <td class="right">${money(totalDebit)}</td>
       <td class="right">${money(totalCredit)}</td>
       <td class="right">${money(totalDebit-totalCredit)}</td>
       <td></td>
      </tr>
     </table>
    </div>

    ${billPanel}

    <div class="row row3" style="margin-top:14px">
     <div>
      <label>Date</label>
      <input id="pay_date" type="date" value="${today()}">
     </div>
     <div>
      <label>Amount Received</label>
      <input id="pay_amt" type="number">
     </div>
     <div>
      <label>Note</label>
      <input id="pay_note" placeholder="Cash / Bank...">
     </div>
    </div>

    <button class="btn" id="addPayment" data-cust="${esc(c.id)}">
     + Record Payment
    </button>
   </div>`;
 }

 return `
 <div class="card">
  <h2>Add Customer</h2>
  <div class="row row4">
   <div><label>Name</label><input id="c_name"></div>
   <div><label>Phone</label><input id="c_phone"></div>
   <div><label>Address</label><input id="c_addr"></div>
   <div style="align-self:end">
    <button class="btn" id="addCust">+ Add Customer</button>
   </div>
  </div>
 </div>

 <div class="card">
  <h2>Customers (${DB.customers.length})</h2>

  <div class="search-bar">
   <label for="customerSearch">Search Customers</label>
   <input
    id="customerSearch"
    type="search"
    placeholder="Search name, ID, phone or address..."
    value="${esc(customerSearch)}"
    autocomplete="off">
   <span id="customerMatchCount" class="muted"></span>
  </div>

  <div class="tw">
   <table id="customerTable">
    <thead>
     <tr>
      <th>ID</th>
      <th>Name</th>
      <th>Phone</th>
      <th>Address</th>
      <th>Pending Amount</th>
      <th></th>
     </tr>
    </thead>
    <tbody>${rows}</tbody>
   </table>
  </div>
 </div>

 ${panel}`;
}

// ---------- INVENTORY ----------

let invAddType='roll';

function viewInventory(){
 const usedTodayById=new Map(
  dailyUseByItem(today()).map(row=>[row.itemId,row.total])
 );

 const typeFields=invAddType==='roll'?`
 <div class="row row4">
  <div>
   <label>Roll Size (sq.ft per roll)</label>
   <input id="inv_rollsize" type="number" placeholder="1722">
  </div>
  <div>
   <label>No. of Rolls Purchased</label>
   <input id="inv_rolls" type="number" value="1">
  </div>
  <div>
   <label>Purchase Rate (₨/sq.ft)</label>
   <input id="inv_prate" type="number" step="0.1">
  </div>
  <div>
   <label>Selling Rate (₨/sq.ft)</label>
   <input id="inv_srate" type="number" step="0.1">
  </div>
 </div>`
 :invAddType==='ink'?`
 <div class="row row3">
  <div>
   <label>Quantity (liters)</label>
   <input id="inv_qty" type="number" step="0.1" placeholder="5">
  </div>
  <div>
   <label>Purchase Rate (₨/liter)</label>
   <input id="inv_prate" type="number" step="0.1">
  </div>
  <div>
   <label>Selling Rate (₨/liter)</label>
   <input id="inv_srate" type="number" step="0.1">
  </div>
 </div>`
 :`
 <div class="row row4">
  <div><label>Unit</label><input id="inv_unit" placeholder="pcs / meter / box"></div>
  <div><label>Quantity</label><input id="inv_qty" type="number" step="0.1"></div>
  <div><label>Purchase Rate</label><input id="inv_prate" type="number"></div>
  <div><label>Selling Rate</label><input id="inv_srate" type="number"></div>
 </div>`;

 return `
 <div class="card">
  <h2>Add to Inventory</h2>

  <div class="row row3">
   <div>
    <label>Item Type</label>
    <select id="inv_type">
     <option value="roll" ${invAddType==='roll'?'selected':''}>Flex Roll (sqft)</option>
     <option value="ink" ${invAddType==='ink'?'selected':''}>Ink (litres)</option>
     <option value="accessory" ${invAddType==='accessory'?'selected':''}>Other Item</option>
    </select>
   </div>
   <div><label>Company / Brand</label><input id="inv_company"></div>
   <div><label>Item Name</label><input id="inv_name"></div>
  </div>

  ${typeFields}

  <button class="btn" id="addInv">+ Add to Inventory</button>
 </div>

 <div class="card">
  <h2>Inventory (${DB.inventory.length} items)</h2>

  <div class="tw">
   <table>
    <tr>
     <th>Type</th>
     <th>Company</th>
     <th>Item</th>
     <th>Stock Remaining</th>
     <th>Used Today</th>
     <th>Purchase Rate</th>
     <th>Selling Rate</th>
     <th>Restock</th>
     <th></th>
    </tr>

    ${DB.inventory.map(x=>{
     const low=x.type==='roll'?x.qty<=x.rollSize:x.qty<=0;

     const stockTxt=x.type==='roll'?
      `${x.qty.toFixed(1)} sqft (${(x.qty/x.rollSize).toFixed(1)} rolls)`
      :`${x.qty.toFixed(2)} ${esc(x.unit)}`;

     const restockLabel=x.type==='roll'?'rolls':x.unit;
     const usedToday=usedTodayById.get(x.id)||0;

     return `
     <tr>
      <td>${esc(x.type)}</td>
      <td>${esc(x.company)}</td>
      <td>${esc(x.name)}</td>
      <td class="${low?'lowstock':''}">${stockTxt}</td>
      <td>${usedToday.toFixed(2)} ${esc(x.unit)}</td>
      <td>${money(x.prate)}/${esc(x.unit)}</td>
      <td>${money(x.srate)}/${esc(x.unit)}</td>
      <td>
       <input
        style="width:60px;display:inline-block"
        type="number" min="0.1" step="0.1"
        id="rq_${esc(x.id)}"
        placeholder="${esc(restockLabel)}">
       <button class="btn ghost sm" data-restock="${esc(x.id)}">
        Add
       </button>
      </td>
      <td>
       <button class="btn danger sm" data-del-inv="${esc(x.id)}">
        Del
       </button>
      </td>
     </tr>`;
    }).join('')||'<tr><td colspan="9">No inventory yet</td></tr>'}
   </table>
  </div>
 </div>`;
}

// ---------- DAILY ITEM USES ----------

function dailyUseByItem(day){
 const result=new Map();

 function add(itemId,unit,fromInvoice,quantity){
  const item=DB.inventory.find(x=>x.id===itemId);
  const key=itemId||('missing:'+unit);

  if(!result.has(key)){
   result.set(key,{
    itemId:key,
    name:item?`${item.company} - ${item.name}`:'Deleted / Unknown Item',
    unit:unit||item?.unit||'pcs',
    invoice:0,
    manual:0,
    total:0
   });
  }

  const row=result.get(key);

  if(fromInvoice){
   row.invoice+=Number(quantity)||0;
  }else{
   row.manual+=Number(quantity)||0;
  }

  row.total=row.invoice+row.manual;
 }

 for(const inv of DB.invoices.filter(i=>i.date===day)){
  for(const line of inv.items||[]){
   add(line.itemId,line.unit,true,line.sqft);
  }
 }

 for(const used of DB.inventoryUses.filter(item=>item.date===day)){
  add(used.itemId,null,false,used.qty);
 }

 return [...result.values()].sort((a,b)=>
  a.name.localeCompare(b.name)
 );
}

function viewUses(){
 const day=usesDate||today();
 const items=dailyUseByItem(day);
 const invoiceCount=DB.invoices.filter(inv=>inv.date===day).length;
 const manual=DB.inventoryUses.filter(u=>u.date===day);

 const options=DB.inventory.map(item=>`
  <option value="${esc(item.id)}">
   ${esc(item.company)} - ${esc(item.name)}
   (${item.qty.toFixed(2)} ${esc(item.unit)} available)
  </option>
 `).join('');

 const usedSqft=items
  .filter(i=>i.unit==='sqft')
  .reduce((sum,i)=>sum+i.total,0);

 return `
 <div class="card">
  <h2>Daily Material Usage — Item Wise</h2>

  <div class="row row3">
   <div>
    <label>Select Date</label>
    <input type="date" id="uses_date" value="${esc(day)}">
   </div>
   <div class="stat">
    <b>${items.length}</b>
    <span>Different Items Used</span>
   </div>
   <div class="stat">
    <b>${usedSqft.toFixed(2)} sqft</b>
    <span>Total Flex Material Used</span>
   </div>
  </div>

  <p class="muted">
   Invoice usage is taken from ${invoiceCount} invoices
   dated ${esc(day)}.
   Manual usage is recorded separately.
  </p>

  <div class="tw">
   <table>
    <thead>
     <tr>
      <th>Item / Brand</th>
      <th>Unit</th>
      <th class="right">Invoice Uses</th>
      <th class="right">Manual Uses</th>
      <th class="right">Total Used</th>
     </tr>
    </thead>
    <tbody>
     ${items.map(i=>`
      <tr>
       <td><b>${esc(i.name)}</b></td>
       <td>${esc(i.unit)}</td>
       <td class="right">${i.invoice.toFixed(2)}</td>
       <td class="right">${i.manual.toFixed(2)}</td>
       <td class="right">
        <b>${i.total.toFixed(2)} ${esc(i.unit)}</b>
       </td>
      </tr>
     `).join('')||'<tr><td colspan="5">No materials used on this date</td></tr>'}
    </tbody>
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Record Non-Invoice / Manual Use</h2>
  <p class="muted">
   For test prints, wastage, samples and maintenance.
   Manual use automatically deducts stock.
  </p>

  <div class="row row4">
   <div>
    <label>Item</label>
    <select id="use_item">
     <option value="">-- select item --</option>
     ${options}
    </select>
   </div>
   <div>
    <label>Quantity Used</label>
    <input id="use_qty" type="number" min="0.0001" step="any">
   </div>
   <div>
    <label>Date</label>
    <input id="use_record_date" type="date" value="${esc(day)}">
   </div>
   <div>
    <label>Note</label>
    <input id="use_note" placeholder="Waste / Sample / Test">
   </div>
  </div>

  <button class="btn" id="addInventoryUse">
   + Record Manual Use
  </button>
 </div>

 <div class="card">
  <h2>Manual Use Records (${manual.length})</h2>

  <div class="tw">
   <table>
    <thead>
     <tr>
      <th>Item</th>
      <th>Date</th>
      <th>Quantity</th>
      <th>Note</th>
      <th>Action</th>
     </tr>
    </thead>
    <tbody>
     ${manual.map(record=>{
      const item=DB.inventory.find(x=>x.id===record.itemId);

      return `
      <tr>
       <td>${esc(item?item.company+' - '+item.name:'Unknown item')}</td>
       <td>${esc(record.date)}</td>
       <td>${record.qty.toFixed(2)} ${esc(item?.unit||'')}</td>
       <td>${esc(record.note||'-')}</td>
       <td>
        <button class="btn danger sm" data-del-use="${esc(record.id)}">
         Delete & Restore Stock
        </button>
       </td>
      </tr>`;
     }).join('')||'<tr><td colspan="5">No manual uses recorded</td></tr>'}
    </tbody>
   </table>
  </div>
 </div>`;
}

// ---------- INVOICING ----------

let draftItems=[];
let draftDate='';
let draftNo='';
let draftCustomerId='';
let draftCustName='';
let draftPaidAmt=0;
let draftDiscount=0;
let draftLineItemId='';
let draftLineDesc='';
let draftNotes='';
let editingInvoiceId=null;

function nextInvoiceNo(){
 const nums=DB.invoices
  .map(x=>/^INV-(\d+)$/.exec(x.no)?.[1])
  .filter(Boolean)
  .map(Number);

 return 'INV-'+String(
  Math.max(0,...nums)+1
 ).padStart(4,'0');
}

function clearInvoiceDraft(){
 draftItems=[];
 draftDate='';
 draftNo='';
 draftCustomerId='';
 draftCustName='';
 draftPaidAmt=0;
 draftDiscount=0;
 draftLineItemId='';
 draftLineDesc='';
 draftNotes='';
 editingInvoiceId=null;
}

function captureInvHeader(){
 const d=document.getElementById('inv_date');
 if(d)draftDate=d.value;

 const n=document.getElementById('inv_no');
 if(n)draftNo=n.value;

 const p=document.getElementById('inv_paid');
 if(p)draftPaidAmt=Number(p.value)||0;

 const discount=document.getElementById('inv_discount');
 if(discount)draftDiscount=Number(discount.value)||0;

 const note=document.getElementById('inv_notes');
 if(note)draftNotes=note.value;

 const lineDesc=document.getElementById('li_desc');
 if(lineDesc)draftLineDesc=lineDesc.value;
}

function matchCustomerByName(){
 const typed=(draftCustName||'').trim().toLowerCase();

 if(!typed){
  draftCustomerId='';
  return;
 }

 const c=DB.customers.find(c=>
  c.name.trim().toLowerCase()===typed
 );

 draftCustomerId=c?c.id:'';
}

function viewInvoices(){
 const selItem=DB.inventory.find(x=>x.id===draftLineItemId);

 const unitLabel=selItem?
  (selItem.unit==='sqft'?'Sq.Ft':`Quantity (${esc(selItem.unit)})`)
  :'Sq.Ft / Quantity';

 const invItemOpts=DB.inventory.map(x=>`
  <option value="${esc(x.id)}" ${x.id===draftLineItemId?'selected':''}>
   ${esc(x.company)} - ${esc(x.name)}
   (${money(x.srate)}/${esc(x.unit)}, ${x.qty.toFixed(2)} left)
  </option>
 `).join('');

 const subtotal=draftItems.reduce((s,i)=>s+i.amount,0);
 const total=Math.max(0,subtotal-(Number(draftDiscount)||0));

 const defaultLineDesc=draftLineDesc||
  (selItem?`${selItem.company} ${selItem.name}`:'');

 return `
 <div class="card">
  ${editingInvoiceId?`
   <div class="banner">
    Editing Invoice ${esc(draftNo)}.
    Update or cancel your changes.
    <a href="#" id="cancelEdit">Cancel</a>
   </div>
  `:''}

  <h2>${editingInvoiceId?'Edit Invoice':'Create Invoice'}</h2>

  <div class="row row3">
   <div>
    <label>Customer (type to search)</label>
    <input
     id="cust_search"
     list="custList"
     placeholder="Type customer name..."
     value="${esc(draftCustName||'')}">

    <datalist id="custList">
     ${DB.customers.map(c=>`
      <option value="${esc(c.name)}">
       ${esc(c.custId)} - ${esc(c.phone||'')}
      </option>
     `).join('')}
    </datalist>

    ${draftCustomerId?`
     <div class="muted" style="margin-top:4px">
      Selected: <b>${esc(custName(draftCustomerId))}</b>
      |
      Customer Balance:
      <b>${money(customerBalance(draftCustomerId))}</b>
     </div>
    `:draftCustName?`
     <div class="muted">
      No existing customer with this name.
      <button class="btn ghost sm" id="quickAddCust">
       + Save as New Customer
      </button>
     </div>
    `:''}
   </div>

   <div style="align-self:end">
    <button class="btn ghost" id="toggleNewCust">
     + New Customer
    </button>
   </div>
   <div></div>
  </div>

  <div id="newCustBox" class="row row4 hide">
   <div><label>Name</label><input id="nc_name" value="${esc(draftCustName)}"></div>
   <div><label>Phone</label><input id="nc_phone"></div>
   <div><label>Address</label><input id="nc_addr"></div>
   <div style="align-self:end">
    <button class="btn" id="saveNewCust">Save & Select</button>
   </div>
  </div>

  <div class="row row3">
   <div>
    <label>Date</label>
    <input id="inv_date" type="date" value="${esc(draftDate||today())}">
   </div>
   <div>
    <label>Invoice No.</label>
    <input id="inv_no" value="${esc(draftNo||nextInvoiceNo())}">
   </div>
  </div>

  <h2>Line Items</h2>

  <div class="row row4">
   <div>
    <label>Item from Inventory</label>
    <select id="li_item">
     <option value="">-- select item --</option>
     ${invItemOpts}
    </select>
   </div>
   <div>
    <label>Description</label>
    <input id="li_desc" value="${esc(defaultLineDesc)}">
   </div>
   <div>
    <label>${esc(unitLabel)}</label>
    <input id="li_sqft" type="number" step="0.01">
   </div>
   <div>
    <label>Rate</label>
    <input id="li_rate" type="number" step="0.01"
     value="${selItem?selItem.srate:''}">
   </div>
  </div>

  <button class="btn ghost" id="addLine">
   + Add Line Item
  </button>

  <div class="tw" style="margin-top:10px">
   <table>
    <tr>
     <th>Description</th>
     <th>Qty</th>
     <th>Rate</th>
     <th class="right">Amount</th>
     <th></th>
    </tr>

    ${draftItems.map((it,idx)=>`
     <tr>
      <td>${esc(it.desc)}</td>
      <td>${it.sqft.toFixed(2)} ${esc(it.unit||'sqft')}</td>
      <td>${money(it.rate)}</td>
      <td class="right">${money(it.amount)}</td>
      <td>
       <button class="btn danger sm" data-rmline="${idx}">
        x
       </button>
      </td>
     </tr>
    `).join('')||'<tr><td colspan="5">No items added</td></tr>'}
   </table>
  </div>

  <div class="row" style="margin-top:10px">
   <div>
    <label>Invoice Notes</label>
    <textarea id="inv_notes" rows="4"
     placeholder="Terms, instructions, delivery details...">${esc(draftNotes||'')}</textarea>
   </div>
  </div>

  <div class="grid3" style="margin-top:12px">
   <div class="stat">
    <b id="invoice_subtotal">${money(subtotal)}</b>
    <span>Subtotal</span>
   </div>
   <div class="stat">
    <b id="invoice_net_total">${money(total)}</b>
    <span>Total After Discount / Less</span>
   </div>
  </div>

  <div class="row row3" style="margin-top:12px">
   <div>
    <label>Discount / Less (Rs.)</label>
    <input id="inv_discount" type="number" min="0" step="0.01"
     value="${esc(draftDiscount||0)}">
   </div>
   <div>
    <label>Amount Paid at Billing</label>
    <input id="inv_paid" type="number" min="0" step="0.01"
     value="${esc(draftPaidAmt||0)}">
   </div>
   <div>
    <label>Remaining on this Invoice</label>
    <input id="inv_remaining" type="number" readonly
     value="${(total-draftPaidAmt).toFixed(2)}">
   </div>
  </div>

  <div class="flexend">
   <button class="btn" id="saveInvoice">
    ${editingInvoiceId?'💾 Update':'💾 Save'}
   </button>
   <button class="btn ghost" id="clearDraft">
    Clear
   </button>
  </div>
 </div>

 <div class="card">
  <h2>All Invoices (${DB.invoices.length})</h2>

  <div class="search-bar">
   <label for="invoiceSearch">Search Invoices</label>
   <input id="invoiceSearch" type="search"
    placeholder="Invoice number, customer, phone, date or status..."
    value="${esc(invoiceSearch)}"
    autocomplete="off">
   <span class="muted" id="invoiceMatchCount"></span>
  </div>

  <div class="tw">
   <table id="invoiceTable">
    <thead>
     <tr>
      <th>No</th>
      <th>Customer</th>
      <th>Date</th>
      <th class="right">Subtotal</th>
      <th class="right">Less</th>
      <th class="right">Total</th>
      <th class="right">Paid at Billing</th>
      <th class="right">Ledger Received</th>
      <th class="right">Outstanding</th>
      <th>Status</th>
      <th>Actions</th>
     </tr>
    </thead>
    <tbody>
     ${[...DB.invoices].sort((a,b)=>
      b.date.localeCompare(a.date)
     ).map(i=>`
      <tr data-search="${esc([
       i.no,
       custName(i.customerId),
       DB.customers.find(c=>c.id===i.customerId)?.phone||'',
       i.date,
       invoiceStatus(i)
      ].join(' '))}">
       <td>${esc(i.no)}</td>
       <td>${esc(custName(i.customerId))}</td>
       <td>${esc(i.date)}</td>
       <td class="right">${money(Number(i.total)+Number(i.discount||0))}</td>
       <td class="right">${money(i.discount||0)}</td>
       <td class="right">${money(i.total)}</td>
       <td class="right">${money(i.paidAmt)}</td>
       <td class="right">${money(i.ledgerPaidAmt||0)}</td>
       <td class="right">${money(invoiceDue(i))}</td>
       <td>${invoiceStatus(i)}</td>
       <td>
        <button class="btn ghost sm" data-edit-inv="${esc(i.id)}">
         Edit
        </button>
        <button class="btn ghost sm" data-print="${esc(i.id)}">
         Print
        </button>
        <button class="btn danger sm" data-del-inv2="${esc(i.id)}">
         Del
        </button>
       </td>
      </tr>
     `).join('')||'<tr><td colspan="11">No invoices yet</td></tr>'}
    </tbody>
   </table>
  </div>
 </div>`;
}

// ---------- JOB ORDERS ----------

function viewJobs(){
 const invOpts=DB.invoices.map(i=>`
  <option value="${esc(i.id)}">
   ${esc(i.no)} - ${esc(custName(i.customerId))}
  </option>
 `).join('');

 return `
 <div class="card">
  <h2>New Job Order</h2>

  <div class="row row4">
   <div>
    <label>Link to Invoice</label>
    <select id="job_inv">
     <option value="">-- none --</option>
     ${invOpts}
    </select>
   </div>
   <div>
    <label>Job Description</label>
    <input id="job_desc" placeholder="Print + Eyelets">
   </div>
   <div>
    <label>Due Date</label>
    <input id="job_due" type="date">
   </div>
   <div style="align-self:end">
    <button class="btn" id="addJob">+ Add Job</button>
   </div>
  </div>
 </div>

 <div class="card">
  <h2>Job Orders (${DB.jobs.length})</h2>

  <div class="tw">
   <table>
    <tr>
     <th>Job</th>
     <th>Invoice</th>
     <th>Due</th>
     <th>Status</th>
     <th></th>
    </tr>

    ${DB.jobs.map(j=>`
     <tr>
      <td>${esc(j.desc)}</td>
      <td>${esc(j.invId?DB.invoices.find(i=>i.id===j.invId)?.no||'-':'-')}</td>
      <td>${esc(j.due||'-')}</td>
      <td>${esc(j.status)}</td>
      <td>
       <select data-jobstatus="${esc(j.id)}">
        ${['Pending','Printing','Ready','Delivered'].map(s=>`
         <option ${j.status===s?'selected':''}>${s}</option>
        `).join('')}
       </select>
       <button class="btn danger sm" data-del-job="${esc(j.id)}">
        Del
       </button>
      </td>
     </tr>
    `).join('')||'<tr><td colspan="5">No jobs yet</td></tr>'}
   </table>
  </div>
 </div>`;
}

// ---------- EXPENSES AND STAFF ----------

let expandedStaffId='';
let editingLedgerId=null;

function viewExpenses(){
 const st=DB.staff.find(s=>s.id===expandedStaffId);
 let staffPanel='';

 if(st){
  const entries=[...DB.staffLedger]
   .filter(l=>l.staffId===st.id)
   .sort((a,b)=>b.date.localeCompare(a.date));

  const editingEntry=editingLedgerId?
   DB.staffLedger.find(l=>l.id===editingLedgerId):null;

  staffPanel=`
   <div class="card">
    <h2>
     ${esc(st.name)} — Outstanding Loan/Advance:
     ${money(staffBalance(st.id))}
    </h2>

    <div class="tw">
     <table>
      <tr>
       <th>Date</th>
       <th>Type</th>
       <th>Note</th>
       <th class="right">Amount</th>
       <th></th>
      </tr>

      ${entries.map(l=>`
       <tr>
        <td>${esc(l.date)}</td>
        <td>${esc(l.type)}</td>
        <td>${esc(l.note||'-')}</td>
        <td class="right">${money(l.amount)}</td>
        <td>
         <button class="btn ghost sm" data-edit-ledger="${esc(l.id)}">
          Edit
         </button>
         <button class="btn danger sm" data-del-ledger="${esc(l.id)}">
          Del
         </button>
        </td>
       </tr>
      `).join('')}
     </table>
    </div>

    ${editingEntry?`
     <div class="banner">
      Editing entry from ${esc(editingEntry.date)}
      <a href="#" id="cancelLedgerEdit">Cancel</a>
     </div>
    `:''}

    <div class="row row4">
     <div>
      <label>Date</label>
      <input id="ld_date" type="date"
       value="${editingEntry?editingEntry.date:today()}">
     </div>
     <div>
      <label>Type</label>
      <select id="ld_type">
       <option value="loan" ${editingEntry?.type==='loan'?'selected':''}>Loan Given</option>
       <option value="advance" ${editingEntry?.type==='advance'?'selected':''}>Advance Given</option>
       <option value="repayment" ${editingEntry?.type==='repayment'?'selected':''}>Repayment Received</option>
      </select>
     </div>
     <div>
      <label>Amount</label>
      <input id="ld_amt" type="number"
       value="${editingEntry?editingEntry.amount:''}">
     </div>
     <div>
      <label>Note</label>
      <input id="ld_note" value="${esc(editingEntry?.note||'')}">
     </div>
    </div>

    <button class="btn" id="addLedger" data-staff="${esc(st.id)}">
     ${editingEntry?'Update Entry':'+ Add Entry'}
    </button>
   </div>`;
 }

 return `
 <div class="card">
  <h2>Add Expense</h2>
  <div class="row row4">
   <div>
    <label>Date</label>
    <input id="ex_date" type="date" value="${today()}">
   </div>
   <div>
    <label>Category</label>
    <input id="ex_cat" placeholder="Ink / Rent / Power">
   </div>
   <div>
    <label>Amount</label>
    <input id="ex_amt" type="number">
   </div>
   <div style="align-self:end">
    <button class="btn" id="addExp">+ Add Expense</button>
   </div>
  </div>
 </div>

 <div class="card">
  <h2>Expenses</h2>
  <div class="tw">
   <table>
    <tr><th>Date</th><th>Category</th><th>Amount</th><th></th></tr>

    ${DB.expenses.map(e=>`
     <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(e.cat)}</td>
      <td>${money(e.amount)}</td>
      <td>
       <button class="btn danger sm" data-del-exp="${esc(e.id)}">
        Del
       </button>
      </td>
     </tr>
    `).join('')}
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Add Staff</h2>
  <div class="row row3">
   <div><label>Name</label><input id="st_name"></div>
   <div><label>Role</label><input id="st_role"></div>
   <div><label>Salary</label><input id="st_sal" type="number"></div>
  </div>
  <button class="btn" id="addStaff">+ Add Staff</button>
 </div>

 <div class="card">
  <h2>Staff (${DB.staff.length})</h2>
  <div class="tw">
   <table>
    <tr>
     <th>Name</th><th>Role</th><th>Salary</th>
     <th>Loan/Advance Balance</th><th></th>
    </tr>

    ${DB.staff.map(s=>`
     <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.role)}</td>
      <td>${money(s.sal)}</td>
      <td>${money(staffBalance(s.id))}</td>
      <td>
       <button class="btn ghost sm" data-view-staff="${esc(s.id)}">
        Loan/Advance
       </button>
       <button class="btn danger sm" data-del-staff="${esc(s.id)}">
        Del
       </button>
      </td>
     </tr>
    `).join('')}
   </table>
  </div>
 </div>

 ${staffPanel}`;
}

// ---------- REPORTS ----------

function viewReports(){
 const rev=DB.invoices.reduce((s,i)=>s+Number(i.total),0);

 const collected=
  DB.invoices.reduce((s,i)=>s+Number(i.paidAmt),0)+
  DB.payments.reduce((s,p)=>s+Number(p.amount),0);

 const exp=DB.expenses.reduce((s,e)=>s+Number(e.amount),0);
 const payroll=DB.staff.reduce((s,x)=>s+Number(x.sal),0);
 const materialProfit=materialProfitTotal();

 const byCat={};

 DB.expenses.forEach(e=>{
  byCat[e.cat]=(byCat[e.cat]||0)+Number(e.amount);
 });

 const todayStr=today();
 const todaysItems=DB.invoices
  .filter(i=>i.date===todayStr)
  .flatMap(i=>i.items);

 const sqftToday=todaysItems
  .filter(it=>(it.unit||'sqft')==='sqft')
  .reduce((s,it)=>s+it.sqft,0);

 const unitSales={};

 todaysItems
  .filter(it=>(it.unit||'sqft')!=='sqft')
  .forEach(it=>{
   unitSales[it.unit]=(unitSales[it.unit]||0)+it.sqft;
  });

 return `
 <div class="grid3">
  <div class="stat">
   <b>${money(rev)}</b>
   <span>Total Revenue Billed</span>
  </div>
  <div class="stat">
   <b>${money(collected)}</b>
   <span>Amount Collected</span>
  </div>
  <div class="stat">
   <b>${money(materialProfit)}</b>
   <span>Material Profit After Discounts</span>
  </div>
  <div class="stat">
   <b>${money(rev-exp-payroll)}</b>
   <span>Estimated Net Profit</span>
  </div>
 </div>

 <div class="card">
  <h2>Today's Sales (${todayStr})</h2>
  <p>Flex sold: ${sqftToday.toFixed(2)} sqft</p>
  <p>
   Other items:
   ${Object.keys(unitSales).length?
    Object.entries(unitSales)
     .map(([u,v])=>v.toFixed(2)+' '+esc(u))
     .join(', '):'0'}
  </p>
 </div>

 <div class="card">
  <h2>Current Inventory Stock</h2>
  <div class="tw">
   <table>
    <tr>
     <th>Type</th><th>Company</th>
     <th>Item</th><th>Remaining</th>
    </tr>
    ${DB.inventory.map(x=>`
     <tr>
      <td>${esc(x.type)}</td>
      <td>${esc(x.company)}</td>
      <td>${esc(x.name)}</td>
      <td>${x.qty.toFixed(2)} ${esc(x.unit)}</td>
     </tr>
    `).join('')}
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Today's Item-Wise Uses</h2>
  <div class="tw">
   <table>
    <tr>
     <th>Item</th>
     <th>Invoice Uses</th>
     <th>Manual Uses</th>
     <th>Total Used</th>
    </tr>

    ${dailyUseByItem(todayStr).map(i=>`
     <tr>
      <td>${esc(i.name)}</td>
      <td>${i.invoice.toFixed(2)} ${esc(i.unit)}</td>
      <td>${i.manual.toFixed(2)} ${esc(i.unit)}</td>
      <td><b>${i.total.toFixed(2)} ${esc(i.unit)}</b></td>
     </tr>
    `).join('')||'<tr><td colspan="4">No uses today</td></tr>'}
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Expense Breakdown</h2>
  <div class="tw">
   <table>
    <tr><th>Category</th><th>Amount</th></tr>
    ${Object.keys(byCat).map(c=>`
     <tr>
      <td>${esc(c)}</td>
      <td>${money(byCat[c])}</td>
     </tr>
    `).join('')}
   </table>
  </div>
 </div>

 <div class="card">
  <h2>Job Status Summary</h2>
  <div class="grid3">
   ${['Pending','Printing','Ready','Delivered'].map(s=>`
    <div class="stat">
     <b>${DB.jobs.filter(j=>j.status===s).length}</b>
     <span>${s}</span>
    </div>
   `).join('')}
  </div>
 </div>`;
}

// ---------- SETTINGS ----------

function viewSettings(){
 return `
 <div class="card">
  <h2>Admin Settings</h2>

  <p class="muted">
   Logged in as
   <strong>${esc(document.getElementById('adminEmail')?.textContent||'Admin')}</strong>.
  </p>

  <div class="row row3">
   <div>
    <label>Current Password</label>
    <input id="pw_old" type="password">
   </div>
   <div>
    <label>New Password (12+ characters)</label>
    <input id="pw_new" type="password">
   </div>
   <div style="align-self:end">
    <button class="btn" id="changePassword">
     Update Password
    </button>
   </div>
  </div>
 </div>

 <div class="card">
  <h2>Back Up Database</h2>
  <p class="muted">
   Download your business data as a JSON backup.
  </p>
  <button class="btn" id="exportBackup">
   Download Backup (.json)
  </button>
 </div>

 <div class="card">
  <h2>One-Time Import</h2>
  <p class="muted">
   Import only works on an empty database.
  </p>
  <input type="file" id="importFile" accept="application/json,.json">
  <button class="btn ghost" id="importBackup">
   Import into Empty Database
  </button>
 </div>`;
}

// ---------- EVENT HANDLERS ----------

function wireEvents(){
 const q=selector=>document.querySelector(selector);

 const onAll=(selector,handler)=>
  document.querySelectorAll(selector).forEach(element=>{
   element.addEventListener('click',()=>handler(element));
  });

 // Customer search
 const searchCustomers=q('#customerSearch');

 if(searchCustomers){
  searchCustomers.oninput=()=>{
   customerSearch=searchCustomers.value;
   filterTableRows(
    'customerTable',
    customerSearch,
    'customerMatchCount'
   );
  };

  filterTableRows('customerTable',customerSearch,'customerMatchCount');
 }

 // Invoice search
 const searchInvoices=q('#invoiceSearch');

 if(searchInvoices){
  searchInvoices.oninput=()=>{
   invoiceSearch=searchInvoices.value;
   filterTableRows(
    'invoiceTable',
    invoiceSearch,
    'invoiceMatchCount'
   );
  };

  filterTableRows('invoiceTable',invoiceSearch,'invoiceMatchCount');
 }

 // Daily Uses
 if(q('#uses_date')){
  q('#uses_date').onchange=()=>{
   usesDate=q('#uses_date').value||today();
   renderMain();
  };
 }

 if(q('#addInventoryUse')){
  q('#addInventoryUse').onclick=async()=>{
   const itemId=q('#use_item').value;
   const qty=Number(q('#use_qty').value);

   if(!itemId)return alert('Choose an item');
   if(!Number.isFinite(qty)||qty<=0){
    return alert('Enter a valid positive quantity');
   }

   const result=await apply('/inventory-uses','POST',{
    itemId,
    qty,
    date:q('#use_record_date').value||usesDate,
    note:q('#use_note').value
   });

   if(result){
    usesDate=result.date;
    renderMain();
   }
  };
 }

 onAll('[data-del-use]',async b=>{
  if(confirmDelete('Delete this use and restore stock?')){
   await apply(
    '/inventory-uses/'+encodeURIComponent(b.dataset.delUse),
    'DELETE'
   );
  }
 });

 // Customers
 if(q('#addCust')){
  q('#addCust').onclick=async()=>{
   const name=q('#c_name').value.trim();
   if(!name)return alert('Customer name required');

   await apply('/customers','POST',{
    name,
    phone:q('#c_phone').value,
    addr:q('#c_addr').value
   });
  };
 }

 onAll('[data-del-cust]',async b=>{
  if(confirmDelete('Delete this customer?')){
   await apply(
    '/customers/'+encodeURIComponent(b.dataset.delCust),
    'DELETE'
   );
  }
 });

 onAll('[data-view-cust]',b=>{
  expandedCustId=
   expandedCustId===b.dataset.viewCust?'':b.dataset.viewCust;

  viewingBillId='';
  renderMain();
 });

 onAll('[data-view-bill]',b=>{
  viewingBillId=
   viewingBillId===b.dataset.viewBill?'':b.dataset.viewBill;

  renderMain();
 });

 if(q('#closeBillView')){
  q('#closeBillView').onclick=()=>{
   viewingBillId='';
   renderMain();
  };
 }

 onAll('[data-print-ledger]',b=>
  printCustomerLedger(b.dataset.printLedger)
 );

 // Customer payments
 if(q('#addPayment')){
  q('#addPayment').onclick=async()=>{
   const amount=Number(q('#pay_amt').value);

   if(!Number.isFinite(amount)||amount<=0){
    return alert('Enter a positive payment amount');
   }

   await apply('/payments','POST',{
    customerId:q('#addPayment').dataset.cust,
    date:q('#pay_date').value,
    amount,
    note:q('#pay_note').value
   });
  };
 }

 onAll('[data-del-pay]',async b=>{
  if(confirmDelete('Delete this payment record?')){
   await apply(
    '/payments/'+encodeURIComponent(b.dataset.delPay),
    'DELETE'
   );
  }
 });

 // Inventory
 if(q('#inv_type')){
  q('#inv_type').onchange=()=>{
   invAddType=q('#inv_type').value;
   renderMain();
  };
 }

 if(q('#addInv')){
  q('#addInv').onclick=async()=>{
   const type=q('#inv_type').value;
   const company=q('#inv_company').value.trim();
   const name=q('#inv_name').value.trim();

   if(!company||!name){
    return alert('Company and item name are required');
   }

   const prate=Number(q('#inv_prate').value)||0;
   const srate=Number(q('#inv_srate').value)||0;

   const body={type,company,name,prate,srate};

   if(type==='roll'){
    const rollSize=Number(q('#inv_rollsize').value);
    const rolls=Number(q('#inv_rolls').value);

    if(rollSize<=0||rolls<=0){
     return alert('Enter valid roll size and number');
    }

    Object.assign(body,{
     unit:'sqft',
     rollSize,
     qty:rollSize*rolls
    });

   }else if(type==='ink'){
    Object.assign(body,{
     unit:'liter',
     qty:Number(q('#inv_qty').value)||0
    });
   }else{
    Object.assign(body,{
     unit:q('#inv_unit').value.trim()||'pcs',
     qty:Number(q('#inv_qty').value)||0
    });
   }

   await apply('/inventory','POST',body);
  };
 }

 onAll('[data-del-inv]',async b=>{
  if(confirmDelete('Delete this inventory item?')){
   await apply(
    '/inventory/'+encodeURIComponent(b.dataset.delInv),
    'DELETE'
   );
  }
 });

 onAll('[data-restock]',async b=>{
  const quantity=Number(
   document.getElementById('rq_'+b.dataset.restock)?.value
  );

  if(!Number.isFinite(quantity)||quantity<=0){
   return alert('Enter a positive restock amount');
  }

  await apply(
   '/inventory/'+encodeURIComponent(b.dataset.restock)+'/restock',
   'PATCH',
   {quantity}
  );
 });

 // Invoice form
 if(q('#cust_search')){
  q('#cust_search').oninput=()=>{
   draftCustName=q('#cust_search').value;
   matchCustomerByName();
  };
 }

 if(q('#quickAddCust')){
  q('#quickAddCust').onclick=()=>{
   q('#newCustBox').classList.remove('hide');
   q('#nc_name')?.focus();
  };
 }

 if(q('#toggleNewCust')){
  q('#toggleNewCust').onclick=()=>{
   q('#newCustBox').classList.toggle('hide');
  };
 }

 if(q('#saveNewCust')){
  q('#saveNewCust').onclick=async()=>{
   const name=q('#nc_name').value.trim();

   if(!name)return alert('Name required');

   captureInvHeader();

   const created=await apply('/customers','POST',{
    name,
    phone:q('#nc_phone').value,
    addr:q('#nc_addr').value
   });

   if(created){
    draftCustName=created.name;
    draftCustomerId=created.id;
    renderMain();
   }
  };
 }

 if(q('#cancelEdit')){
  q('#cancelEdit').onclick=e=>{
   e.preventDefault();
   clearInvoiceDraft();
   renderMain();
  };
 }

 // Edit invoice, including Dashboard action
 onAll('[data-edit-inv]',b=>{
  const inv=DB.invoices.find(i=>i.id===b.dataset.editInv);
  if(!inv)return;

  editingInvoiceId=inv.id;
  draftItems=inv.items.map(it=>({...it}));
  draftCustomerId=inv.customerId;
  draftCustName=custName(inv.customerId);
  draftDate=inv.date;
  draftNo=inv.no;
  draftPaidAmt=inv.paidAmt;
  draftDiscount=inv.discount||0;
  draftLineItemId='';
  draftLineDesc='';
  draftNotes=inv.notes||'';

  active='invoices';
  renderNav();
  window.scrollTo(0,0);
  renderMain();
 });

 if(q('#li_item')){
  q('#li_item').onchange=()=>{
   captureInvHeader();
   draftLineItemId=q('#li_item').value;
   draftLineDesc='';
   renderMain();
  };
 }

 function updateInvoicePreview(){
  const subtotal=draftItems.reduce(
   (sum,it)=>sum+it.amount,0
  );

  const discount=Number(q('#inv_discount')?.value)||0;
  const paid=Number(q('#inv_paid')?.value)||0;
  const total=Math.max(0,subtotal-discount);

  if(q('#invoice_net_total')){
   q('#invoice_net_total').textContent=money(total);
  }

  if(q('#inv_remaining')){
   q('#inv_remaining').value=(total-paid).toFixed(2);
  }
 }

 if(q('#inv_paid')){
  q('#inv_paid').oninput=updateInvoicePreview;
 }

 if(q('#inv_discount')){
  q('#inv_discount').oninput=updateInvoicePreview;
 }

 if(q('#addLine')){
  q('#addLine').onclick=()=>{
   const item=DB.inventory.find(i=>i.id===q('#li_item').value);

   if(!item)return alert('Please choose an inventory item');

   const sqft=Number(q('#li_sqft').value);
   const rate=Number(q('#li_rate').value);

   if(!Number.isFinite(sqft)||sqft<=0){
    return alert('Enter a positive quantity');
   }

   if(!Number.isFinite(rate)||rate<0){
    return alert('Rate must be zero or higher');
   }

   const desc=
    q('#li_desc')?.value.trim()||
    (item.company+' '+item.name);

   const existingQty=editingInvoiceId?
    (DB.invoices.find(i=>i.id===editingInvoiceId)?.items||[])
     .filter(it=>it.itemId===item.id)
     .reduce((s,it)=>s+it.sqft,0)
    :0;

   const alreadyDrafted=draftItems
    .filter(it=>it.itemId===item.id)
    .reduce((s,it)=>s+it.sqft,0);

   const available=item.qty+existingQty;

   if(sqft+alreadyDrafted>available){
    return alert(
     'Insufficient stock. Available: '+
     available.toFixed(2)+' '+item.unit
    );
   }

   draftItems.push({
    desc,
    itemId:item.id,
    sqft,
    unit:item.unit,
    rate,
    amount:Math.round(sqft*rate*100)/100,
    purchaseRate:item.prate
   });

   draftLineItemId='';
   draftLineDesc='';
   captureInvHeader();
   renderMain();
  };
 }

 onAll('[data-rmline]',b=>{
  draftItems.splice(Number(b.dataset.rmline),1);
  captureInvHeader();
  renderMain();
 });

 if(q('#clearDraft')){
  q('#clearDraft').onclick=()=>{
   clearInvoiceDraft();
   renderMain();
  };
 }

 if(q('#saveInvoice')){
  q('#saveInvoice').onclick=async()=>{
   if(!draftItems.length){
    return alert('Add at least one line item');
   }

   captureInvHeader();
   matchCustomerByName();

   if(!draftCustomerId){
    return alert('Choose an existing customer or add a new one');
   }

   const body={
    no:q('#inv_no').value,
    customerId:draftCustomerId,
    date:q('#inv_date').value,
    paidAmt:Number(q('#inv_paid').value),
    discount:Number(q('#inv_discount')?.value||0),
    notes:q('#inv_notes')?.value||'',
    items:draftItems.map(it=>({
     itemId:it.itemId,
     desc:it.desc,
     sqft:it.sqft,
     rate:it.rate
    }))
   };

   const result=await apply(
    editingInvoiceId?
     '/invoices/'+encodeURIComponent(editingInvoiceId):
     '/invoices',
    editingInvoiceId?'PUT':'POST',
    body
   );

   if(result){
    clearInvoiceDraft();
    renderMain();
   }
  };
 }

 // Dashboard and invoice list actions
 onAll('[data-del-inv2]',async b=>{
  if(confirmDelete('Delete this invoice and restore its stock?')){
   await apply(
    '/invoices/'+encodeURIComponent(b.dataset.delInv2),
    'DELETE'
   );
  }
 });

 onAll('[data-print]',b=>{
  const invoice=DB.invoices.find(i=>i.id===b.dataset.print);
  if(invoice)printInvoice(invoice);
 });

 // Jobs
 if(q('#addJob')){
  q('#addJob').onclick=async()=>{
   const desc=q('#job_desc').value.trim();

   if(!desc)return alert('Job description required');

   await apply('/jobs','POST',{
    invId:q('#job_inv').value||null,
    desc,
    due:q('#job_due').value
   });
  };
 }

 document.querySelectorAll('[data-jobstatus]').forEach(sel=>{
  sel.onchange=async()=>{
   await apply(
    '/jobs/'+encodeURIComponent(sel.dataset.jobstatus)+'/status',
    'PATCH',
    {status:sel.value}
   );
  };
 });

 onAll('[data-del-job]',async b=>{
  if(confirmDelete('Delete this job?')){
   await apply(
    '/jobs/'+encodeURIComponent(b.dataset.delJob),
    'DELETE'
   );
  }
 });

 // Expenses
 if(q('#addExp')){
  q('#addExp').onclick=async()=>{
   const amount=Number(q('#ex_amt').value);

   if(!Number.isFinite(amount)||amount<=0){
    return alert('Enter a positive expense amount');
   }

   await apply('/expenses','POST',{
    cat:q('#ex_cat').value.trim()||'Misc',
    date:q('#ex_date').value,
    amount
   });
  };
 }

 onAll('[data-del-exp]',async b=>{
  if(confirmDelete('Delete expense?')){
   await apply(
    '/expenses/'+encodeURIComponent(b.dataset.delExp),
    'DELETE'
   );
  }
 });

 // Staff
 if(q('#addStaff')){
  q('#addStaff').onclick=async()=>{
   const name=q('#st_name').value.trim();
   if(!name)return alert('Staff name required');

   await apply('/staff','POST',{
    name,
    role:q('#st_role').value,
    sal:Number(q('#st_sal').value)||0
   });
  };
 }

 onAll('[data-del-staff]',async b=>{
  if(confirmDelete('Delete staff and all loan records?')){
   await apply(
    '/staff/'+encodeURIComponent(b.dataset.delStaff),
    'DELETE'
   );
  }
 });

 onAll('[data-view-staff]',b=>{
  expandedStaffId=
   expandedStaffId===b.dataset.viewStaff?'':b.dataset.viewStaff;

  editingLedgerId=null;
  renderMain();
 });

 onAll('[data-edit-ledger]',b=>{
  editingLedgerId=b.dataset.editLedger;
  renderMain();
 });

 if(q('#cancelLedgerEdit')){
  q('#cancelLedgerEdit').onclick=e=>{
   e.preventDefault();
   editingLedgerId=null;
   renderMain();
  };
 }

 if(q('#addLedger')){
  q('#addLedger').onclick=async()=>{
   const amount=Number(q('#ld_amt').value);

   if(!Number.isFinite(amount)||amount<=0){
    return alert('Enter a positive amount');
   }

   const body={
    staffId:q('#addLedger').dataset.staff,
    date:q('#ld_date').value,
    type:q('#ld_type').value,
    amount,
    note:q('#ld_note').value
   };

   const saved=await apply(
    editingLedgerId?
     '/staff-ledger/'+encodeURIComponent(editingLedgerId):
     '/staff-ledger',
    editingLedgerId?'PUT':'POST',
    body
   );

   if(saved){
    editingLedgerId=null;
    renderMain();
   }
  };
 }

 onAll('[data-del-ledger]',async b=>{
  if(confirmDelete('Delete staff ledger entry?')){
   await apply(
    '/staff-ledger/'+encodeURIComponent(b.dataset.delLedger),
    'DELETE'
   );
  }
 });

 // Settings
 if(q('#changePassword')){
  q('#changePassword').onclick=async()=>{
   const currentPassword=q('#pw_old').value;
   const newPassword=q('#pw_new').value;

   if(newPassword.length<12){
    return alert('New password must be at least 12 characters');
   }

   const changed=await apply(
    '/auth/change-password',
    'POST',
    {currentPassword,newPassword}
   );

   if(changed)alert('Password updated.');
  };
 }

 if(q('#exportBackup')){
  q('#exportBackup').onclick=()=>{
   window.location.href='/api/admin/export';
  };
 }

 if(q('#importBackup')){
  q('#importBackup').onclick=async()=>{
   const file=q('#importFile').files?.[0];

   if(!file)return alert('Select a JSON backup');

   if(file.size>5.5*1024*1024){
    return alert('Backup is too large');
   }

   if(!confirmDelete('Import only into an EMPTY database. Continue?')){
    return;
   }

   try{
    const payload=JSON.parse(await file.text());
    const result=await api('/admin/import',{
     method:'POST',
     body:payload
    });

    active='dashboard';
    renderNav();
    await refresh();

    alert(`Imported ${result.imported} records successfully.`);
   }catch(error){
    alert('Import failed: '+error.message);
   }
  };
 }
}

// ---------- PROFESSIONAL PRINT TEMPLATES ----------

function formatPrintNotes(value){
 const safe=esc(value||'').trim();
 return safe?
  safe.replace(/\n/g,'<br>'):
  '<span style="color:#6b7280">—</span>';
}

function renderPrintDocument(title,bodyHtml){
 const area=document.getElementById('printArea');

 area.innerHTML=`
 <style>
  @page{
   size:A4;
   margin:16mm;
  }

  .print-doc{
   font-family:Inter,Arial,sans-serif;
   color:#111827;
   background:#fff;
  }

  .print-header{
   display:flex;
   justify-content:space-between;
   align-items:flex-start;
   gap:18px;
   padding-bottom:18px;
   border-bottom:2px solid #e5e7eb;
   margin-bottom:20px;
  }

  .print-brand img{
   width:220px;
   max-width:100%;
   height:auto;
   border-radius:10px;
   border:1px solid #e5e7eb;
   background:#fff;
   padding:6px;
  }

  .print-brand small{
   display:block;
   margin-top:8px;
   color:#6b7280;
   font-size:12px;
   line-height:1.6;
  }

  .print-title{
   text-align:right;
  }

  .print-title h1{
   margin:0 0 6px;
   font-size:28px;
   color:#111827;
  }

  .print-title .meta{
   font-size:12px;
   color:#4b5563;
   line-height:1.7;
  }

  .print-grid{
   display:grid;
   grid-template-columns:1.15fr .85fr;
   gap:16px;
   margin:18px 0;
  }

  .print-card{
   border:1px solid #e5e7eb;
   border-radius:14px;
   padding:14px 16px;
   background:#f9fafb;
  }

  .print-card h3{
   margin:0 0 8px;
   font-size:12px;
   text-transform:uppercase;
   letter-spacing:.08em;
   color:#6b7280;
  }

  .print-card p{
   margin:0;
   line-height:1.7;
   font-size:13px;
  }

  .print-table{
   width:100%;
   border-collapse:collapse;
   margin-top:10px;
  }

  .print-table th,
  .print-table td{
   padding:11px 10px;
   border-bottom:1px solid #e5e7eb;
   font-size:13px;
   vertical-align:top;
  }

  .print-table th{
   text-align:left;
   background:#f3f4f6;
   color:#374151;
   font-size:11px;
   text-transform:uppercase;
  }

  .print-table .right{
   text-align:right;
  }

  .print-summary{
   margin-top:18px;
   margin-left:auto;
   width:340px;
   max-width:100%;
   border:1px solid #e5e7eb;
   border-radius:14px;
   overflow:hidden;
  }

  .print-summary .row{
   display:flex;
   justify-content:space-between;
   gap:12px;
   padding:10px 14px;
   border-bottom:1px solid #e5e7eb;
   background:#fff;
  }

  .print-summary .row:last-child{
   border-bottom:none;
   background:#eef2ff;
   font-weight:800;
  }

  .print-notes{
   margin-top:18px;
   border:1px solid #e5e7eb;
   border-radius:14px;
   padding:14px 16px;
  }

  .print-notes h3{
   margin:0 0 8px;
   font-size:12px;
   text-transform:uppercase;
   color:#6b7280;
  }

  .print-notes p{
   margin:0;
   font-size:13px;
   line-height:1.7;
  }

  .ledger-total{
   margin-top:18px;
   display:grid;
   grid-template-columns:repeat(3,minmax(0,1fr));
   gap:12px;
  }

  .ledger-total .tile{
   border:1px solid #e5e7eb;
   border-radius:14px;
   padding:12px 14px;
   background:#f9fafb;
  }

  .ledger-total .tile span{
   display:block;
   font-size:11px;
   color:#6b7280;
  }

  .ledger-total .tile strong{
   display:block;
   margin-top:8px;
   font-size:18px;
  }
 </style>

 <div class="print-doc">
  <div class="print-header">
   <div class="print-brand">
    <img src="/rohi-printers-logo.jpg" alt="Rohi Printers">

    <small>
     Faizan Block, Jampur Road,
     Opp. G.G.H.S. School,
     Kot Chutta, District Dera Ghazi Khan
     <br>
     0333-7366600
     <br>
     0345-7366600
    </small>
   </div>

   <div class="print-title">
    <h1>${title}</h1>
    <div class="meta">
     Printed on ${new Date().toLocaleString()}
     <br>
     Rohi Printers
    </div>
   </div>
  </div>

  ${bodyHtml}
 </div>`;

 window.print();
}

// ---------- INVOICE PRINT ----------

function printInvoice(inv){
 const customer=DB.customers.find(c=>c.id===inv.customerId);

 const previousBalance=previousBalanceForInvoice(inv);
 const subtotal=Number(inv.total||0)+Number(inv.discount||0);
 const discount=Number(inv.discount||0);
 const currentInvoice=Number(inv.total||0);

 const grandTotal=previousBalance+currentInvoice;

 const paidAtBilling=Number(inv.paidAmt||0);
 const ledgerReceived=Number(inv.ledgerPaidAmt||0);
 const received=paidAtBilling+ledgerReceived;

 const currentDue=invoiceDue(inv);
 const totalOutstanding=previousBalance+currentDue;

 const body=`
 <div class="print-grid">
  <div class="print-card">
   <h3>Bill To</h3>

   <p>
    <strong>${esc(customer?.name||'Walk-in Customer')}</strong>
    <br>
    Customer ID: ${esc(customer?.custId||'-')}
    <br>
    Phone: ${esc(customer?.phone||'-')}
    <br>
    Address: ${esc(customer?.addr||'-')}
   </p>
  </div>

  <div class="print-card">
   <h3>Invoice Details</h3>

   <p>
    <strong>Invoice #:</strong> ${esc(inv.no)}
    <br>
    <strong>Date:</strong> ${esc(inv.date)}
    <br>
    <strong>Status:</strong> ${invoiceStatus(inv)}
    <br>
    <strong>Items:</strong> ${inv.items.length}
   </p>
  </div>
 </div>

 <table class="print-table">
  <tr>
   <th style="width:46%">Description</th>
   <th>Qty</th>
   <th>Rate</th>
   <th class="right">Amount</th>
  </tr>

  ${inv.items.map(it=>`
   <tr>
    <td>${esc(it.desc)}</td>
    <td>${Number(it.sqft).toFixed(2)} ${esc(it.unit||'sqft')}</td>
    <td>${money(it.rate)}</td>
    <td class="right">${money(it.amount)}</td>
   </tr>
  `).join('')}
 </table>

 <div class="print-summary">
  <div class="row">
   <span>Subtotal</span>
   <strong>${money(subtotal)}</strong>
  </div>

  <div class="row">
   <span>Discount / Less</span>
   <strong>-${money(discount)}</strong>
  </div>

  <div class="row">
   <span>Previous Outstanding (Current)</span>
   <strong>${money(previousBalance)}</strong>
  </div>

  <div class="row">
   <span>Current Invoice (After Discount)</span>
   <strong>${money(currentInvoice)}</strong>
  </div>

  <div class="row">
   <span>Grand Total</span>
   <strong>${money(grandTotal)}</strong>
  </div>

  <div class="row">
   <span>Paid at Billing</span>
   <strong>${money(paidAtBilling)}</strong>
  </div>

  <div class="row">
   <span>Received in Ledger (Applied)</span>
   <strong>${money(ledgerReceived)}</strong>
  </div>

  <div class="row">
   <span>Total Received on This Invoice</span>
   <strong>${money(received)}</strong>
  </div>

  <div class="row">
   <span>Current Invoice Due</span>
   <strong>${money(currentDue)}</strong>
  </div>

  <div class="row">
   <span>Total Outstanding Through This Invoice</span>
   <strong>${money(totalOutstanding)}</strong>
  </div>
 </div>

 <div class="print-notes">
  <h3>Notes</h3>
  <p>${formatPrintNotes(inv.notes)}</p>
 </div>`;

 renderPrintDocument('Invoice',body);
}

// ---------- CUSTOMER LEDGER PRINT ----------

function printCustomerLedger(custId){
 const c=DB.customers.find(c=>c.id===custId);
 if(!c)return;

 const entries=customerLedgerEntries(custId);

 const totalDebit=entries.reduce((s,e)=>s+e.debit,0);
 const totalCredit=entries.reduce((s,e)=>s+e.credit,0);

 const body=`
 <div class="print-grid">
  <div class="print-card">
   <h3>Customer</h3>
   <p>
    <strong>${esc(c.name)}</strong>
    <br>
    Customer ID: ${esc(c.custId)}
    <br>
    Phone: ${esc(c.phone||'-')}
    <br>
    Address: ${esc(c.addr||'-')}
   </p>
  </div>

  <div class="print-card">
   <h3>Statement Info</h3>
   <p>
    <strong>Statement Type:</strong> Customer Ledger
    <br>
    <strong>Statement Date:</strong> ${today()}
    <br>
    <strong>Total Entries:</strong> ${entries.length}
    <br>
    <strong>Outstanding:</strong>
    ${money(totalDebit-totalCredit)}
   </p>
  </div>
 </div>

 <table class="print-table">
  <tr>
   <th>Date</th>
   <th>Type</th>
   <th>Reference</th>
   <th class="right">Debit</th>
   <th class="right">Credit</th>
   <th class="right">Balance</th>
  </tr>

  ${entries.map(e=>`
   <tr>
    <td>${esc(e.date)}</td>
    <td>${esc(e.type)}</td>
    <td>${esc(e.ref)}</td>
    <td class="right">${e.debit?money(e.debit):'-'}</td>
    <td class="right">${e.credit?money(e.credit):'-'}</td>
    <td class="right">${money(e.balance)}</td>
   </tr>
  `).join('')}
 </table>

 <div class="ledger-total">
  <div class="tile">
   <span>Total Billed</span>
   <strong>${money(totalDebit)}</strong>
  </div>
  <div class="tile">
   <span>Total Paid</span>
   <strong>${money(totalCredit)}</strong>
  </div>
  <div class="tile">
   <span>Outstanding</span>
   <strong>${money(totalDebit-totalCredit)}</strong>
  </div>
 </div>`;

 renderPrintDocument('Customer Ledger',body);
}

startup();
