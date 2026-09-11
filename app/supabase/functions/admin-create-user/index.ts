import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  try {
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(supabaseUrl,serviceKey)
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
    if(!token) return json({error:'Missing authorization'},401)
    const {data:{user:caller}}=await admin.auth.getUser(token)
    if(!caller) return json({error:'Unauthorized'},401)
    const {data:actor}=await admin.from('profiles').select('id,role,status').eq('id',caller.id).single()
    if(!actor || actor.status!=='active' || !['owner','patch_admin'].includes(actor.role)) return json({error:'Admin access required'},403)

    const body=await req.json()
    const {name,employee_number,login_code,password,role='user',patch_id}=body
    if(!name||!employee_number||!login_code||!password||!patch_id) return json({error:'name, employee_number, login_code, password and patch_id are required'},400)
    if(password.length<10) return json({error:'Temporary password must be at least 10 characters'},400)
    if(actor.role==='patch_admin') {
      if(role!=='user') return json({error:'Patch admins can only create users, not owners or other patch admins'},403)
      const {data:assignment}=await admin.from('user_patches').select('patch_id').eq('user_id',actor.id).eq('patch_id',patch_id).maybeSingle()
      if(!assignment) return json({error:'You can only create users in your own patch'},403)
    }

    const syntheticEmail=`${String(login_code).trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')}@assetfinder.invalid`
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:syntheticEmail,password,email_confirm:true})
    if(createError) return json({error:createError.message},400)

    const userRole=actor.role==='owner'?role:'user'
    const {error:profileError}=await admin.from('profiles').insert({id:created.user.id,name,employee_number,login_code,role:userRole,status:'active',must_change_password:true})
    if(profileError){ await admin.auth.admin.deleteUser(created.user.id); return json({error:profileError.message},400) }
    const {error:assignmentError}=await admin.from('user_patches').insert({user_id:created.user.id,patch_id})
    if(assignmentError){ await admin.from('profiles').delete().eq('id',created.user.id); await admin.auth.admin.deleteUser(created.user.id); return json({error:assignmentError.message},400) }
    return json({id:created.user.id,name,employee_number,login_code,role:userRole,patch_id})
  } catch(e) { return json({error:e?.message||'Unexpected error'},500) }
})
