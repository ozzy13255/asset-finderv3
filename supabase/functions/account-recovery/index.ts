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
      const code=String(body?.login_code||"").trim(); if(!code)return json({error:"Email address is required."},400);
      const {data:p,error}=await admin.from("profiles").select("id,status,login_code,recovery_email").eq("login_code",code).maybeSingle();
      if(error)return json({error:error.message},500); if(!p||p.status!=="active")return json({error:"Account unavailable."},404);
      const {data:u,error:ue}=await admin.auth.admin.getUserById(p.id); if(ue||!u.user)return json({error:"Account authentication record not found."},404);
      return json({email:u.user.email||p.login_code});
    }
    if(action==="send_reset"){
      const supplied=String(body?.login_code||"").trim().toLowerCase(); const redirect=String(body?.redirect_to||"").trim();
      if(!supplied)return json({error:"Email address is required."},400);
      let email=supplied;
      if(!emailRe.test(email)){
        const {data:p,error}=await admin.from("profiles").select("id,status,recovery_email,login_code").eq("login_code",supplied).maybeSingle();
        if(error)return json({error:error.message},500); if(!p||p.status!=="active")return json({error:"Account unavailable."},404);
        email=p.recovery_email||p.login_code;
      }
      if(!emailRe.test(email))return json({error:"A valid login & recovery email is required."},400);
      const {error:re}=await admin.auth.resetPasswordForEmail(email,{redirectTo:redirect||undefined}); if(re)return json({error:re.message},400);
      return json({ok:true});
    }
    if(action==="set_recovery_email"){
      const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,""); if(!token)return json({error:"Missing authorization."},401);
      const {data:{user:caller}}=await admin.auth.getUser(token); if(!caller)return json({error:"Unauthorized."},401);
      const email=String(body?.email||"").trim().toLowerCase(); if(!emailRe.test(email))return json({error:"Please provide a valid email address."},400);
      const {error:ae}=await admin.auth.admin.updateUserById(caller.id,{email,email_confirm:true}); if(ae)return json({error:ae.message},400);
      const {error:pe}=await admin.from("profiles").update({recovery_email:email,login_code:email}).eq("id",caller.id); if(pe)return json({error:pe.message},400);
      return json({ok:true,email});
    }
    return json({error:"Unknown recovery action."},400);
  }catch(e){return json({error:e?.message||"Unexpected error."},500)}
});
