import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}})
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
 try{
  const secret=req.headers.get('x-bootstrap-secret'); if(!secret||secret!==Deno.env.get('BOOTSTRAP_SECRET')) return json({error:'Forbidden'},403)
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const b=await req.json(); const {name,employee_number,login_code,password}=b
  if(!name||!employee_number||!login_code||!password) return json({error:'name, employee_number, login_code and password are required'},400)
  const email=`${String(login_code).trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')}@assetfinder.invalid`
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true})
  if(error) return json({error:error.message},400)
  const {error:pErr}=await admin.from('profiles').insert({id:data.user.id,name,employee_number,login_code,role:'owner',status:'active',must_change_password:false})
  if(pErr){await admin.auth.admin.deleteUser(data.user.id);return json({error:pErr.message},400)}
  return json({id:data.user.id,role:'owner',login_code})
 }catch(e){return json({error:e?.message||'Unexpected error'},500)}
})
