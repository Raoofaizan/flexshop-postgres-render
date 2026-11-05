'use strict';
require('dotenv').config();
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const helmet=require('helmet');
const cookieParser=require('cookie-parser');
const {rateLimit}=require('express-rate-limit');
const db=require('./db/database');
const {ApiError,text}=require('./db/validation');

const app=express();
const PORT=Number(process.env.PORT||3000);
const isProduction=process.env.NODE_ENV==='production';
const SESSION_COOKIE='flexshop_session';
const SESSION_DAYS=7;
app.set('trust proxy',isProduction?1:false);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],scriptSrc:["'self'"],
    styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
    fontSrc:["'self'","https://fonts.gstatic.com","data:"],
    imgSrc:["'self'","data:"],connectSrc:["'self'"],
    frameAncestors:["'none'"],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"]
  }},
  crossOriginEmbedderPolicy:false
}));
app.use(express.json({limit:'6mb'}));
app.use(cookieParser());
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});

// CSRF defense: writes require a custom header, a same-origin browser request,
// and a session cookie (except initial login). No CORS middleware is enabled.
app.use('/api',(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  if(req.get('X-Requested-With')!=='XMLHttpRequest')return res.status(403).json({error:'Invalid request origin'});
  const origin=req.get('Origin');
  if(origin){
    try {
      const source=new URL(origin);
      if(source.host!==req.get('host') || source.protocol!==req.protocol+':')return res.status(403).json({error:'Cross-site requests are not allowed'});
    } catch {return res.status(403).json({error:'Invalid Origin header'});}
  }
  next();
});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const sessionHash=token=>crypto.createHash('sha256').update(token).digest('hex');
const cookieOptions={httpOnly:true,sameSite:'lax',secure:isProduction,path:'/',maxAge:SESSION_DAYS*24*60*60*1000};
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again in 15 minutes.'}});

app.get('/api/health',asyncRoute(async(req,res)=>{
  await db.query('SELECT 1');
  res.json({status:'ok'});
}));
app.post('/api/auth/login',loginLimiter,asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=req.body?.password;
  if(!email || typeof password!=='string'||password.length>512)throw new ApiError(401,'Incorrect email or password');
  const r=await db.query('SELECT id,email,password_hash FROM admins WHERE email=$1',[email]);
  // Always do a costly comparison to make unknown emails harder to distinguish.
  const fallback='scrypt$00000000000000000000000000000000$'+('0'.repeat(128));
  const valid=db.checkPassword(password,r.rows[0]?.password_hash||fallback);
  if(!r.rowCount||!valid)throw new ApiError(401,'Incorrect email or password');
  const token=crypto.randomBytes(32).toString('base64url');
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')',[sessionHash(token),r.rows[0].id]);
  res.cookie(SESSION_COOKIE,token,cookieOptions).json({ok:true,email:r.rows[0].email});
}));
async function requireAuth(req,res,next){
  try {
    const token=req.cookies?.[SESSION_COOKIE];
    if(typeof token!=='string'||token.length<30)return res.status(401).json({error:'Please log in'});
    const found=await db.query('SELECT a.id,a.email FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now()',[sessionHash(token)]);
    if(!found.rowCount)return res.status(401).json({error:'Session expired. Please log in again'});
    req.admin=found.rows[0];req.sessionHash=sessionHash(token);
    next();
  } catch(e){next(e);}
}
app.use('/api',requireAuth);
app.get('/api/auth/me',(req,res)=>res.json({email:req.admin.email}));
app.post('/api/auth/logout',asyncRoute(async(req,res)=>{
  await db.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);
  res.clearCookie(SESSION_COOKIE,{path:'/',sameSite:'lax',secure:isProduction}).json({ok:true});
}));
app.post('/api/auth/change-password',asyncRoute(async(req,res)=>{
  const current=req.body?.currentPassword,newPassword=req.body?.newPassword;
  if(typeof current!=='string'||typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256)
    throw new ApiError(400,'New password must be 12–256 characters');
  const found=await db.query('SELECT password_hash FROM admins WHERE id=$1',[req.admin.id]);
  if(!found.rowCount||!db.checkPassword(current,found.rows[0].password_hash))throw new ApiError(401,'Current password is incorrect');
  await db.transaction(async client=>{
    await client.query('UPDATE admins SET password_hash=$1 WHERE id=$2',[db.hashPassword(newPassword),req.admin.id]);
    await client.query('DELETE FROM sessions WHERE admin_id=$1 AND token_hash<>$2',[req.admin.id,req.sessionHash]);
  });
  res.json({ok:true});
}));

app.get('/api/bootstrap',asyncRoute(async(req,res)=>res.json(await db.getData())));
app.post('/api/customers',asyncRoute(async(req,res)=>res.status(201).json(await db.createCustomer(req.body||{}))));
app.delete('/api/customers/:id',asyncRoute(async(req,res)=>{await db.deleteCustomer(req.params.id);res.json({ok:true});}));
app.post('/api/inventory',asyncRoute(async(req,res)=>res.status(201).json(await db.createInventory(req.body||{}))));
app.patch('/api/inventory/:id/restock',asyncRoute(async(req,res)=>{await db.restockInventory(req.params.id,req.body?.quantity);res.json({ok:true});}));
app.delete('/api/inventory/:id',asyncRoute(async(req,res)=>{await db.deleteInventory(req.params.id);res.json({ok:true});}));
app.post('/api/invoices',asyncRoute(async(req,res)=>res.status(201).json(await db.saveInvoice(req.body||{}))));
app.put('/api/invoices/:id',asyncRoute(async(req,res)=>res.json(await db.saveInvoice(req.body||{},req.params.id))));
app.delete('/api/invoices/:id',asyncRoute(async(req,res)=>{await db.deleteInvoice(req.params.id);res.json({ok:true});}));
app.post('/api/payments',asyncRoute(async(req,res)=>res.status(201).json(await db.createPayment(req.body||{}))));
app.delete('/api/payments/:id',asyncRoute(async(req,res)=>{await db.deletePayment(req.params.id);res.json({ok:true});}));
app.post('/api/jobs',asyncRoute(async(req,res)=>res.status(201).json(await db.createJob(req.body||{}))));
app.patch('/api/jobs/:id/status',asyncRoute(async(req,res)=>{await db.updateJobStatus(req.params.id,req.body?.status);res.json({ok:true});}));
app.delete('/api/jobs/:id',asyncRoute(async(req,res)=>{await db.deleteJob(req.params.id);res.json({ok:true});}));
app.post('/api/expenses',asyncRoute(async(req,res)=>res.status(201).json(await db.createExpense(req.body||{}))));
app.delete('/api/expenses/:id',asyncRoute(async(req,res)=>{await db.deleteExpense(req.params.id);res.json({ok:true});}));
app.post('/api/staff',asyncRoute(async(req,res)=>res.status(201).json(await db.createStaff(req.body||{}))));
app.delete('/api/staff/:id',asyncRoute(async(req,res)=>{await db.deleteStaff(req.params.id);res.json({ok:true});}));
app.post('/api/staff-ledger',asyncRoute(async(req,res)=>res.status(201).json(await db.saveLedger(req.body||{}))));
app.put('/api/staff-ledger/:id',asyncRoute(async(req,res)=>res.json(await db.saveLedger(req.body||{},req.params.id))));
app.delete('/api/staff-ledger/:id',asyncRoute(async(req,res)=>{await db.deleteLedger(req.params.id);res.json({ok:true});}));
app.get('/api/admin/export',asyncRoute(async(req,res)=>{
  const data=await db.getData();
  const filename='flexshop-backup-'+new Date().toISOString().slice(0,10)+'.json';
  res.set('Content-Disposition',`attachment; filename="${filename}"`);
  res.set('Content-Type','application/json; charset=utf-8');
  res.send(JSON.stringify({format:'flexshop-json-backup-v2',exportedAt:new Date().toISOString(),data},null,2));
}));
app.post('/api/admin/import',asyncRoute(async(req,res)=>res.json(await db.importLegacy(req.body))));

// HTML, styles and scripts are public. Business data is never embedded in files;
// protected APIs require the administrator's HttpOnly session cookie.
app.use(express.static(path.join(__dirname,'public'),{setHeaders(res,file){
  if(file.endsWith('.html'))res.setHeader('Cache-Control','no-store');
}}));
app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found'}));
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err.type==='entity.too.large')return res.status(413).json({error:'Import file is too large'});
  if(err instanceof SyntaxError && 'body' in err)return res.status(400).json({error:'Invalid JSON'});
  if(err instanceof ApiError)return res.status(err.status).json({error:err.message});
  if(err.code==='23505')return res.status(409).json({error:'A record with this number or ID already exists'});
  if(err.code==='23503')return res.status(409).json({error:'Record is linked to other data and cannot be deleted or changed'});
  if(err.code==='23514'||err.code==='22003')return res.status(400).json({error:'Value is outside permitted range'});
  console.error('Unexpected server error:',err);
  res.status(500).json({error:'Server or database error. Check the server logs.'});
});

async function start(){
  await db.init();
  const server=app.listen(PORT,'0.0.0.0',()=>console.log(`FlexShop Manager running on port ${PORT}`));
  async function shutdown(){server.close();await db.pool.end();}
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module)start().catch(error=>{console.error('Startup failed:',error);process.exit(1);});
module.exports={app,start};
