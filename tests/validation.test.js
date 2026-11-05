'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const v=require('../db/validation');
test('validates calendar dates, including leap years',()=>{
 assert.equal(v.date('2024-02-29'),'2024-02-29');
 assert.throws(()=>v.date('2025-02-29'),/invalid/);
 assert.throws(()=>v.date('2026-13-01'),/invalid/);
 assert.throws(()=>v.date('07-01-2026'),/YYYY-MM-DD/);
});
test('rejects invalid business amounts and negative stock inputs',()=>{
 assert.equal(v.number('30.25','Amount'),30.25);
 assert.throws(()=>v.number(-5,'Price'),/invalid/);
 assert.throws(()=>v.number('Infinity','Price'),/invalid/);
 assert.throws(()=>v.number('', 'Price'),/number/);
 assert.throws(()=>v.number(0,'Payment',{positive:true}),/invalid/);
});
test('rejects empty or overly long required text and invalid enumerations',()=>{
 assert.throws(()=>v.text('', 'Customer'),/required/);
 assert.throws(()=>v.text('a'.repeat(151),'Customer',150),/too long/);
 assert.equal(v.text('  Name  ','Customer'),'Name');
 assert.throws(()=>v.choice('Unknown',['roll','ink'],'Type'),/invalid/);
});
