'use strict';
// Export from the previously supplied FlexShop LOCAL SQLite server.
// Node.js 22+ required. No npm packages needed for this migration tool.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const collections=['customers','invoices','inventory','jobs','expenses','staff','payments','staffLedger'];
const file=process.argv[2];
if(!file){console.error('Usage: node tools/export-sqlite.js "PATH_TO_OLD_DB/flexshop.sqlite"');process.exit(1);}
if(!fs.existsSync(file)){console.error('Cannot find SQLite file:',file);process.exit(1);}
let db;
try{
 db=new DatabaseSync(file,{readOnly:true});
 const data={};
 for(const name of collections){
  data[name]=db.prepare(`SELECT payload FROM "${name}" ORDER BY rowid`).all().map(row=>JSON.parse(row.payload));
 }
 const filename=path.resolve(process.cwd(),'flexshop-sqlite-export.json');
 fs.writeFileSync(filename,JSON.stringify({format:'flexshop-json-backup-v2',exportedAt:new Date().toISOString(),data},null,2));
 console.log('Export complete:',filename,'('+Object.values(data).reduce((n,rows)=>n+rows.length,0)+' records)');
 console.log('Keep this file private; import into an EMPTY PostgreSQL database from FlexShop Settings.');
}catch(error){console.error('Export failed:',error.message);process.exitCode=1;}
finally{db?.close();}
