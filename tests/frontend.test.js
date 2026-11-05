'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const appFile=path.join(__dirname,'../public/app.js');
const context=vm.createContext({
 document:{getElementById:()=>({textContent:'test@example.com'})},
 console,Date,Intl,Map,Set,URL,Math,Number,String,Array,JSON
});
const source=fs.readFileSync(appFile,'utf8').replace(/\bstartup\(\);\s*$/,'');
vm.runInContext(source,context,{filename:appFile});

test('untrusted customer names, phones and expense labels are HTML-escaped',()=>{
 vm.runInContext(`DB.customers=[{id:'c1',custId:'C0001',name:'<img src=x onerror=alert(1)>',phone:'" onfocus="malicious',addr:'<script>x</script>'}];
 DB.expenses=[{id:'ex',date:'2026-11-04',cat:'<svg onload=alert(1)>',amount:5}];`,context);
 const customerHtml=vm.runInContext('viewCustomers()',context);
 const reportHtml=vm.runInContext('viewReports()',context);
 assert.ok(customerHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.ok(!customerHtml.includes('<img src=x onerror'));
 assert.ok(customerHtml.includes('&quot; onfocus=&quot;malicious'));
 assert.ok(reportHtml.includes('&lt;svg onload=alert(1)&gt;'));
});
test('opening and clearing invoice draft does not mutate stock in browser',()=>{
 vm.runInContext("DB.inventory=[{id:'mat',type:'roll',company:'A',name:'B',unit:'sqft',qty:100,rollSize:100,prate:1,srate:2}];draftItems=[];clearInvoiceDraft();",context);
 assert.equal(vm.runInContext('DB.inventory[0].qty',context),100);
});
