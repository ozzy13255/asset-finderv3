import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const synthetic=(c:string)=>`${String(c||"").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"")}@assetfinder.invalid`;

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,serviceKey);
    const body=await req.json().catch(()=>({}));
    const action=body?.action;

    if(action==="resolve_login"){
      const code=String(body?.login_code||"").trim();
      if(!code)return json({error:"Login code is required."},400);
      const {data:profile,error}=await admin.from("profiles").select("id,recovery_email,status").eq("login_code",code).maybeSingle();
      if(error) return json({error:error.message},500);
      if(!profile || profile.status!=="active") return json({error:"Invalid login code or account unavailable."},404);
      return json({email:profile.recovery_email||synthetic(code)});
    }

    if(action==="send_reset"){
      const code=String(body?.login_code||"").trim();
      const redirect=String(body?.redirect_to||"").trim();
      if(!code)return json({error:"Login code is required."},400);
      const {data:profile,error}=await admin.from("profiles").select("id,recovery_email,status").eq("login_code",code).maybeSingle();
      if(error) return json({error:error.message},500);
      if(!profile || profile.status!=="active") return json({error:"Invalid login code or account unavailable."},404);
      if(!profile.recovery_email)return json({error:"No recovery email is set for this account. Ask the user to add one in Profile first."},400);
      const {error:resetError}=await admin.auth.resetPasswordForEmail(profile.recovery_email,{redirectTo:redirect||undefined});
      if(resetError)return json({error:resetError.message},400);
      return json({ok:true});
    }

    if(action==="set_recovery_email"){
      const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
      if(!token)return json({error:"Missing authorization."},401);
      const {data:{user:caller}}=await admin.auth.getUser(token);
      if(!caller)return json({error:"Unauthorized."},401);
      const email=String(body?.email||"").trim().toLowerCase();
      if(!email || !/^\S+@\S+\.\S+$/.test(email))return json({error:"Please provide a valid recovery email address."},400);
      const {error:updateAuthError}=await admin.auth.admin.updateUserById(caller.id,{email,email_confirm:true});
      if(updateAuthError)return json({error:updateAuthError.message},400);
      const {error:profileError}=await admin.from("profiles").update({recovery_email:email}).eq("id",caller.id);
      if(profileError)return json({error:profileError.message},400);
      return json({ok:true,email});
    }

    return json({error:"Unknown recovery action."},400);
  }catch(e){return json({error:e?.message||"Unexpected error."},500)}
});
