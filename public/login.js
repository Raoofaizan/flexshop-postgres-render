'use strict';
const form=document.getElementById('loginForm');
const button=document.getElementById('loginButton');
const errorElement=document.getElementById('loginError');
fetch('/api/auth/me',{credentials:'same-origin'}).then(res=>{
 if(res.ok)location.replace('/');
}).catch(()=>{});
form.addEventListener('submit',async event=>{
 event.preventDefault();
 button.disabled=true;button.textContent='Signing in...';errorElement.textContent='';
 try {
  const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
   body:JSON.stringify({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Login unsuccessful');
  location.replace('/');
 }catch(error){errorElement.textContent=error.message;button.disabled=false;button.textContent='Sign in';}
});
