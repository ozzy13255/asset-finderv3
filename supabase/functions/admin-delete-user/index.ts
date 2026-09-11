import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
Deno.serve(async(req)=>{ if(req.method==='OPTIONS') return new Response('ok',{headers:cors}); try{
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''); if(!token)return json({error:'Missing authorization'},401);
 const {data:{user:caller}}=await admin.auth.getUser(token); if(!caller)return json({error:'Unauthorized'},401);
 const {data:actor}=await admin.from('profiles').select('id,role,status').eq('id',caller.id).single();
 if(!actor||actor.status!=='active'||!['owner','patch_admin'].includes(actor.role))return json({error:'Admin access required'},403);
 const body=await req.json(); const targetUserId=String(body?.user_id||'').trim(); if(!targetUserId)return json({error:'user_id is required'},400); if(targetUserId===caller.id)return json({error:'You cannot delete your own account.'},400);
 const {data:target}=await admin.from('profiles').select('id,name,role,status').eq('id',targetUserId).single(); if(!target)return json({error:'User not found.'},404); if(target.role==='owner')return json({error:'Owner accounts cannot be deleted from this screen.'},403);
 if(actor.role==='patch_admin'){ if(target.role!=='user')return json({error:'Patch Admins can only delete Users.'},403); const {data:ap}=await admin.from('user_patches').select('patch_id').eq('user_id',actor.id); const patchIds=(ap||[]).map(r=>r.patch_id); const {data:shared}=await admin.from('user_patches').select('patch_id').eq('user_id',target.id).in('patch_id',patchIds).limit(1); if(!shared?.length)return json({error:'You can only delete Users in your own patch.'},403); }
 const {error}=await admin.auth.admin.deleteUser(target.id); if(error)return json({error:error.message},400); return json({ok:true,deleted_user_id:target.id,deleted_name:target.name,deleted_role:target.role});
 }catch(e){return json({error:e instanceof Error?e.message:'Unexpected error'},500)} })
