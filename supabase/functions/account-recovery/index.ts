import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const emailRe=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body=await req.json().catch(()=>({})); const action=String(body?.action||"");
    if(action==="resolve_login"){
      const code=String(body?.login_code||"").trim().toLowerCase(); if(!code)return json({error:"Email address is required."},400);
      const {data:p,error}=await admin.from("profiles").select("id,status,login_code,recovery_email").ilike("login_code",code).maybeSingle();
      if(error)return json({error:error.message},500); if(!p||p.status!=="active")return json({error:"Account unavailable."},404);
      const {data:u,error:ue}=await admin.auth.admin.getUserById(p.id); if(ue||!u.user)return json({error:"Account authentication record not found."},404);
      return json({email:u.user.email||p.recovery_email||p.login_code});
    }
    if(action==="send_reset"){
      const supplied=String(body?.login_code||"").trim().toLowerCase(); const redirect=String(body?.redirect_to||"").trim();
      if(!supplied)return json({error:"Email address is required."},400);
      let email=supplied;
      if(!emailRe.test(email)){
        const {data:p,error}=await admin.from("profiles").select("id,status,recovery_email,login_code").ilike("login_code",supplied).maybeSingle();
        if(error)return json({error:error.message},500); if(!p||p.status!=="active")return json({error:"Account unavailable."},404);
        email=String(p.recovery_email||p.login_code||"").trim().toLowerCase();
      }
      if(!emailRe.test(email))return json({error:"A valid login & recovery email is required."},400);
      if(redirect){ const first=await admin.auth.resetPasswordForEmail(email,{redirectTo:redirect}); if(!first.error)return json({ok:true}); }
      const retry=await admin.auth.resetPasswordForEmail(email); if(retry.error)return json({error:retry.error.message},400);
      return json({ok:true,email});
    }
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,""); if(!token)return json({error:"Missing authorization."},401);
    const {data:{user:caller}}=await admin.auth.getUser(token); if(!caller)return json({error:"Unauthorized."},401);
    const {data:actor}=await admin.from("profiles").select("id,role,status").eq("id",caller.id).maybeSingle();
    if(!actor||actor.status!=="active")return json({error:"Active account required."},403);
    if(action==="set_recovery_email"){
      const email=String(body?.email||"").trim().toLowerCase(); if(!emailRe.test(email))return json({error:"Please provide a valid email address."},400);
      const {error:ae}=await admin.auth.admin.updateUserById(caller.id,{email,email_confirm:true}); if(ae)return json({error:ae.message},400);
      const {error:pe}=await admin.from("profiles").update({recovery_email:email,login_code:email}).eq("id",caller.id); if(pe)return json({error:pe.message},400);
      return json({ok:true,email});
    }
    if(action==="set_user_email"){
      if(actor.role!=="owner")return json({error:"Only the Owner can change another user's email."},403);
      const userId=String(body?.user_id||"").trim(); const email=String(body?.email||"").trim().toLowerCase();
      if(!userId||!emailRe.test(email))return json({error:"User ID and a valid email address are required."},400);
      if(userId===caller.id)return json({error:"Use your Profile page to change your own email."},400);
      const {data:target}=await admin.from("profiles").select("id,status").eq("id",userId).maybeSingle(); if(!target)return json({error:"User not found."},404);
      const {error:ae}=await admin.auth.admin.updateUserById(userId,{email,email_confirm:true}); if(ae)return json({error:ae.message},400);
      const {error:pe}=await admin.from("profiles").update({recovery_email:email,login_code:email}).eq("id",userId); if(pe)return json({error:pe.message},400);
      return json({ok:true,user_id:userId,email});
    }
    return json({error:"Unknown recovery action."},400);
  }catch(e){return json({error:e instanceof Error?e.message:"Unexpected error."},500)}
});
