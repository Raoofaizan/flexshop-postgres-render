'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

// In-memory fake pg driver exercises transactional invoice logic without internet
// or any running PostgreSQL server. Real PostgreSQL integration still required.
const state={
 inventory:new Map([['mat-1',{id:'mat-1',company:'Brand',name:'Flex',unit:'sqft',qty:100,prate:10}]]),
 invoices:new Map(),lines:new Map()
};
const snapshot=()=>({inventory:new Map([...state.inventory].map(([k,v])=>[k,{...v}])),
 invoices:new Map([...state.invoices].map(([k,v])=>[k,{...v}])),
 lines:new Map([...state.lines].map(([k,v])=>[k,v.map(x=>({...x}))]))});
const restore=old=>{
 for(const name of ['inventory','invoices','lines'])state[name]=old[name];
};
class MockClient{
 async query(sql,p=[]){
  if(sql==='BEGIN'){this.before=snapshot();return {rows:[],rowCount:0};}
  if(sql==='ROLLBACK'){restore(this.before);return {rows:[],rowCount:0};}
  if(sql==='COMMIT'||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:0};
  if(sql.includes('FROM inventory WHERE id=ANY('))return {rows:p[0].filter(id=>state.inventory.has(id)).map(id=>({...state.inventory.get(id)})),rowCount:p[0].length};
  if(sql.startsWith('SELECT id FROM invoices WHERE id=')){
   const value=state.invoices.get(p[0]);return {rows:value?[value]:[],rowCount:value?1:0};
  }
  if(sql.startsWith('SELECT item_id,quantity::float8 AS qty FROM invoice_items')){
   const rows=(state.lines.get(p[0])||[]).map(x=>({item_id:x.item_id,qty:x.quantity}));return {rows,rowCount:rows.length};
  }
  if(sql.startsWith('SELECT item_id,quantity FROM invoice_items')){
   const rows=(state.lines.get(p[0])||[]).map(x=>({item_id:x.item_id,quantity:x.quantity}));return {rows,rowCount:rows.length};
  }
  if(sql.startsWith('INSERT INTO invoices(')){
   state.invoices.set(p[0],{id:p[0],no:p[1],customerId:p[2],date:p[3],total:p[4],paidAmt:p[5]});return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE invoices SET')){
   state.invoices.set(p[5],{id:p[5],no:p[0],customerId:p[1],date:p[2],total:p[3],paidAmt:p[4]});return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('DELETE FROM invoice_items')){state.lines.delete(p[0]);return {rowCount:1,rows:[]};}
  if(sql.startsWith('UPDATE inventory SET qty=qty+')){state.inventory.get(p[1]).qty+=Number(p[0]);return {rowCount:1,rows:[]};}
  if(sql.startsWith('INSERT INTO invoice_items')){
   const [invoiceId,position,itemId,description,quantity,unit,rate,purchaseRate,amount]=p;
   const rows=state.lines.get(invoiceId)||[];
   rows.push({item_id:itemId,description,quantity,unit,rate,purchaseRate,amount,position});
   state.lines.set(invoiceId,rows);return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('DELETE FROM invoices WHERE id=')){
   state.invoices.delete(p[0]);state.lines.delete(p[0]);return {rowCount:1,rows:[]};
  }
  throw new Error('Unexpected SQL in fake pg: '+sql.slice(0,90));
 }
 release(){}
}
class MockPool{
 async connect(){return new MockClient();}
 on(){}
}
const original=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='pg')return {Pool:MockPool};
 return original.apply(this,arguments);
};
process.env.DATABASE_URL='postgresql://test:test@localhost:5432/test';
const database=require('../db/database');
Module._load=original;
const form=(qty,paidAmt=0)=>({no:'INV-0001',customerId:'cust-1',date:'2026-11-04',paidAmt,
 items:[{itemId:'mat-1',sqft:qty,rate:25}]});

test('new invoice updates material stock once, edits restore old stock, deletion restores it',async()=>{
 const created=await database.saveInvoice(form(10,125));
 assert.equal(created.total,250);
 assert.equal(state.inventory.get('mat-1').qty,90);
 assert.equal(state.lines.get(created.id)[0].purchaseRate,10);
 const updated=await database.saveInvoice(form(20,125),created.id);
 assert.equal(updated.total,500);
 assert.equal(state.inventory.get('mat-1').qty,80,'edit must restore previously used 10 and subtract new 20');
 await database.deleteInvoice(created.id);
 assert.equal(state.inventory.get('mat-1').qty,100);
 assert.equal(state.invoices.size,0);
});
test('overselling rejects invoice without changing database state',async()=>{
 await assert.rejects(database.saveInvoice(form(101)),error=>error.status===409&&/Insufficient stock/.test(error.message));
 assert.equal(state.inventory.get('mat-1').qty,100);
 assert.equal(state.invoices.size,0);
});
test('cannot pay more than invoice total and cannot save negative item rates',async()=>{
 await assert.rejects(database.saveInvoice(form(2,51)),error=>error.status===400);
 await assert.rejects(database.saveInvoice({...form(1),items:[{itemId:'mat-1',sqft:1,rate:-1}]}),error=>error.status===400);
 assert.equal(state.inventory.get('mat-1').qty,100);
});
test('passwords are salted and only valid passwords compare',()=>{
 const hash=database.hashPassword('correct-horse-battery');
 assert.ok(hash.startsWith('scrypt$'));
 assert.equal(database.checkPassword('correct-horse-battery',hash),true);
 assert.equal(database.checkPassword('different',hash),false);
 assert.equal(database.checkPassword('irrelevant','not-a-valid-hash'),false);
});
