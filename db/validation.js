'use strict';
class ApiError extends Error {
  constructor(status,message) { super(message); this.status = status; }
}
function text(value,field,max=200,{optional=false}={}) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') throw new ApiError(400,field+' must be text');
  const str = value.trim();
  if ((!optional && !str) || str.length>max) throw new ApiError(400,field+' is required or too long (max '+max+')');
  return str;
}
function number(value,field,{min=0,max=1e10,positive=false}={}) {
  if (typeof value==='boolean' || value===null || value===undefined || value==='') throw new ApiError(400,field+' must be a number');
  const n=Number(value);
  if (!Number.isFinite(n) || n<min || n>max || (positive && n<=0)) throw new ApiError(400,field+' is invalid');
  return n;
}
function date(value,field='Date',optional=false) {
  if ((value==='' || value===null || value===undefined) && optional) return null;
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400,field+' must be YYYY-MM-DD');
  const dt=new Date(value+'T00:00:00Z');
  if (!Number.isFinite(dt.getTime()) || dt.toISOString().slice(0,10)!==value) throw new ApiError(400,field+' is invalid');
  return value;
}
function id(value,field='ID') { return text(value,field,128); }
function choice(value,allowed,field) { if (!allowed.includes(value)) throw new ApiError(400,field+' is invalid'); return value; }
function money(value) { return Math.round((Number(value)+Number.EPSILON)*100)/100; }
function list(value,field,max=1000) {
  if (!Array.isArray(value) || value.length>max) throw new ApiError(400,field+' must be a list with at most '+max+' entries');
  return value;
}
module.exports={ApiError,text,number,date,id,choice,money,list};
