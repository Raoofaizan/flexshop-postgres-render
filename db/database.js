'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {ApiError,text,number,date,id,choice,money,list}=require('./validation');
const {migrate}=require('./migrate');
const COLLECTIONS=['customers','invoices','inventory','jobs','expenses','staff','payments','staffLedger'];
const STATUSES=['Pending','Printing','Ready','Delivered'];
const TYPES=['roll','ink','accessory'];
const LEDGER_TYPES=['loan','advance','repayment'];
const newId=()=>crypto.randomUUID();
const dbURL=process.env.DATABASE_URL;
if (!dbURL) throw new Error('Missing DATABASE_URL. Copy .env.example to .env and configure a PostgreSQL database.');
// The Neon DATABASE_URL already contains sslmode=require; pg reads this parameter.
const pool=new Pool({connectionString:dbURL,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
pool.on('error',error=>console.error('PostgreSQL idle connection error:',error.message));

async function transaction(fn) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const value=await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {await client.query('ROLLBACK');} catch(e) {console.error('ROLLBACK failed:',e.message);}
    throw error;
  } finally {client.release();}
}
const query=(sql,params=[])=>pool.query(sql,params);

function hashPassword(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  const key=crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt$${salt}$${key}`;
}
function checkPassword(password,hash) {
  if (typeof password!=='string' || typeof hash!=='string') return false;
  const [method,salt,hex]=hash.split('$');
  if (method!=='scrypt' || !/^[a-f0-9]{32}$/i.test(salt||'') || !/^[a-f0-9]{128}$/i.test(hex||'')) return false;
  const candidate=crypto.scryptSync(password,salt,64);
  return crypto.timingSafeEqual(candidate,Buffer.from(hex,'hex'));
}
async function ensureAdmin() {
  const row=await query('SELECT COUNT(*)::int AS count FROM admins');
  if(row.rows[0].count) return;
  const email=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<12)
    throw new Error('First start: ADMIN_EMAIL must be an email and ADMIN_PASSWORD must have at least 12 characters.');
  await query('INSERT INTO admins(id,email,password_hash) VALUES ($1,$2,$3) ON CONFLICT(email) DO NOTHING',[newId(),email,hashPassword(password)]);
  console.log('Initial administrator account created for:',email);
}
async function init() {await migrate(pool);await ensureAdmin();}

async function getData(conn=pool) {
  const results=await Promise.all([
    conn.query('SELECT id,cust_id AS "custId",name,phone,addr FROM customers ORDER BY created_at,id'),
    conn.query('SELECT id,type,company,name,unit,roll_size::float8 AS "rollSize",qty::float8 AS qty,prate::float8 AS prate,srate::float8 AS srate FROM inventory ORDER BY created_at,id'),
    conn.query('SELECT id,no,customer_id AS "customerId",to_char(date,\'YYYY-MM-DD\') AS date,total::float8 AS total,paid_amt::float8 AS "paidAmt" FROM invoices ORDER BY created_at,id'),
    conn.query('SELECT invoice_id AS "invoiceId",line_position AS position,item_id AS "itemId",description AS "desc",quantity::float8 AS sqft,unit,rate::float8 AS rate,purchase_rate::float8 AS "purchaseRate",amount::float8 AS amount FROM invoice_items ORDER BY invoice_id,line_position'),
    conn.query('SELECT id,invoice_id AS "invId",description AS "desc",to_char(due_date,\'YYYY-MM-DD\') AS due,status FROM jobs ORDER BY created_at,id'),
    conn.query('SELECT id,to_char(date,\'YYYY-MM-DD\') AS date,category AS cat,amount::float8 AS amount FROM expenses ORDER BY created_at,id'),
    conn.query('SELECT id,name,role,salary::float8 AS sal FROM staff ORDER BY created_at,id'),
    conn.query('SELECT id,customer_id AS "customerId",to_char(date,\'YYYY-MM-DD\') AS date,amount::float8 AS amount,note FROM payments ORDER BY created_at,id'),
    conn.query('SELECT id,staff_id AS "staffId",to_char(date,\'YYYY-MM-DD\') AS date,type,amount::float8 AS amount,note FROM staff_ledger ORDER BY created_at,id')
  ]);
  const invoices=results[2].rows.map(row=>({...row,items:[]}));
  const invById=new Map(invoices.map(row=>[row.id,row]));
  for (const {invoiceId,position,...line} of results[3].rows) {
    const invoice=invById.get(invoiceId);
    if(invoice) invoice.items.push(line);
  }
  return {customers:results[0].rows,inventory:results[1].rows,invoices,
    jobs:results[4].rows,expenses:results[5].rows,staff:results[6].rows,
    payments:results[7].rows,staffLedger:results[8].rows};
}
async function createCustomer(body) {
  const name=text(body.name,'Customer name',150),phone=text(body.phone??'','Phone',80,{optional:true}),addr=text(body.addr??'','Address',500,{optional:true});
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(7712, 11)');
    const found=await client.query("SELECT COALESCE(MAX(SUBSTRING(cust_id FROM 2)::int),0)+1 AS num FROM customers WHERE cust_id ~ '^C[0-9]{1,9}$'");
    const custId='C'+String(found.rows[0].num).padStart(4,'0');
    const row={id:newId(),custId,name,phone,addr};
    await client.query('INSERT INTO customers(id,cust_id,name,phone,addr) VALUES($1,$2,$3,$4,$5)',[row.id,custId,name,phone,addr]);
    return row;
  });
}
async function deleteCustomer(customerId) {const r=await query('DELETE FROM customers WHERE id=$1',[id(customerId)]);if(!r.rowCount)throw new ApiError(404,'Customer not found');}

async function createInventory(body) {
  const type=choice(body.type,TYPES,'Item type'),company=text(body.company,'Company',120),name=text(body.name,'Item name',150);
  const unit=type==='roll'?'sqft':type==='ink'?'liter':text(body.unit,'Unit',25);
  const rollSize=type==='roll'?number(body.rollSize,'Roll size',{min:0.0001,max:1e8,positive:true}):1;
  const qty=number(body.qty,'Quantity',{max:1e9});
  const prate=number(body.prate,'Purchase rate',{max:1e8}),srate=number(body.srate,'Selling rate',{max:1e8});
  const item={id:newId(),type,company,name,unit,rollSize,qty,prate,srate};
  await query('INSERT INTO inventory(id,type,company,name,unit,roll_size,qty,prate,srate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(item));
  return item;
}
async function restockInventory(itemId,amount) {
  const delta=number(amount,'Restock quantity',{min:0.0001,max:1e8,positive:true});
  const r=await query("UPDATE inventory SET qty=qty + (CASE WHEN type='roll' THEN roll_size*$1 ELSE $1 END) WHERE id=$2 RETURNING id",[delta,id(itemId)]);
  if(!r.rowCount) throw new ApiError(404,'Inventory item not found');
}
async function deleteInventory(itemId) {const r=await query('DELETE FROM inventory WHERE id=$1',[id(itemId)]);if(!r.rowCount)throw new ApiError(404,'Inventory item not found');}

function validateInvoice(body) {
  if (!body || typeof body!=='object') throw new ApiError(400,'Invoice required');
  const no=text(body.no,'Invoice number',60);
  const customerId=id(body.customerId,'Customer ID');
  const dt=date(body.date);
  const paidAmt=money(number(body.paidAmt??0,'Amount paid',{max:1e10}));
  const items=list(body.items,'Invoice line items',80);
  if(!items.length) throw new ApiError(400,'Please add at least one line item');
  const lines=items.map(x=>({itemId:id(x.itemId,'Inventory item ID'),sqft:number(x.sqft,'Quantity',{min:0.0001,max:1e8,positive:true}),rate:number(x.rate,'Rate',{max:1e8})}));
  return {no,customerId,date:dt,paidAmt,items:lines};
}

async function saveInvoice(body,existingId=null) {
  const data=validateInvoice(body);
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(7712, 12)');
    const previous=existingId?await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE',[id(existingId)]):null;
    if(existingId && !previous.rowCount) throw new ApiError(404,'Invoice not found');
    const oldLines=existingId?(await client.query('SELECT item_id,quantity::float8 AS qty FROM invoice_items WHERE invoice_id=$1',[existingId])).rows:[];
    const materialIds=[...new Set([...data.items.map(x=>x.itemId),...oldLines.map(x=>x.item_id).filter(Boolean)])].sort();
    const materials=materialIds.length?(await client.query('SELECT id,company,name,unit,qty::float8 AS qty,prate::float8 AS prate FROM inventory WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[materialIds])).rows:[];
    const byId=new Map(materials.map(x=>[x.id,x]));
    const before=new Map(),after=new Map();
    for(const line of oldLines) if(line.item_id) before.set(line.item_id,(before.get(line.item_id)||0)+line.qty);
    for(const line of data.items) {
      if(!byId.has(line.itemId)) throw new ApiError(400,'An invoice item is no longer in inventory: '+line.itemId);
      after.set(line.itemId,(after.get(line.itemId)||0)+line.sqft);
    }
    for(const itemId of materialIds) {
      const material=byId.get(itemId);
      if(!material) continue;
      const available=material.qty+(before.get(itemId)||0);
      if((after.get(itemId)||0)>available+0.00001)
        throw new ApiError(409,`Insufficient stock for ${material.name}. Available ${available.toFixed(2)} ${material.unit}.`);
    }
    const rows=data.items.map(line=>{
      const item=byId.get(line.itemId);
      return {...line,description:item.company+' '+item.name,unit:item.unit,purchaseRate:item.prate,amount:money(line.sqft*line.rate)};
    });
    const total=money(rows.reduce((acc,line)=>acc+line.amount,0));
    if(total>1e10) throw new ApiError(400,'Invoice total exceeds allowed limit');
    if(data.paidAmt>total) throw new ApiError(400,'Amount paid cannot exceed invoice total');
    const invoiceId=existingId||newId();
    if(existingId) {
      await client.query('UPDATE invoices SET no=$1,customer_id=$2,date=$3,total=$4,paid_amt=$5 WHERE id=$6',[data.no,data.customerId,data.date,total,data.paidAmt,invoiceId]);
      await client.query('DELETE FROM invoice_items WHERE invoice_id=$1',[invoiceId]);
    } else {
      await client.query('INSERT INTO invoices(id,no,customer_id,date,total,paid_amt) VALUES($1,$2,$3,$4,$5,$6)',[invoiceId,data.no,data.customerId,data.date,total,data.paidAmt]);
    }
    for(const itemId of materialIds) {
      const difference=(before.get(itemId)||0)-(after.get(itemId)||0);
      if(Math.abs(difference)>0.00000001) await client.query('UPDATE inventory SET qty=qty+$1 WHERE id=$2',[difference,itemId]);
    }
    for(let index=0;index<rows.length;index++) {
      const line=rows[index];
      await client.query('INSERT INTO invoice_items(invoice_id,line_position,item_id,description,quantity,unit,rate,purchase_rate,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [invoiceId,index,line.itemId,line.description,line.sqft,line.unit,line.rate,line.purchaseRate,line.amount]);
    }
    return {id:invoiceId,total};
  });
}
async function deleteInvoice(invoiceId) {
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(7712, 12)');
    const invoice=await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE',[id(invoiceId)]);
    if(!invoice.rowCount) throw new ApiError(404,'Invoice not found');
    const lines=await client.query('SELECT item_id,quantity FROM invoice_items WHERE invoice_id=$1',[invoiceId]);
    for(const line of lines.rows) if(line.item_id) await client.query('UPDATE inventory SET qty=qty+$1 WHERE id=$2',[line.quantity,line.item_id]);
    await client.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
  });
}
async function createPayment(body) {
  const row={id:newId(),customerId:id(body.customerId,'Customer ID'),date:date(body.date),amount:money(number(body.amount,'Payment amount',{min:0.01,max:1e10,positive:true})),note:text(body.note??'','Note',500,{optional:true})};
  await query('INSERT INTO payments(id,customer_id,date,amount,note) VALUES($1,$2,$3,$4,$5)',Object.values(row));return row;
}
async function deletePayment(paymentId) {const r=await query('DELETE FROM payments WHERE id=$1',[id(paymentId)]);if(!r.rowCount)throw new ApiError(404,'Payment not found');}
async function createJob(body) {
  const invId=body.invId?id(body.invId,'Invoice ID'):null;
  const row={id:newId(),invId,desc:text(body.desc,'Job description',500),due:date(body.due,'Due date',true),status:'Pending'};
  await query('INSERT INTO jobs(id,invoice_id,description,due_date,status) VALUES($1,$2,$3,$4,$5)',Object.values(row));return row;
}
async function updateJobStatus(jobId,status) {
  choice(status,STATUSES,'Job status');const r=await query('UPDATE jobs SET status=$1 WHERE id=$2 RETURNING id',[status,id(jobId)]);
  if(!r.rowCount)throw new ApiError(404,'Job not found');
}
async function deleteJob(jobId) {const r=await query('DELETE FROM jobs WHERE id=$1',[id(jobId)]);if(!r.rowCount)throw new ApiError(404,'Job not found');}
async function createExpense(body) {
  const row={id:newId(),date:date(body.date),cat:text(body.cat,'Expense category',120),amount:money(number(body.amount,'Expense amount',{min:0.01,max:1e10,positive:true}))};
  await query('INSERT INTO expenses(id,date,category,amount) VALUES($1,$2,$3,$4)',Object.values(row));return row;
}
async function deleteExpense(expenseId) {const r=await query('DELETE FROM expenses WHERE id=$1',[id(expenseId)]);if(!r.rowCount)throw new ApiError(404,'Expense not found');}
async function createStaff(body) {
  const row={id:newId(),name:text(body.name,'Staff name',150),role:text(body.role??'','Role',150,{optional:true}),sal:money(number(body.sal,'Salary',{max:1e10}))};
  await query('INSERT INTO staff(id,name,role,salary) VALUES($1,$2,$3,$4)',Object.values(row));return row;
}
async function deleteStaff(staffId) {const r=await query('DELETE FROM staff WHERE id=$1',[id(staffId)]);if(!r.rowCount)throw new ApiError(404,'Staff not found');}
async function saveLedger(body,existingId=null) {
  const row={staffId:id(body.staffId,'Staff ID'),date:date(body.date),type:choice(body.type,LEDGER_TYPES,'Ledger entry type'),amount:money(number(body.amount,'Amount',{min:0.01,max:1e10,positive:true})),note:text(body.note??'','Note',500,{optional:true})};
  if(existingId) {
    const r=await query('UPDATE staff_ledger SET staff_id=$1,date=$2,type=$3,amount=$4,note=$5 WHERE id=$6 RETURNING id',[...Object.values(row),id(existingId)]);
    if(!r.rowCount)throw new ApiError(404,'Ledger entry not found');return {id:existingId,...row};
  }
  const result={id:newId(),...row};
  await query('INSERT INTO staff_ledger(id,staff_id,date,type,amount,note) VALUES($1,$2,$3,$4,$5,$6)',Object.values(result));
  return result;
}
async function deleteLedger(ledgerId) {const r=await query('DELETE FROM staff_ledger WHERE id=$1',[id(ledgerId)]);if(!r.rowCount)throw new ApiError(404,'Ledger entry not found');}

// One-time legacy import. Stock is already net of saved invoices in the old HTML app:
// never deduct it a second time during import. Only empty databases can be imported.
async function importLegacy(payload) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new ApiError(400,'Expected an exported FlexShop JSON object');
  const source=payload.data && typeof payload.data==='object'?payload.data:payload;
  const records={};
  for(const key of COLLECTIONS) records[key]=list(source[key]??[],'Import '+key,2500);
  const total=COLLECTIONS.reduce((sum,key)=>sum+records[key].length,0);
  if(total>5000)throw new ApiError(400,'Limit: 5,000 total records per import');
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(7712, 13)');
    const count=await client.query(`SELECT
      (SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM inventory)+
      (SELECT COUNT(*) FROM invoices)+(SELECT COUNT(*) FROM payments)+
      (SELECT COUNT(*) FROM jobs)+(SELECT COUNT(*) FROM expenses)+
      (SELECT COUNT(*) FROM staff)+(SELECT COUNT(*) FROM staff_ledger) AS count`);
    if(Number(count.rows[0].count)>0) throw new ApiError(409,'Import is allowed only into an empty database. Download a backup first.');
    const knownCustomers=new Set(),knownInventory=new Set(),knownInvoices=new Set(),knownStaff=new Set(),numbers=new Set();
    let nextCustomer=1;
    for(const c of records.customers) {
      const customerId=id(c.id),name=text(c.name,'Customer name',150);
      let code=typeof c.custId==='string' && /^C\d+$/.test(c.custId) && !numbers.has(c.custId)?c.custId:null;
      if(!code){while(numbers.has('C'+String(nextCustomer).padStart(4,'0')))nextCustomer++;code='C'+String(nextCustomer++).padStart(4,'0');}
      numbers.add(code);knownCustomers.add(customerId);
      await client.query('INSERT INTO customers(id,cust_id,name,phone,addr) VALUES($1,$2,$3,$4,$5)',[customerId,code,name,text(c.phone??'','Phone',80,{optional:true}),text(c.addr??'','Address',500,{optional:true})]);
    }
    for(const p of records.inventory) {
      const itemId=id(p.id),type=TYPES.includes(p.type)?p.type:'roll';
      const unit=type==='roll'?'sqft':type==='ink'?'liter':text(p.unit??'pcs','Unit',25);
      const rollSize=number(p.rollSize??1,'Roll size',{min:0.0001,max:1e8,positive:true});
      const qty=Number(p.qty??p.sqft??0);
      if(!Number.isFinite(qty) || Math.abs(qty)>1e9)throw new ApiError(400,'Invalid inventory stock for '+itemId);
      knownInventory.add(itemId);
      await client.query('INSERT INTO inventory(id,type,company,name,unit,roll_size,qty,prate,srate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [itemId,type,text(p.company??p.name??'Item','Company',120),text(p.name??'Item','Item name',150),unit,rollSize,qty,number(p.prate??0,'Purchase rate',{max:1e8}),number(p.srate??0,'Selling rate',{max:1e8})]);
    }
    for(const inv of records.invoices) {
      const invoiceId=id(inv.id),customerId=id(inv.customerId,'Invoice customer ID');
      if(!knownCustomers.has(customerId))throw new ApiError(400,'Invoice '+(inv.no||invoiceId)+' references a deleted/missing customer. Restore customer before importing.');
      const oldLines=list(inv.items,'Invoice items',80);if(!oldLines.length)throw new ApiError(400,'Invoice '+invoiceId+' has no lines');
      const lines=oldLines.map(line=>{
        const itemId=id(line.itemId,'Invoice item ID');
        if(!knownInventory.has(itemId))throw new ApiError(400,'Invoice '+invoiceId+' references a missing inventory item: '+itemId);
        const qty=number(line.sqft,'Item quantity',{min:0.0001,max:1e8,positive:true});
        const rate=number(line.rate??0,'Item rate',{max:1e8});
        return {itemId,qty,rate,amount:money(qty*rate),desc:text(line.desc??'Item','Description',500),unit:text(line.unit??'sqft','Unit',25),purchaseRate:number(line.purchaseRate??0,'Purchase rate',{max:1e8})};
      });
      const sum=money(lines.reduce((s,line)=>s+line.amount,0));
      const paid=number(inv.paidAmt??0,'Paid amount',{max:1e10});
      if(paid>sum)throw new ApiError(400,'Invoice '+invoiceId+' paid amount exceeds its total');
      await client.query('INSERT INTO invoices(id,no,customer_id,date,total,paid_amt) VALUES($1,$2,$3,$4,$5,$6)',[invoiceId,text(inv.no,'Invoice number',60),customerId,date(inv.date),sum,paid]);
      knownInvoices.add(invoiceId);
      for(let i=0;i<lines.length;i++){
        const l=lines[i];await client.query('INSERT INTO invoice_items(invoice_id,line_position,item_id,description,quantity,unit,rate,purchase_rate,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[invoiceId,i,l.itemId,l.desc,l.qty,l.unit,l.rate,l.purchaseRate,l.amount]);
      }
    }
    for(const p of records.payments) {
      if(!knownCustomers.has(p.customerId))throw new ApiError(400,'Payment references a missing customer');
      await client.query('INSERT INTO payments(id,customer_id,date,amount,note) VALUES($1,$2,$3,$4,$5)',[id(p.id),id(p.customerId),date(p.date),money(number(p.amount,'Payment amount',{min:0.01,max:1e10,positive:true})),text(p.note??'','Note',500,{optional:true})]);
    }
    for(const job of records.jobs) {
      const invId=job.invId && knownInvoices.has(job.invId)?job.invId:null;
      await client.query('INSERT INTO jobs(id,invoice_id,description,due_date,status) VALUES($1,$2,$3,$4,$5)',[id(job.id),invId,text(job.desc,'Job description',500),date(job.due,'Due date',true),choice(job.status??'Pending',STATUSES,'Job status')]);
    }
    for(const ex of records.expenses) {
      await client.query('INSERT INTO expenses(id,date,category,amount) VALUES($1,$2,$3,$4)',[id(ex.id),date(ex.date),text(ex.cat??'Misc','Category',120),money(number(ex.amount,'Expense amount',{max:1e10}))]);
    }
    for(const st of records.staff) {
      const staffId=id(st.id);knownStaff.add(staffId);
      await client.query('INSERT INTO staff(id,name,role,salary) VALUES($1,$2,$3,$4)',[staffId,text(st.name,'Staff name',150),text(st.role??'','Role',150,{optional:true}),money(number(st.sal??0,'Salary',{max:1e10}))]);
    }
    for(const ld of records.staffLedger) {
      if(!knownStaff.has(ld.staffId))throw new ApiError(400,'Staff loan entry references a missing staff member');
      await client.query('INSERT INTO staff_ledger(id,staff_id,date,type,amount,note) VALUES($1,$2,$3,$4,$5,$6)',[id(ld.id),id(ld.staffId),date(ld.date),choice(ld.type,LEDGER_TYPES,'Ledger type'),money(number(ld.amount,'Amount',{min:0.01,max:1e10,positive:true})),text(ld.note??'','Note',500,{optional:true})]);
    }
    return {imported:total};
  });
}
module.exports={pool,query,transaction,init,getData,hashPassword,checkPassword,createCustomer,deleteCustomer,
 createInventory,restockInventory,deleteInventory,saveInvoice,deleteInvoice,createPayment,deletePayment,
 createJob,updateJobStatus,deleteJob,createExpense,deleteExpense,createStaff,deleteStaff,
 saveLedger,deleteLedger,importLegacy};
