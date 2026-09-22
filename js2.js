(() => {
  'use strict';

  const C = window.ASSET_FINDER_CLOUD || {};
  const API = String(C.supabaseUrl || '').replace(/\/$/, '');
  const ANON = String(C.supabaseAnonKey || '');
  const APP_VERSION = '3.10.0';
  const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobileLayout = () => window.innerWidth <= 700;
  document.documentElement.classList.toggle('af-ios', IS_IOS);
  document.documentElement.classList.toggle('af-other', !IS_IOS);
  const state = {
    session: null,
    user: null,
    profile: null,
    patches: [],
    inventories: new Map(),
    users: [],
    assignments: [],
    approvals: [],
    removalRequests: [],
    flyTipReports: [],
    scrapReports: [],
    currentPatchId: null,
    currentView: 'home',
    adminSubView: 'admin',
    search: { q: '', mode: 'all', assetType: '' },
    loading: false,
    appMeta: { latestVersion: null, lastSyncedAt: null, serverOk: false },
    approvalBaselineReady: false,
    pendingApprovalIds: new Set(),
    pendingRemovalIds: new Set(),
    pendingFlyTipIds: new Set(),
    pendingScrapIds: new Set(),
    popupTimer: null,
    af340MenuClickBound: false,
  };

  const $ = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const now = () => new Date().toISOString();
  const isAdmin = () => ['owner','patch_admin'].includes(state.profile?.role);
  const isOwner = () => state.profile?.role === 'owner';
  const roleLabel = r => r === 'owner' ? 'Owner' : r === 'patch_admin' ? 'Patch Admin' : 'User';
  const profileFor = id => state.users.find(u=>String(u.id)===String(id));
  const personName = (id, fallback='Unknown user') => profileFor(id)?.name || fallback;
  const personLabel = (id, fallback='Unknown user') => { const u=profileFor(id); return u ? `${u.name}${u.employee_number?` · ${u.employee_number}`:''}` : fallback; };
  const canEditInventory = patchId => isOwner() || (state.profile?.role === 'patch_admin' && state.patches.some(p => p.id === patchId));
  const apiHeaders = (json=false) => {
    const h = { apikey: ANON };
    if (state.session?.access_token) h.Authorization = `Bearer ${state.session.access_token}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  };

  function requireOnline() {
    if (!API || !ANON) throw new Error('Asset Finder is not configured for its central database.');
  }

  let authRefreshInFlight = null;
  async function refreshAuthSession(){
    if(authRefreshInFlight) return authRefreshInFlight;
    const saved = readAuthSession();
    const refreshToken = state.session?.refresh_token || saved?.refresh_token;
    if(!refreshToken) return false;
    authRefreshInFlight = (async()=>{
      try{
        const res = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, {
          method:'POST',
          headers:{ apikey:ANON, 'Content-Type':'application/json' },
          body:JSON.stringify({refresh_token:refreshToken})
        });
        const text = await res.text();
        let body=null; if(text){ try{body=JSON.parse(text)}catch{body=text} }
        if(!res.ok || !body?.access_token) return false;
        state.session=body;
        if(body.user) state.user=body.user;
        saveAuthSession(body);
        if(state.session?.access_token && state.user && !state.profile) await loadProfile();
        return true;
      }catch{return false;}
      finally{authRefreshInFlight=null;}
    })();
    return authRefreshInFlight;
  }

  async function api(path, options = {}, retried=false) {
    requireOnline();
    const url = `${API}${path}`;
    const makeOpts = () => ({ ...options, headers: { ...apiHeaders(!!options.body), ...(options.headers || {}) } });
    const res = await fetch(url, makeOpts());
    const text = await res.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    if (!res.ok) {
      if(res.status===401 && !retried && await refreshAuthSession()) return api(path, options, true);
      const msg = body?.message || body?.error_description || body?.error || body?.hint || (typeof body === 'string' ? body : `HTTP ${res.status}`);
      const err = new Error(String(msg)); err.status = res.status; err.body = body; throw err;
    }
    return body;
  }

  async function edge(name, payload, auth=true, retried=false) {
    requireOnline();
    const headers = { apikey: ANON, 'Content-Type':'application/json' };
    if (auth && state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
    const res = await fetch(`${API}/functions/v1/${name}`, { method:'POST', headers, body:JSON.stringify(payload || {}) });
    const text = await res.text();
    let body = null; if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    if (!res.ok) {
      if(res.status===401 && auth && !retried && await refreshAuthSession()) return edge(name,payload,auth,true);
      const msg = body?.error || body?.message || (typeof body === 'string' ? body : `Edge Function returned HTTP ${res.status}`);
      const err = new Error(String(msg)); err.status=res.status; err.body=body; throw err;
    }
    return body || {};
  }

  function setLoginError(msg='') { const e=$('#cloudLoginError'); if(e)e.textContent=msg; }
  function setGate(show) { const g=$('#cloudGate'); if(g)g.style.display=show?'block':'none'; document.body.style.overflow=show?'hidden':''; }
  function showLoginForm(){
    const lf=$('#cloudLoginForm'), rf=$('#cloudRecoveryForm'), cf=$('#cloudChangeForm'), title=$('#cloudGateTitle'), text=$('#cloudGateText');
    if(lf)lf.style.display='block'; if(rf)rf.style.display='none'; if(cf)cf.style.display='none';
    if(title)title.textContent='Sign in'; if(text)text.textContent='Use your email address and password.';
    setLoginError(''); if($('#cloudRecoveryMsg')) $('#cloudRecoveryMsg').textContent='';
  }
  function showRecoveryForm(){
    const lf=$('#cloudLoginForm'), rf=$('#cloudRecoveryForm'), cf=$('#cloudChangeForm'), title=$('#cloudGateTitle'), text=$('#cloudGateText');
    if(lf)lf.style.display='none'; if(rf)rf.style.display='block'; if(cf)cf.style.display='none';
    if(title)title.textContent='Reset your password'; if(text)text.textContent='Enter the email address used for Asset Finder. We will send a secure reset link to it.';
    const current=String($('#cloudCode')?.value||'').trim(); if($('#cloudRecoveryEmail') && /@/.test(current)) $('#cloudRecoveryEmail').value=current;
    setLoginError('');
  }

  function syntheticEmail(code){ return `${String(code||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')}@assetfinder.invalid`; }

  const AUTH_STORAGE_KEY = 'assetFinderAuthSession';
  function saveAuthSession(token){
    try{ localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      access_token: token.access_token, refresh_token: token.refresh_token,
      expires_in: token.expires_in, expires_at: token.expires_at,
      token_type: token.token_type, user: token.user
    })); }catch{}
  }
  function clearAuthSession(){ try{ localStorage.removeItem(AUTH_STORAGE_KEY); }catch{} }
  function readAuthSession(){ try{ const raw=localStorage.getItem(AUTH_STORAGE_KEY); return raw?JSON.parse(raw):null; }catch{return null;} }
  async function restoreAuthSession(){
    const saved=readAuthSession();
    if(!saved?.access_token) return false;
    try{
      let token=saved;
      const exp=Number(token.expires_at||0);
      if(token.refresh_token && (!exp || Date.now()/1000 > exp-60)){
        const refreshed=await refreshAuthSession();
        if(refreshed) token=state.session;
      }
      state.session=token; state.user=token.user || await api('/auth/v1/user');
      await loadProfile();
      return true;
    }catch(e){ clearAuthSession(); state.session=null; state.user=null; state.profile=null; return false; }
  }

  async function login(code, password) {
    setLoginError('');
    const btn = $('#cloudLoginForm button[type=submit]'); if (btn) { btn.disabled=true; btn.textContent='Signing in…'; }
    try {
      let email = String(code||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        try { const r = await edge('account-recovery',{action:'resolve_login',login_code:code},false); if (r?.email) email=String(r.email).trim().toLowerCase(); } catch {}
      } else {
        try { const r = await edge('account-recovery',{action:'resolve_login',login_code:email},false); if (r?.email) email=String(r.email).trim().toLowerCase(); } catch {}
      }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter the email address you use to sign in.');
      const token = await api('/auth/v1/token?grant_type=password', { method:'POST', body:JSON.stringify({ email, password }) });
      state.session = token;
      state.user = token.user;
      saveAuthSession(token);
      await loadProfile();
      if (state.profile.must_change_password) {
        showChangePassword();
      } else {
        setGate(false);
        await loadAllData();
        await loadAppMeta();
        mountAccountBar();
        renderHome();
        renderStatusBar();
      }
    } catch (e) {
      const m=String(e.message||'Login failed.');
      if(/invalid login credentials|invalid_credentials|invalid password/i.test(m)) setLoginError('Email or password is incorrect. You can use Forgot password? to reset it.');
      else setLoginError(m);
    } finally {
      if (btn) { btn.disabled=false; btn.textContent='Sign in'; }
    }
  }

  async function loadProfile() {
    const rows = await api(`/rest/v1/profiles?select=id,name,employee_number,login_code,role,status,must_change_password,recovery_email,profile_photo_data_url,created_at&id=eq.${encodeURIComponent(state.user.id)}&limit=1`);
    const p = rows?.[0];
    if (!p) throw new Error('Your account profile could not be loaded.');
    if (p.status !== 'active') throw new Error('This account is suspended or disabled.');
    state.profile = p; window.assetFinderProfile=p;
  }

  function showChangePassword(recovery=false){
    const loginForm=$('#cloudLoginForm'), recoveryForm=$('#cloudRecoveryForm'), changeForm=$('#cloudChangeForm'), title=$('#cloudGateTitle'), text=$('#cloudGateText');
    if(loginForm)loginForm.style.display='none'; if(recoveryForm)recoveryForm.style.display='none'; if(changeForm)changeForm.style.display='block';
    if(title)title.textContent=recovery?'Create a new password':'Change your password';
    if(text)text.textContent=recovery?'Choose a new password for your Asset Finder account.':'Your password must be changed before you continue.';
    setGate(true);
  }

  async function changePassword() {
    const a=$('#cloudNewPassword')?.value||'', b=$('#cloudNewPassword2')?.value||''; const out=$('#cloudChangeError');
    if(a.length<10){out.textContent='Password must be at least 10 characters.';return;} if(a!==b){out.textContent='The passwords do not match.';return;}
    out.textContent='';
    try {
      await api('/auth/v1/user',{method:'PUT',body:JSON.stringify({password:a})});
      await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.profile.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({must_change_password:false})});
      state.profile.must_change_password=false; window.assetFinderProfile=state.profile;
      setGate(false); await loadAllData(); mountAccountBar(); renderHome();
    } catch(e){ out.textContent=e.message||'Could not change password.'; }
  }

  async function logout(){
    try { if(state.session?.access_token) await api('/auth/v1/logout',{method:'POST'}); } catch {}
    clearAuthSession();
    state.session=null; state.user=null; state.profile=null; state.patches=[]; state.inventories=new Map(); state.users=[]; state.assignments=[]; state.approvals=[]; state.removalRequests=[]; state.flyTipReports=[];
    document.getElementById('afAccountBar')?.remove();
    const lf=$('#cloudLoginForm'), cf=$('#cloudChangeForm'), title=$('#cloudGateTitle'), text=$('#cloudGateText');
    showLoginForm(); setGate(true);
  }
  window.assetFinderLogout=logout;

  async function recoverPassword(){ showRecoveryForm(); }

  async function submitRecovery(){
    const email=String($('#cloudRecoveryEmail')?.value||'').trim().toLowerCase();
    const msg=$('#cloudRecoveryMsg'); if(msg){msg.textContent='';msg.style.color='';}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ if(msg){msg.style.color='#9d1c1c';msg.textContent='Enter a valid email address, for example name@example.com.';} $('#cloudRecoveryEmail')?.focus(); return; }
    const btn=$('#cloudRecoveryForm button[type=submit]'); if(btn){btn.disabled=true;btn.textContent='Sending…';}
    try{
      const redirect=location.origin+location.pathname;
      let result=null;
      // Prefer the standard Supabase Auth recovery endpoint. This avoids an extra server hop
      // and works consistently on Safari/iPhone. Fall back to the recovery Edge Function.
      const direct=await fetch(`${API}/auth/v1/recover`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email,redirect_to:redirect})});
      const directText=await direct.text();
      let directBody=null; try{directBody=directText?JSON.parse(directText):null;}catch{}
      if(!direct.ok){
        result=await edge('account-recovery',{action:'send_reset',login_code:email,redirect_to:redirect},false);
      }else{
        result=directBody||{ok:true};
      }
      if(msg){msg.style.color='#16855b';msg.innerHTML='<div id="af334RecoverySuccess"><strong>Reset email requested.</strong><br>Check your inbox and spam/junk folder. The link will return you to Asset Finder so you can choose a new password.</div>';}
      if($('#cloudRecoveryEmail')) $('#cloudRecoveryEmail').blur();
      return result;
    }catch(e){
      const text=String(e?.message||'Could not send the reset email.');
      if(msg){msg.style.color='#9d1c1c';msg.textContent=text.includes('redirect')?'The reset email service rejected the app return address.':text;}
    }finally{if(btn){btn.disabled=false;btn.textContent='Send reset email';}}
  }

  async function handleRecoveryRedirect(){
    const params=new URLSearchParams(location.hash.replace(/^#/,'')||location.search.replace(/^\?/,'')||'');
    const type=params.get('type'); const access=params.get('access_token'); const refresh=params.get('refresh_token');
    if(type!=='recovery' || !access) return false;
    try{
      const token={access_token:access,refresh_token:refresh||'',expires_in:Number(params.get('expires_in')||3600),expires_at:Math.floor(Date.now()/1000)+Number(params.get('expires_in')||3600),token_type:params.get('token_type')||'bearer'};
      state.session=token; saveAuthSession(token);
      state.user=await api('/auth/v1/user');
      await loadProfile();
      history.replaceState(null,document.title,location.pathname+location.search);
      setGate(true); showChangePassword();
      return true;
    }catch(e){
      clearAuthSession(); state.session=null; state.user=null; state.profile=null; setGate(true); showLoginForm(); setLoginError(e.message||'The reset link is invalid or has expired.'); return true;
    }
  }

  async function loadAllData(){
    const patches = await api('/rest/v1/patches?select=id,name&order=name.asc');
    state.patches = Array.isArray(patches)?patches:[];
    const inventories = await api('/rest/v1/patch_inventories?select=patch_id,patch_name,inventory,updated_at&order=patch_name.asc');
    state.inventories = new Map();
    (inventories||[]).forEach(r=>state.inventories.set(String(r.patch_id), { patch_id:r.patch_id, patch_name:r.patch_name, inventory:normaliseInventory(r.inventory), updated_at:r.updated_at }));
    if (!state.currentPatchId || !state.patches.some(p=>p.id===state.currentPatchId)) state.currentPatchId=state.patches[0]?.id||null;
    if (isAdmin()) await loadAdminData();
    else await loadUserRequests();
  }

  async function loadUserRequests(){
    if(isAdmin()) return;
    try { state.approvals = await api(`/rest/v1/asset_approvals?select=*&status=eq.pending&requested_by=eq.${encodeURIComponent(state.profile?.id||'')}&order=created_at.desc`); } catch { state.approvals=[]; }
    try { state.removalRequests = await api(`/rest/v1/asset_removal_requests?select=*&status=eq.pending&requested_by=eq.${encodeURIComponent(state.profile?.id||'')}&order=created_at.desc`); } catch { state.removalRequests=[]; }
    try { state.flyTipReports = await api(`/rest/v1/fly_tip_reports?select=*&created_by=eq.${encodeURIComponent(state.profile?.id||'')}&order=created_at.desc`); } catch { state.flyTipReports=[]; }
    try { state.scrapReports = await api(`/rest/v1/scrap_reports?select=*&created_by=eq.${encodeURIComponent(state.profile?.id||'')}&order=created_at.desc`); } catch { state.scrapReports=[]; }
  }

  function normaliseInventory(inv){ return { accessPoints:Array.isArray(inv?.accessPoints)?inv.accessPoints:[], history:Array.isArray(inv?.history)?inv.history:[] }; }
  function patchInventory(patchId){ return state.inventories.get(String(patchId))?.inventory || {accessPoints:[],history:[]}; }

  async function loadAdminData(){
    try { state.users = await api('/rest/v1/profiles?select=id,name,employee_number,login_code,role,status,must_change_password,recovery_email,created_at&order=name.asc'); } catch { state.users=[]; }
    try { state.assignments = await api('/rest/v1/user_patches?select=user_id,patch_id'); } catch { state.assignments=[]; }
    // Only the pending queues are needed for the admin workflow. This keeps the
    // counters accurate and avoids re-processing old approved/rejected records.
    try { state.approvals = await api('/rest/v1/asset_approvals?select=*&status=eq.pending&order=created_at.desc'); } catch { state.approvals=[]; }
    try { state.removalRequests = await api('/rest/v1/asset_removal_requests?select=*&status=eq.pending&order=created_at.desc'); } catch { state.removalRequests=[]; }
    try { state.flyTipReports = await api('/rest/v1/fly_tip_reports?select=*&order=created_at.desc'); } catch { state.flyTipReports=[]; }
    try { state.scrapReports = await api('/rest/v1/scrap_reports?select=*&order=created_at.desc'); } catch { state.scrapReports=[]; }
    handleQueueNotifications();
    updateApprovalBadge();
  }

  function pendingApprovals(){ return Array.isArray(state.approvals)?state.approvals:[]; }
  function pendingRemovals(){ return Array.isArray(state.removalRequests)?state.removalRequests:[]; }
  function pendingFlyTips(){ return Array.isArray(state.flyTipReports)?state.flyTipReports.filter(x=>x.status==='new'):[]; }
  function pendingScrap(){ return Array.isArray(state.scrapReports)?state.scrapReports.filter(x=>x.status==='new'):[]; }

  function handleQueueNotifications(){
    if(!isAdmin()) return;
    const approvalIds=new Set(pendingApprovals().map(x=>String(x.id)));
    const removalIds=new Set(pendingRemovals().map(x=>String(x.id)));
    const flyTipIds=new Set(pendingFlyTips().map(x=>String(x.id)));
    const scrapIds=new Set(pendingScrap().map(x=>String(x.id)));
    if(state.approvalBaselineReady){
      const newApprovals=[...approvalIds].filter(id=>!state.pendingApprovalIds.has(id)).length;
      const newRemovals=[...removalIds].filter(id=>!state.pendingRemovalIds.has(id)).length;
      const newFlyTips=[...flyTipIds].filter(id=>!state.pendingFlyTipIds.has(id)).length;
      const newScrap=[...scrapIds].filter(id=>!state.pendingScrapIds.has(id)).length;
      if(newApprovals||newRemovals||newFlyTips||newScrap) showQueuePopup(newApprovals,newRemovals,newFlyTips,newScrap);
    }
    state.pendingApprovalIds=approvalIds;
    state.pendingRemovalIds=removalIds;
    state.pendingFlyTipIds=flyTipIds;
    state.pendingScrapIds=scrapIds;
    state.approvalBaselineReady=true;
  }

  function showQueuePopup(approvalsCount, removalsCount, flyTipsCount=0, scrapCount=0){
    clearTimeout(state.popupTimer);
    document.querySelectorAll('.af33-popup').forEach(x=>x.remove());
    const parts=[];
    if(approvalsCount) parts.push(`${approvalsCount} new asset approval${approvalsCount===1?'':'s'}`);
    if(removalsCount) parts.push(`${removalsCount} new removal request${removalsCount===1?'':'s'}`);
    if(flyTipsCount) parts.push(`${flyTipsCount} new fly tip report${flyTipsCount===1?'':'s'}`);
    if(scrapCount) parts.push(`${scrapCount} new scrap report${scrapCount===1?'':'s'}`);
    const wrap=document.createElement('div'); wrap.className='af33-popup';
    wrap.innerHTML=`<div class="bell">🔔</div><div class="body"><b>New Asset Finder request${(approvalsCount+removalsCount+flyTipsCount+scrapCount)===1?'':'s'}</b><div>${esc(parts.join(' · '))}.</div></div><div class="actions"><button class="btn primary" id="af33ViewQueue">View requests</button><button class="btn light" id="af33DismissQueue">Dismiss</button></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#af33ViewQueue').onclick=()=>{
      wrap.remove();
      if(scrapCount && !approvalsCount && !removalsCount && !flyTipsCount) openScrapReports().catch(e=>alert(e.message));
      else if(flyTipsCount && !approvalsCount && !removalsCount && !scrapCount) openFlyTipReports().catch(e=>alert(e.message));
      else if(removalsCount && !approvalsCount) openRemovalRequests().catch(e=>alert(e.message));
      else openApprovals().catch(e=>alert(e.message));
    };
    wrap.querySelector('#af33DismissQueue').onclick=()=>wrap.remove();
    state.popupTimer=setTimeout(()=>wrap.remove(),9000);
  }

  function updateApprovalBadge(){
    const adminBtn=$('#navAdmin');
    const approvalsCount=pendingApprovals().length;
    const removalsCount=pendingRemovals().length;
    const flyTipsCount=pendingFlyTips().length;
    const scrapCount=pendingScrap().length;
    if(adminBtn){
      const total=approvalsCount+removalsCount+flyTipsCount+scrapCount;
      adminBtn.innerHTML=`Admin${total?`<span class="af33-badge" aria-label="${total} pending">${total}</span>`:''}`;
    }
    const approvalBtn=$('#approvalsBtn');
    if(approvalBtn){
      const c=approvalBtn.querySelector('.af38-admin-count');
      if(c) c.textContent=approvalsCount;
      else approvalBtn.innerHTML=`Pending Asset Approvals${approvalsCount?`<span class="af33-badge" aria-label="${approvalsCount} pending">${approvalsCount}</span>`:''}`;
    }
    const removalBtn=$('#removalsBtn');
    if(removalBtn){
      const c=removalBtn.querySelector('.af38-admin-count');
      if(c) c.textContent=removalsCount;
      else removalBtn.innerHTML=`Removal Requests${removalsCount?`<span class="af33-badge" aria-label="${removalsCount} pending">${removalsCount}</span>`:''}`;
    }
    const flyTipBtn=$('#flyTipReportsBtn');
    if(flyTipBtn){
      const c=flyTipBtn.querySelector('.af38-admin-count');
      if(c) c.textContent=flyTipsCount;
      else flyTipBtn.innerHTML=`🗑 Fly Tip Reports${flyTipsCount?`<span class="af33-badge" aria-label="${flyTipsCount} new">${flyTipsCount}</span>`:''}`;
    }
    const scrapBtn=$('#scrapReportsBtn');
    if(scrapBtn){ const c=scrapBtn.querySelector('.af38-admin-count'); if(c) c.textContent=scrapCount; }
    const adminTotal=document.querySelector('.af38-admin-total'); if(adminTotal) adminTotal.textContent=`${approvalsCount+removalsCount+flyTipsCount+scrapCount} pending`;
    document.querySelectorAll('[data-approvals-badge]').forEach(el=>el.textContent=approvalsCount);
    document.querySelectorAll('[data-removals-badge]').forEach(el=>el.textContent=removalsCount);
    updateMobileAlertBell();
    // Re-render only the counter text; never replace the current approvals/removals page.
    const title=$('#queueLiveCount');
    if(title) title.textContent=`${approvalsCount+removalsCount} pending`;
    const qType=$('#queueTypeCount');
    if(qType) qType.textContent=`${state.adminSubView==='removals'?removalsCount:approvalsCount} pending`;
  }

  async function loadAppMeta(){
    try{
      const rows=await api('/rest/v1/app_config?select=latest_version,updated_at&id=eq.1');
      state.appMeta.latestVersion=rows?.[0]?.latest_version||null;
      state.appMeta.serverOk=true;
      state.appMeta.lastSyncedAt=new Date();
    }catch(e){
      state.appMeta.serverOk=false;
    }
    renderStatusBar();
  }

  function renderStatusBar(){
    const el=$('#appStatusBar'); if(!el)return;
    if(!state.profile){el.style.display='none';return;}
    const latestRaw=state.appMeta.latestVersion;
    const latest=String(latestRaw??'').trim().replace(/^v/i,'');
    const currentVersion=String(APP_VERSION).trim().replace(/^v/i,'');
    const upToDate=!latest || latest===currentVersion;
    const dotClass=state.appMeta.serverOk?(upToDate?'ok':'warn'):'bad';
    const isMobile=window.innerWidth<=700;
    const label=state.appMeta.serverOk?(upToDate?'Synced':(isMobile?'Update':'Update available')):'Offline';
    const versionText=upToDate?`v${currentVersion}`:`v${currentVersion} → v${latest||'?'}`;
    const syncText=state.appMeta.serverOk?'Central server connected':'Central server unavailable';
    const stamp=state.appMeta.lastSyncedAt?`Last synced ${state.appMeta.lastSyncedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'Not synced';
    const approvalsCount=pendingApprovals().length;
    const removalsCount=(state.removalRequests||[]).filter(x=>x.status==='pending').length;
    const approvalsLabel=isMobile?`A ${approvalsCount}`:`Approvals: ${approvalsCount}`;
    const removalsLabel=isMobile?`R ${removalsCount}`:`Removals: ${removalsCount}`;
    el.style.display='flex';
    el.innerHTML=`<div class="af33-status-main"><div class="af33-status-copy"><span class="af33-dot ${dotClass}"></span><span class="af33-sync-label">${esc(label)}</span><span class="af33-version-chip">${esc(versionText)}</span><span class="af33-sync-chip">${esc(syncText)}</span></div></div><div class="af33-status-meta"><span class="af33-last-sync">${esc(stamp)}</span><span class="af33-status-chip">${esc(approvalsLabel)}</span><span class="af33-status-chip">${esc(removalsLabel)}</span><button type="button" class="btn light af33-status-button" id="af33StatusDetails">Status</button></div>`;
    $('#af33StatusDetails')?.addEventListener('click',()=>{
      const msg=state.appMeta.serverOk?(upToDate?`Connected to the central server.
Running latest version v${APP_VERSION}.
Data is synced.`:`Connected to the central server.
Your version: v${APP_VERSION}.
Latest version: v${latest}.
Please refresh after the newest deployment is available.`):'The central server cannot be reached right now.';
      alert(msg);
    });
  }

  async function reload(){
    try { await loadAllData(); renderCurrent(); } catch(e){ console.error(e); showAppError(e.message); }
  }

  async function refreshEverywhere(){
    try { await loadAllData(); renderCurrent(); } catch(e){ console.warn('Refresh failed',e); }
  }
  setInterval(async()=>{
    if(!state.profile) return;
    try {
      await loadAllData();
      await loadAppMeta();
      updateApprovalBadge();
      // Do not replace the approvals/removals DOM every few seconds. On Safari/iPhone
      // that can interrupt the active view and make it appear as if the queue has
      // kicked the user back out. The queue remains open; new items are surfaced by
      // the live counter/popup and can be loaded with the explicit Refresh button.
      if(state.currentView==='admin' && state.adminSubView==='admin'){
        const active=document.activeElement;
        const typing=active && (active.matches('input,textarea,select,[contenteditable="true"]') || active.closest('form'));
        if(!typing) renderAdmin();
      }
    } catch(e){ console.warn('Refresh failed',e); }
  },5000);

  let lastScrollY = window.scrollY || 0;
  let headerScrollTick = false;
  window.addEventListener('scroll',()=>{
    if(headerScrollTick || IS_IOS) return;
    headerScrollTick = true;
    requestAnimationFrame(()=>{
      const y=window.scrollY||0;
      const top=document.querySelector('.top');
      if(top && y>70){
        if(y>lastScrollY+6) top.classList.add('af-header-hidden');
        else if(y<lastScrollY-4) top.classList.remove('af-header-hidden');
      } else if(top){
        top.classList.remove('af-header-hidden');
      }
      lastScrollY=y;
      headerScrollTick=false;
    });
  },{passive:true});

  function renderCurrent(){
    // Never replace the active form while the user is typing. Re-rendering #view
    // destroys the focused input on mobile/tablet browsers, which makes the
    // keyboard disappear and clears partially entered values. The next refresh
    // cycle will render once the user leaves the field.
    const active=document.activeElement;
    const typing=active && (active.matches('input,textarea,select,[contenteditable=\"true\"]') || active.closest('form'));
    if(typing) return;
    if(state.currentView==='admin'){
      if(state.adminSubView==='approvals') renderApprovals();
      else if(state.adminSubView==='removals') renderRemovalRequests();
      else if(state.adminSubView==='flytips') renderFlyTipReports();
      else if(state.adminSubView==='scrap') renderScrapReports();
      else renderAdmin();
    } else if(state.currentView==='profile') renderProfile();
    else if(state.currentView==='history') renderHistory();
    else if(state.currentView==='access') renderAccessDetail(state.currentPatchId,state.currentAccessId);
    else renderHome();
    mountAccountBar();
    renderStatusBar();
  }

  function showAppError(msg){ const v=$('#view'); if(v) v.innerHTML=`<div class="card empty"><b>Online service error</b><span>${esc(msg)}</span></div>`; }

  function mountAccountBar(){
    const mount=document.getElementById('accountBarMount');
    const menu=document.getElementById('afMobileMenu');
    const menuBtn=document.getElementById('navMenu');
    if(!mount) return;
    mount.querySelectorAll('#afAccountBar').forEach(el=>el.remove());
    if(menu){
      menu.innerHTML='';
      if(state.profile){
        const title=document.createElement('div'); title.className='menu-title'; title.textContent=`${state.profile.name} · ${roleLabel(state.profile.role)}`; menu.appendChild(title);
        const add=(label,handler,danger=false)=>{const b=document.createElement('button'); b.type='button'; b.textContent=label; if(danger)b.dataset.menuDanger='1'; b.onclick=()=>{closeMobileMenu();handler();}; menu.appendChild(b);};
        add('⚙ Settings',()=>{state.currentView='profile';renderProfile();});
        if(isAdmin()) add('🛠 Admin',()=>{state.currentView='admin';renderAdmin();});
        add('👤 Profile',()=>{state.currentView='profile';renderProfile();});
        add('🚪 Log out',logout,true);
      }
    }
    if(state.profile && !isMobileLayout()){
      const bar=document.createElement('div');
      bar.id='afAccountBar';
      bar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:8px 0 0;padding:8px 0;border-top:1px solid rgba(255,255,255,.22);';
      bar.innerHTML=`<span style="color:white;font-weight:800;font-size:12px">${esc(state.profile.name)} · ${esc(roleLabel(state.profile.role))}</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn light" type="button" data-profile>Profile</button><button class="logout-btn" type="button" data-logout>Log out</button></span>`;
      bar.querySelector('[data-profile]').onclick=()=>{state.currentView='profile';renderProfile();};
      bar.querySelector('[data-logout]').onclick=logout;
      mount.appendChild(bar);
    }
    const adminBtn=$('#navAdmin'); if(adminBtn)adminBtn.style.display=isMobileLayout()?'none':(isAdmin()?'inline-flex':'none');
    const settingsBtn=$('#navSettings'); if(settingsBtn)settingsBtn.style.display=isMobileLayout()?'none':'inline-flex';
    if(menuBtn){
      menuBtn.style.display=isMobileLayout()?'inline-flex':'none';
      menuBtn.setAttribute('aria-expanded',String(!!(menu && !menu.hidden)));
    }
    renderStatusBar();
  }

  function updateMobileAlertBell(){
    const b=document.getElementById('navAlerts'); if(!b)return;
    const count=(pendingApprovals().length||0)+(pendingRemovals().length||0)+(pendingFlyTips().length||0);
    b.innerHTML=`🔔${count?`<span class="af33-badge af-mobile-badge">${count}</span>`:''}`;
    b.title=count?`${count} pending notification${count===1?'':'s'}`:'No pending notifications';
  }
  function openMobileAlerts(){
    const approvalsCount=pendingApprovals().length, removalsCount=pendingRemovals().length;
    if(approvalsCount){ openApprovals().catch(e=>alert(e.message)); return; }
    if(removalsCount){ openRemovalRequests().catch(e=>alert(e.message)); return; }
    alert('No pending approvals or removal requests.');
  }

  function closeMobileMenu(){
    const menu=document.getElementById('afMobileMenu'); const btn=document.getElementById('navMenu');
    if(menu) menu.hidden=true;
    if(btn) btn.setAttribute('aria-expanded','false');
  }
  function toggleMobileMenu(){
    const menu=document.getElementById('afMobileMenu'); const btn=document.getElementById('navMenu'); if(!menu||!btn)return;
    menu.hidden=!menu.hidden; btn.setAttribute('aria-expanded',String(!menu.hidden));
  }

  function nav(on){ ['navHome','navHistory','navSettings','navAdmin'].forEach(id=>$( '#'+id)?.classList.remove('on')); $('#'+on)?.classList.add('on'); }
  document.getElementById('navMenu')?.addEventListener('click',toggleMobileMenu);
  document.getElementById('navAlerts')?.addEventListener('click',openMobileAlerts);
  document.addEventListener('click',(e)=>{ const menu=document.getElementById('afMobileMenu'); const btn=document.getElementById('navMenu'); if(!menu||!btn||menu.hidden)return; if(!menu.contains(e.target)&&e.target!==btn) closeMobileMenu(); });
  window.renderSettings=()=>{state.currentView='profile';renderProfile();};

  function renderHome(){
    state.currentView='home'; nav('navHome');
    const p = state.patches.find(x=>String(x.id)===String(state.currentPatchId));
    const inv = p ? patchInventory(p.id) : {accessPoints:[],history:[]};
    const q=state.search.q, mode=state.search.mode, typeFilter=state.search.assetType;
    const apCount=inv.accessPoints.length;
    const assets=inv.accessPoints.reduce((n,a)=>n+(a.assets||[]).length,0);
    const defective=inv.accessPoints.reduce((n,a)=>n+(a.assets||[]).filter(x=>/defective/i.test(x.status||'')).length,0);
    const pendingA=pendingApprovals().length;
    const pendingR=pendingRemovals().length;
    let aps=inv.accessPoints;
    if(q||mode!=='all'||typeFilter) aps=aps.filter(a=>accessMatches(a,q,mode,typeFilter));
    const patchSelect=state.patches.length>1?`<div class="field"><label>Patch</label><select id="patchSelect">${state.patches.map(x=>`<option value="${esc(x.id)}" ${x.id===state.currentPatchId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>`:'';
    const role=isOwner()?'Owner':isAdmin()?'Patch Admin':'User';
    const canAdmin=isAdmin();
    const myPending=(state.approvals||[]).length+(state.removalRequests||[]).length;
    const myRequests=(!canAdmin && myPending)?`<div class="af35-request-strip"><div><b>${myPending} request${myPending===1?'':'s'} awaiting approval</b><div style="font-size:12px;color:#c9d4e1">Your pending additions/removals will show as “Awaiting approval” in the inventory.</div></div><button type="button" class="btn secondary" id="myRequestsBtn">View my requests</button></div>`:'';
    $('#view').innerHTML=`<div class="af35-shell">
      <aside class="af35-sidebar">
        <div class="af35-side-brand"><img src="logo.png" alt=""><div><b>Asset Finder</b><span>OGRT platform</span></div></div>
        <button class="af35-side-btn on" id="sideHome">⌂ Dashboard</button>
        <button class="af35-side-btn" id="sideSearch">⌕ Search assets</button>
        <button class="af35-side-btn" id="sideHistory">◷ Past history</button>
        ${canAdmin?`<button class="af35-side-btn" id="sideAdmin">⚙ Admin</button><button class="af35-side-btn" id="sideManifest">📄 Import manifest</button>`:`<button class="af35-side-btn" id="sideRequests">⌁ My requests</button>`}
        <button class="af35-side-btn" id="sideProfile">◉ Profile</button>
      </aside>
      <section class="af35-content">
        <div class="af35-hero">
          <div><div class="af35-kicker">${role} workspace</div><h1>${esc(p?.name||'Railway patches')}</h1><p>${canAdmin?'Manage access points, review requests and keep the patch inventory current.':'Search, inspect and request changes to assets without leaving your patch.'}</p></div>
          <div class="af35-quick">${patchSelect}${canAdmin?`<button class="btn primary" id="addAccessBtn">＋ Add Access Point</button><button class="btn secondary" id="manifestImportBtn">📄 Import Manifest</button>`:`<button class="btn primary" id="myRequestsHeroBtn">📋 See Pending Requests${myPending?` (${myPending})`:''}</button>`}<button type="button" class="btn danger" id="reportFlyTipBtn" data-af-action="report-fly-tip">🗑 Report Fly Tip</button><button type="button" class="btn secondary" id="reportScrapBtn" data-af-action="report-scrap">♻ Report Scrap</button><button class="btn secondary" id="historyBtn">Past History (${inv.history.length})</button><button class="btn secondary" id="printInventoryBtn">🖨 Export PDF</button></div>
        </div>
        ${myRequests}
        <div class="af35-kpis">
          <div class="af35-kpi"><b>${apCount}</b><span>Access points</span></div>
          <div class="af35-kpi"><b>${assets}</b><span>Assets</span></div>
          <div class="af35-kpi ${defective?'red':''}"><b>${defective}</b><span>Defective</span></div>
          <div class="af35-kpi ${canAdmin&&(pendingA+pendingR)?'warn':''}"><b>${canAdmin?(pendingA+pendingR):myPending}</b><span>${canAdmin?'Pending requests':'My pending requests'}</span></div>
        </div>
        <div class="af35-searchcard">
          <div class="af35-search-grid">
            <div class="full"><label>Search</label><input id="q" class="search" placeholder="Search SC number, points, asset, location…" value="${esc(q)}" autocomplete="off"></div>
            <div><label>Search field</label><select id="searchMode"><option value="all">All</option><option value="sc">SC number</option><option value="points">Points number</option><option value="type">Asset type</option><option value="rail">Rail type</option><option value="w3">What3Words</option></select></div>
            <div><label>Asset type</label><select id="assetTypeFilter"><option value="">All asset types</option>${['Switch','Crossing','IRJ','Ballast','Rail','Bearer','Sleeper','Miscellaneous'].map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
          </div>
          <div id="af351SearchResults" class="af351-search-results" hidden></div>
        </div>
        <div class="af35-section-head"><h2>${q||typeFilter?'Search results':'Recent access points'}</h2><span>${aps.length} location${aps.length===1?'':'s'} visible</span></div>
        <div id="homeResults">${aps.length?aps.map(a=>accessCard(a)).join(''):`<div class="card empty"><b>No access points found</b><span>${canAdmin?'Add an access point to start.':'No access points are available in this patch.'}</span></div>`}</div>
      </section>
    </div>`;
    $('#searchMode').value=mode; $('#assetTypeFilter').value=typeFilter; renderSearchSuggestions();
    function renderSearchSuggestions(){
      const q=String(state.search.q||'').trim(); const sug=$('#af351SearchResults'); if(!sug)return;
      if(!q){sug.hidden=true;sug.innerHTML='';return;}
      const p=state.patches.find(x=>String(x.id)===String(state.currentPatchId)); const inv=p?patchInventory(p.id):{accessPoints:[]}; const qq=q.toLowerCase(); const hits=[];
      (inv.accessPoints||[]).forEach(a=>{
        if(accessMatches(a,q,state.search.mode,state.search.assetType)) hits.push({kind:'Access point',name:a.name||'Unnamed access point',meta:`${(a.assets||[]).length} assets · ${a.w3||'No What3Words'}`,accessId:a.id});
        (a.assets||[]).forEach(x=>{
          const hay=[x.sc,x.points,x.type,x.railType,x.w3,x.description].filter(Boolean).join(' ').toLowerCase();
          if(hay.includes(qq) && (!state.search.assetType || String(x.type||'').toLowerCase()===String(state.search.assetType).toLowerCase())) hits.push({kind:x.type||'Asset',name:`${x.type||'Asset'}${x.sc?` · SC ${x.sc}`:''}`,meta:`Stored at ${a.name||'Access point'}${x.points?` · Points ${x.points}`:''}`,accessId:a.id,assetId:x.id,type:x.type});
        });
      });
      const seen=new Set(); const top=hits.filter(h=>{const k=`${h.kind}|${h.name}|${h.accessId}|${h.assetId||''}`;if(seen.has(k))return false;seen.add(k);return true}).slice(0,10);
      sug.hidden=!top.length;
      sug.innerHTML=top.map(h=>{
        const isAsset=!!h.assetId;
        const actions=isAsset?`<div class="af351-actions">${isAdmin()?`<button type="button" class="btn light af351-mini" data-search-edit="${esc(h.assetId)}" data-search-access="${esc(h.accessId)}">Edit</button>`:''}<button type="button" class="btn ${isAdmin()?'danger':'secondary'} af351-mini" data-search-remove="${esc(h.assetId)}" data-search-access="${esc(h.accessId)}">${isAdmin()?(h.type==='Ballast'?'Remove Ballast':'Remove'):(h.type==='Ballast'?'Request Ballast Removal':'Request Removal')}</button></div>`:'';
        return `<div class="af351-result" data-search-access="${esc(h.accessId)}" data-search-asset="${esc(h.assetId||'')}" role="button" tabindex="0"><div class="af351-result-main"><div class="kind">${esc(h.kind)}</div><div class="name">${esc(h.name)}</div><div class="meta">${esc(h.meta)}</div></div>${actions}<div class="go">›</div></div>`;
      }).join('');
      sug.querySelectorAll('.af351-result').forEach(b=>{
        const open=()=>{const aid=b.dataset.searchAccess;const xid=b.dataset.searchAsset;if(!xid)return;state.search.q='';sug.hidden=true;renderAccessDetail(state.currentPatchId,aid,xid);};
        b.addEventListener('click',e=>{if(e.target.closest('[data-search-edit]')||e.target.closest('[data-search-remove]'))return;open();});
        b.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){e.preventDefault();open();}});
      });
      sug.querySelectorAll('[data-search-edit]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openAsset(b.dataset.searchAccess,b.dataset.searchEdit);}));
      sug.querySelectorAll('[data-search-remove]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeAsset(b.dataset.searchAccess,b.dataset.searchRemove);}));
    }
    $('#q').oninput=e=>{state.search.q=e.target.value; const pp=state.patches.find(x=>String(x.id)===String(state.currentPatchId)); const ii=pp?patchInventory(pp.id):{accessPoints:[]}; const rows=(ii.accessPoints||[]).filter(a=>accessMatches(a,state.search.q,state.search.mode,state.search.assetType)); const box=$('#homeResults'); if(box) box.innerHTML=rows.length?rows.map(a=>accessCard(a)).join(''):`<div class="card empty"><b>No access points found</b><span>Try another search.</span></div>`; renderSearchSuggestions();};
    $('#searchMode').onchange=e=>{state.search.mode=e.target.value;renderHome()}; $('#assetTypeFilter').onchange=e=>{state.search.assetType=e.target.value;renderHome()};
    $('#patchSelect')?.addEventListener('change',e=>{state.currentPatchId=e.target.value;state.search={q:'',mode:'all',assetType:''};renderHome()});
    $('#addAccessBtn')?.addEventListener('click',()=>openAccess()); $('#manifestImportBtn')?.addEventListener('click',openManifestImport); $('#myRequestsHeroBtn')?.addEventListener('click',()=>openMyRequestsView()); $('#reportFlyTipBtn')?.addEventListener('click',()=>openFlyTipReport().catch(e=>alert(e.message||'Could not open the fly tip report form.'))); $('#historyBtn').onclick=()=>{state.currentView='history';renderHistory()}; $('#printInventoryBtn').onclick=()=>printInventory(state.currentPatchId);
    $('#myRequestsBtn')?.addEventListener('click',()=>openMyRequestsView());
    $('#sideHome')?.addEventListener('click',()=>renderHome()); $('#sideHistory')?.addEventListener('click',()=>{state.currentView='history';renderHistory()}); $('#sideProfile')?.addEventListener('click',()=>{state.currentView='profile';renderProfile()}); $('#sideSearch')?.addEventListener('click',()=>$('#q')?.focus());
    $('#sideAdmin')?.addEventListener('click',()=>{state.currentView='admin';renderAdmin()}); $('#sideManifest')?.addEventListener('click',openManifestImport); $('#sideRequests')?.addEventListener('click',()=>openMyRequestsView());
    document.querySelectorAll('[data-open-access]').forEach(b=>b.onclick=()=>renderAccessDetail(state.currentPatchId,b.dataset.openAccess));
    document.querySelectorAll('[data-edit-access]').forEach(b=>b.onclick=()=>openAccess(b.dataset.editAccess));
  }

  function openMyRequestsView(){
    const additions=(state.approvals||[]).filter(x=>String(x.requested_by)===String(state.profile?.id||''));
    const removals=(state.removalRequests||[]).filter(x=>String(x.requested_by)===String(state.profile?.id||''));
    const rows=[...additions.map(x=>({kind:'New asset',name:x.asset_data?.type||'Asset',access:x.access_point_name||'Access point',meta:x.asset_data?.sc?`SC ${x.asset_data.sc}`:'',status:'Awaiting approval'})),...removals.map(x=>({kind:'Removal',name:x.asset_data?.type||'Asset',access:x.access_point_name||'Access point',meta:x.asset_data?.sc?`SC ${x.asset_data.sc}`:'',status:'Awaiting approval'}))];
    $('#view').innerHTML=`<div class="af35-content" style="max-width:1000px;margin:auto"><div class="af35-hero"><div><div class="af35-kicker">My requests</div><h1>Requests awaiting approval</h1><p>Your requests remain visible until an admin reviews them.</p></div><div class="af35-quick"><button class="btn secondary" id="backRequests">← Back</button></div></div><div class="card">${rows.length?rows.map(r=>`<div class="af35-approval-mini"><div><b>${esc(r.kind)} · ${esc(r.name)}</b><div style="font-size:12px;color:var(--af35-muted)">${esc(r.access)} · ${esc(r.meta)}</div></div><span class="badge">${esc(r.status)}</span></div>`).join(''):'<div class="empty"><b>No requests awaiting approval</b><span>Your approved inventory changes will appear normally.</span></div>'}</div></div>`;
    $('#backRequests').onclick=renderHome;
  }

  function printInventory(patchId){
    const p=state.patches.find(x=>String(x.id)===String(patchId));
    const inv=p?patchInventory(p.id):{accessPoints:[],history:[]};
    if(!p) return alert('No patch is selected.');
    const escP=v=>esc(v==null?'':String(v));
    const aps=(inv.accessPoints||[]);
    const totalAssets=aps.reduce((n,a)=>n+(a.assets||[]).length,0);
    const apHtml=aps.length?aps.map(a=>`<section class="print-ap"><h3>${escP(a.name)}</h3><div class="print-meta">What3Words: ${escP(a.w3||'—')} · Lorry access: ${escP(a.lorryAccess||'—')} · Rear wheel steer: ${a.rearWheelSteer?'Required':'No'}${a.notes?` · Notes: ${escP(a.notes)}`:''}</div>${(a.assets||[]).length?(a.assets||[]).map(x=>`<div class="print-asset"><strong>${escP(x.type||'Asset')}</strong> · Status: ${escP(x.status||'In Use')}<br>SC: ${escP(x.sc||'—')} · Points: ${escP(x.points||'—')} · Rail: ${escP(x.railType||'—')} · What3Words: ${escP(x.w3||'—')}${x.description?`<br>${escP(x.description)}`:''}</div>`).join(''):'<div class="print-meta">No active assets</div>'}</section>`).join(''):'<p>No access points recorded.</p>';
    const historyHtml=(inv.history||[]).length?(inv.history||[]).map(h=>`<div class="print-asset"><strong>${escP(h.type||'Asset')}</strong> · SC: ${escP(h.sc||'—')} · Points: ${escP(h.points||'—')} · Removed: ${escP(h.removed?new Date(h.removed).toLocaleString():'—')} · Access point: ${escP(h.accessPointName||'—')} · Work Order: ${escP(h.workOrderNumber||'—')} · Removed by: ${escP(h.removedByName||'—')}${h.removedByEmployeeNumber?` · Employee: ${escP(h.removedByEmployeeNumber)}`:''}</div>`).join(''):'<div class="print-meta">No past history.</div>';
    const root=document.createElement('div'); root.id='printInventoryRoot'; root.innerHTML=`<div class="print-title">Asset Finder — ${escP(p.name)} Inventory</div><div class="print-subtitle">Generated ${new Date().toLocaleString()} · ${aps.length} access points · ${totalAssets} active assets</div>${apHtml}<div class="print-history"><h2>Past History</h2>${historyHtml}</div><div class="print-footer">Asset Finder v3.1 · Central inventory report</div>`;
    document.body.appendChild(root); document.body.classList.add('print-inventory');
    const cleanup=()=>{document.body.classList.remove('print-inventory');root.remove();window.removeEventListener('afterprint',cleanup);};
    window.addEventListener('afterprint',cleanup); window.print(); setTimeout(()=>{if(document.body.classList.contains('print-inventory'))cleanup();},2000);
  }

  function accessMatches(a,q,mode,filter){
    const assets=a.assets||[]; if(filter && !assets.some(x=>String(x.type||'').toLowerCase()===filter.toLowerCase())) return false;
    if(!q) return true; const hay = mode==='sc'?assets.map(x=>x.sc).join(' '):mode==='points'?assets.map(x=>x.points).join(' '):mode==='type'?assets.map(x=>x.type).join(' '):mode==='rail'?assets.map(x=>x.railType).join(' '):mode==='w3'?[a.w3,...assets.map(x=>x.w3)].join(' '):[a.name,a.w3,a.notes,...assets.flatMap(x=>[x.sc,x.points,x.type,x.railType,x.w3,x.description])].join(' '); return hay.toLowerCase().includes(q.toLowerCase());
  }

  function accessCard(a){
    return `<div class="card" data-open-access="${esc(a.id)}"><div class="cardhead"><div><div class="title">${esc(a.name)}</div><div class="sub">${esc(a.w3||'No What3Words')}</div>${a.lorryAccess?`<div class="meta"><span class="badge planned">🚚 ${esc(a.lorryAccess)}</span></div>`:''}${a.rearWheelSteer?'<div class="meta"><span class="badge planned">Rear wheel steer required</span></div>':''}</div><div class="actions"><button class="btn light" data-open-access="${esc(a.id)}">Open</button>${isAdmin()?`<button class="btn light" data-edit-access="${esc(a.id)}">Edit</button>`:''}</div></div><div class="meta"><span>${(a.assets||[]).length} asset${(a.assets||[]).length===1?'':'s'}</span></div></div>`;
  }

  function pendingUserAdditionForAccess(accessId){
    if(isAdmin()) return [];
    const uid=String(state.profile?.id||'');
    return (state.approvals||[]).filter(r=>r.status==='pending' && String(r.requested_by)===uid && String(r.access_point_id)===String(accessId));
  }
  function pendingUserRemovalForAsset(assetId){
    if(isAdmin()) return null;
    const uid=String(state.profile?.id||'');
    return (state.removalRequests||[]).find(r=>r.status==='pending' && String(r.requested_by)===uid && String(r.asset_id)===String(assetId)) || null;
  }
  function renderAccessDetail(patchId, accessId, focusAssetId=null){
    state.currentView='access'; state.currentPatchId=patchId; state.currentAccessId=accessId; nav('navHome');
    const a=patchInventory(patchId).accessPoints.find(x=>String(x.id)===String(accessId)); if(!a){renderHome();return;}
    const pendingAdds=pendingUserAdditionForAccess(accessId);
    const pendingRemoveIds=new Set((state.removalRequests||[]).filter(r=>r.status==='pending'&&String(r.requested_by)===String(state.profile?.id||'')).map(r=>String(r.asset_id)));
    const approvedAssets=(a.assets||[]).map(x=>assetCard(a,x,pendingRemoveIds.has(String(x.id)),String(focusAssetId||'')===String(x.id)));
    const pendingCards=pendingAdds.map(r=>pendingAssetCard(r)).join('');
    $('#view').innerHTML=`<button class="back" id="backHome">← Back to Access Points</button><div class="card" style="margin-top:12px"><div class="cardhead"><div><div class="title">${esc(a.name)}</div><div class="sub">${esc(a.w3||'No What3Words')}</div><div class="sub">${esc(a.notes||'')}</div>${a.lorryAccess?`<div class="meta"><span class="badge planned">🚚 ${esc(a.lorryAccess)}</span></div>`:''}${a.rearWheelSteer?'<div class="meta"><span class="badge planned">Rear wheel steer required</span></div>':''}</div>${isAdmin()?`<button class="btn light" id="editAccessDetail">Edit</button>`:''}</div>${mapHtml(a.lat,a.lng,a.w3)}</div>
      <div class="toolbar"><div><button class="btn primary" id="assetAction">＋ ${isAdmin()?'Add Asset':'Request New Asset'}</button><span class="sub" style="margin-left:10px">${(a.assets||[]).length} approved asset${(a.assets||[]).length===1?'':'s'}${pendingAdds.length?` · ${pendingAdds.length} awaiting approval`:''}</span></div></div>
      ${pendingCards?`<div class="section-title" style="margin:8px 0">Awaiting approval</div>${pendingCards}`:''}
      ${(a.assets||[]).length?approvedAssets.join(''):`<div class="card empty"><b>No assets recorded</b><span>${isAdmin()?'Add an asset to this access point.':'No assets have been approved for this access point.'}</span></div>`}`;
    if(focusAssetId){setTimeout(()=>{const el=document.getElementById('asset-'+String(focusAssetId).replace(/[^a-zA-Z0-9_-]/g,''));if(!el)return;el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('af351-wobble');setTimeout(()=>el.classList.remove('af351-wobble'),1800);},120);}
    $('#backHome').onclick=renderHome; $('#editAccessDetail')?.addEventListener('click',()=>openAccess(a.id)); $('#assetAction')?.addEventListener('click',()=>openAsset(a.id));
    document.querySelectorAll('[data-edit-asset]').forEach(b=>b.onclick=()=>openAsset(a.id,b.dataset.editAsset));
    document.querySelectorAll('[data-remove-asset]').forEach(b=>b.onclick=()=>removeAsset(a.id,b.dataset.removeAsset));
  }

  function pendingAssetCard(r,highlight=false){
    const x=r.asset_data||{};
    const detail=[`SC: ${esc(x.sc||'—')}`,x.points?`Points: ${esc(x.points)}`:'',x.type==='Ballast'&&x.ballastAmountTons!=null?`Amount: ${esc(x.ballastAmountTons)} t`:(x.railLength?`Rail length: ${esc(x.railLength)} ${esc(x.railLengthUnit||'m')}`:''),x.railType?`Rail: ${esc(x.railType)}`:''].filter(Boolean).join(' · ');
    return `<div class="card ${highlight?'af351-highlight':''}" id="asset-${esc(x.id)}"><div class="cardhead"><div><div class="title">${esc(x.type||'Asset')}</div><div class="sub">${detail}</div><div class="meta"><span class="badge planned">Awaiting approval</span></div></div></div>${x.description?`<p class="sub">${esc(x.description)}</p>`:''}<div class="af-audit"><b>Submitted by:</b> ${esc(x.submittedByName||personName(r.requested_by))}${x.submittedByEmployeeNumber?` · ${esc(x.submittedByEmployeeNumber)}`:''}${r.created_at?` · ${esc(new Date(r.created_at).toLocaleString())}`:''}</div></div>`;
  }

  function assetCard(a,x,pendingRemoval=false,highlight=false){
    const qtyType=['Bearer','Sleeper'];
    const hasUnitQuantity=qtyType.includes(String(x.type||'')) && Number(x.quantity||x.amount||0)>0;
    const quantity=hasUnitQuantity?Number(x.quantity||x.amount||0):0;
    const controls=isAdmin()?`<button class="btn light" data-edit-asset="${esc(x.id)}">Edit</button><button class="btn danger" data-remove-asset="${esc(x.id)}">${x.type==='Ballast'?'Remove Ballast':hasUnitQuantity?`Remove ${Number(x.quantity||x.amount||0)>1?'Bulk ':''}${esc(x.type)}`:'Remove'}</button>`:pendingRemoval?`<button class="btn light" disabled>Removal awaiting approval</button>`:`<button class="btn danger" data-remove-asset="${esc(x.id)}">${x.type==='Ballast'?'Request Ballast Removal':hasUnitQuantity?`Request ${Number(x.quantity||x.amount||0)>1?'Bulk ':''}${esc(x.type)} Removal`:'Request Asset Removal'}</button>`;
    const detail=[`SC: ${esc(x.sc||'—')}`,x.points?`Points: ${esc(x.points)}`:'',hasUnitQuantity?`Qty: ${esc(quantity)}`:'',x.type==='Ballast'?`Amount: ${esc(x.ballastAmountTons)} t`:(x.railLength?`Rail length: ${esc(x.railLength)} ${esc(x.railLengthUnit||'m')}`:''),x.length?`Length: ${esc(x.length)} ${esc(x.lengthUnit||'')}`:'',x.railType?`Rail: ${esc(x.railType)}`:''].filter(Boolean).join(' · ');
    return `<div class="card ${highlight?'af351-highlight':''}" id="asset-${esc(x.id)}"><div class="cardhead"><div><div class="title">${esc(x.type||'Asset')}</div><div class="sub">${detail}</div><div class="meta">${statusBadge(x.status)} ${x.railType?`<span class="badge planned">${esc(x.railType)}</span>`:''}${pendingRemoval?` <span class="badge planned">Removal awaiting approval</span>`:''}</div></div><div class="actions">${controls}</div></div>${x.description?`<p class="sub">${esc(x.description)}</p>`:''}<div class="af-audit">${x.submittedByName?`<div><b>Submitted by:</b> ${esc(x.submittedByName)}${x.submittedByEmployeeNumber?` · ${esc(x.submittedByEmployeeNumber)}`:''}${x.submittedAt?` · ${esc(new Date(x.submittedAt).toLocaleString())}`:''}</div>`:''}${x.approvedByName?`<div><b>Approved by:</b> ${esc(x.approvedByName)}${x.approvedByEmployeeNumber?` · ${esc(x.approvedByEmployeeNumber)}`:''}${x.approvedAt?` · ${esc(new Date(x.approvedAt).toLocaleString())}`:''}</div>`:''}</div>${x.photos?.length?`<div class="photo-grid">${x.photos.map(p=>`<img class="asset-photo" src="${p}" alt="Asset photo">`).join('')}</div>`:''}</div>`;
  }
  function statusBadge(s){const t=s||'In Use';const cls=/defective/i.test(t)?'defective':/removed/i.test(t)?'removed':/stored/i.test(t)?'planned':'active';return `<span class="badge ${cls}">${esc(t)}</span>`;}
  function validCoords(lat,lng){
    const la=Number(lat), lo=Number(lng);
    return Number.isFinite(la)&&Number.isFinite(lo)&&la>=-90&&la<=90&&lo>=-180&&lo<=180&&!(Math.abs(la)<1e-9&&Math.abs(lo)<1e-9);
  }
  function mapHtml(lat,lng,w3){
    if(validCoords(lat,lng)) return `<div style="margin-top:12px"><a href="https://www.google.com/maps?q=${Number(lat)},${Number(lng)}" target="_blank" rel="noopener">Open location in Maps</a></div>`;
    if(w3) return `<div class="meta" style="margin-top:8px"><a href="https://what3words.com/${encodeURIComponent(String(w3).replace(/^\/\/\//,''))}" target="_blank" rel="noopener">Open What3Words</a></div>`;
    return `<div class="meta" style="margin-top:8px">Location not set</div>`;
  }
  function showMapPicker(initialLat='',initialLng='',onPick,title='Choose access point on map'){
    const overlay=document.createElement('div'); overlay.className='af358-map-picker'; overlay.innerHTML=`<div class="af358-map-card"><div class="af358-map-head"><b>${esc(title)}</b><button type="button" class="btn light" id="af358MapClose">Close</button></div><div id="af358Map" class="af358-map"></div><div class="af358-map-foot"><div><div class="af358-coords" id="af358Coords">Tap the map to place the pin</div><div class="af358-location-note">You can move the pin by tapping another location.</div></div><div class="af358-loc-actions"><button type="button" class="btn secondary" id="af358UseLocation">Use my location</button><button type="button" class="btn primary" id="af358UsePin" disabled>Use this location</button></div></div></div>`;
    document.body.appendChild(overlay);
    let map,marker,chosen=null;
    const start=validCoords(initialLat,initialLng)?[Number(initialLat),Number(initialLng)]:[52.8,-1.5];
    const startZoom=validCoords(initialLat,initialLng)?15:6;
    if(window.L){
      map=L.map('af358Map',{zoomControl:true}).setView(start,startZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
      if(validCoords(initialLat,initialLng)){ chosen={lat:Number(initialLat),lng:Number(initialLng)}; marker=L.marker([chosen.lat,chosen.lng]).addTo(map); }
      map.on('click',e=>{ chosen={lat:e.latlng.lat,lng:e.latlng.lng}; if(marker) marker.setLatLng(e.latlng); else marker=L.marker(e.latlng).addTo(map); $('#af358Coords').textContent=`${chosen.lat.toFixed(6)}, ${chosen.lng.toFixed(6)}`; $('#af358UsePin').disabled=false; });
      if(chosen){ $('#af358Coords').textContent=`${chosen.lat.toFixed(6)}, ${chosen.lng.toFixed(6)}`; $('#af358UsePin').disabled=false; }
      setTimeout(()=>map.invalidateSize(),80);
      $('#af358UseLocation').onclick=()=>{ if(!navigator.geolocation)return alert('Location services are not available on this device.'); navigator.geolocation.getCurrentPosition(pos=>{map.setView([pos.coords.latitude,pos.coords.longitude],17); chosen={lat:pos.coords.latitude,lng:pos.coords.longitude}; if(marker) marker.setLatLng([chosen.lat,chosen.lng]); else marker=L.marker([chosen.lat,chosen.lng]).addTo(map); $('#af358Coords').textContent=`${chosen.lat.toFixed(6)}, ${chosen.lng.toFixed(6)}`; $('#af358UsePin').disabled=false;},()=>alert('Unable to get your current location. You can still tap the map to choose a point.'),{enableHighAccuracy:true,timeout:10000});};
    } else { $('#af358Map').innerHTML='<div style="padding:20px">Map service unavailable. Please try again.</div>'; }
    const close=()=>overlay.remove(); $('#af358MapClose').onclick=close; $('#af358UsePin').onclick=()=>{ if(chosen){ onPick(chosen.lat,chosen.lng); close(); }};
  }

  function openAccess(id=null){
    if(!isAdmin()) return;
    const a=id?patchInventory(state.currentPatchId).accessPoints.find(x=>String(x.id)===String(id)):null;
    $('#sheet').innerHTML=`<h2>${a?'Edit Access Point':'Add Access Point'}</h2><form class="form two" id="accessForm"><div class="field"><label>Access Point Name *</label><input id="aname" required value="${esc(a?.name||'')}"></div><div class="field"><label>What3Words</label><input id="aw3" value="${esc(a?.w3||'')}"></div><div class="field full"><label>Location</label><div class="af358-loc-actions"><button type="button" class="btn secondary" id="chooseMapBtn">📍 Choose on Map</button><span id="chosenLocation" class="af358-coords">${validCoords(a?.lat,a?.lng)?`${Number(a.lat).toFixed(6)}, ${Number(a.lng).toFixed(6)}`:'No map location selected'}</span></div><div class="af358-location-note">Select the exact access point position. This is used by “Open location in Maps”.</div><input type="hidden" id="alat" value="${esc(a?.lat??'')}"><input type="hidden" id="alng" value="${esc(a?.lng??'')}"></div><div class="field full"><label>Notes</label><textarea id="anotes">${esc(a?.notes||'')}</textarea></div><div class="field"><label>Lorry Size Access Capability</label><select id="alorry"><option value="">Select lorry access</option>${['Large HGV','Small HGV (16T)','LGV','All lorry types'].map(v=>`<option value="${esc(v)}" ${a?.lorryAccess===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><label class="check-row"><input id="arear" type="checkbox" ${a?.rearWheelSteer?'checked':''}> <span>Rear wheel steer required?</span></label></div><div class="actions full"><button type="button" class="btn light" id="cancelAccess">Cancel</button><button class="btn primary">Save Access Point</button></div></form>`;
    $('#modal').classList.remove('hidden'); $('#cancelAccess').onclick=closeModal; $('#chooseMapBtn').onclick=()=>showMapPicker($('#alat').value,$('#alng').value,(lat,lng)=>{ $('#alat').value=lat; $('#alng').value=lng; $('#chosenLocation').textContent=`${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`; }); $('#accessForm').onsubmit=e=>{e.preventDefault();saveAccess(id);};
  }

  async function saveAccess(id){
    const patchId=state.currentPatchId; const lat=$('#alat')?.value.trim(); const lng=$('#alng')?.value.trim(); const record={id:id||uid(),name:$('#aname').value.trim(),w3:normaliseW3($('#aw3').value),notes:$('#anotes').value.trim(),lorryAccess:$('#alorry').value,rearWheelSteer:$('#arear').checked,lat:lat===''?null:Number(lat),lng:lng===''?null:Number(lng),assets:[]};
    if(!record.name)return;
    await mutateInventory(patchId,inv=>{ if(id){const old=inv.accessPoints.find(x=>String(x.id)===String(id)); if(!old)throw new Error('Access point not found.'); record.assets=old.assets||[]; const i=inv.accessPoints.findIndex(x=>String(x.id)===String(id)); inv.accessPoints[i]=record;} else inv.accessPoints.push(record); });
    closeModal(); renderHome();
  }

  function normaliseW3(v){const s=String(v||'').trim(); if(!s)return ''; return s.startsWith('///')?s:`///${s.replace(/^\/*/,'').replace(/\s+/g,'.')}`;}


  async function af360LoadScript(src, globalName){
    if(window[globalName]) return window[globalName];
    await new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.async=true;el.onload=resolve;el.onerror=()=>reject(new Error('Could not load document-processing library.'));document.head.appendChild(el);});
    return window[globalName];
  }
  function af360GuessType(line){
    const s=line.toLowerCase();
    if(/\bbearer\b|\bbearerr\b|bearer\s*r\b/.test(s)) return 'Bearer';
    if(/\bsleeper\b/.test(s)) return 'Sleeper';
    if(/\bballast\b/.test(s)) return 'Ballast';
    if(/\birj\b|glued joint|manufactured joint|rail joint/.test(s)) return 'IRJ';
    if(/\bcrossing\b|diamond crossing|single slip|double slip/.test(s)) return 'Crossing';
    if(/\bswitch\b|\bpoint\b/.test(s)) return 'Switch';
    if(/\brail\b|\b56e1\b|\b54e1\b|\bcen60\b/.test(s)) return 'Rail';
    return 'Miscellaneous';
  }
  function af360ExtractNumber(line, pattern){const m=line.match(pattern); return m?m[1]:'';}
  function af360NormaliseDescription(s){
    return String(s||'')
      .replace(/\s+/g,' ')
      .replace(/[|¦]+/g,' ')
      .replace(/\b(?:Bi|i|OOSES|O0SES|00SES)\b/gi,' ')
      .replace(/\bBearerR\b/gi,'Bearer R')
      .trim();
  }
  function af360ParseManifest(text){
    const rawLines=String(text||'').split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    const out=[];
    const addItem=(item)=>{ if(!item.description && !item.materialNumber) return; out.push(item); };

    // Prefer table-like rows: material no + description + ordered/dispatched quantities.
    // This prevents OCR debris from adjacent columns being appended to the description.
    for(const line of rawLines){
      if(line.length<8) continue;
      const materialNumber=af360ExtractNumber(line,/^(\d{6,})\b/);
      const likely=/\b(bearer|bearerr|sleeper|ballast|rail|irj|switch|crossing|point)\b/i.test(line);
      if(!materialNumber && !likely) continue;

      // Start with the text after the material number, then peel delivery-note
      // quantity columns from the END. OCR commonly produces forms such as
      // "Bearer R Type - 6040mm 1.00 EA 2" where the final quantity has no
      // unit. Handling the tail this way keeps 6040mm inside the description.
      let desc=line.replace(/^\d{6,}\s*/,'');
      let ordered=null, dispatched=null;
      const twoQty=desc.match(/^(.*?)(?:\s+)(\d+(?:\.\d+)?)\s*(?:EA|EACH|NOS?|NO\.?)\s+(\d+(?:\.\d+)?)\s*(?:EA|EACH|NOS?|NO\.?)\s*$/i);
      if(twoQty){
        desc=twoQty[1]; ordered=Number(twoQty[2]); dispatched=Number(twoQty[3]);
      } else {
        const oneQty=desc.match(/^(.*?)(?:\s+)(\d+(?:\.\d+)?)\s*(?:EA|EACH|NOS?|NO\.?)\s*(?:\s+\d+(?:\.\d+)?)?\s*$/i);
        if(oneQty){ desc=oneQty[1]; ordered=Number(oneQty[2]); }
      }

      desc=af360NormaliseDescription(desc);
      if(!desc || /^(ordered|description|material no|dispatched)$/i.test(desc)) continue;

      const type=af360GuessType(desc);
      const lenM=desc.match(/(\d+(?:\.\d+)?)\s*(mm|m|ft)\b/i);
      const length=lenM?Number(lenM[1]):'';
      const lengthUnit=lenM?lenM[2].toLowerCase():'';
      const materialType=/\b(concrete|wood|steel|composite)\b/i.exec(desc)?.[1]||'';
      const quantity=Number.isFinite(dispatched)?dispatched:(Number.isFinite(ordered)?ordered:1);
      const item={
        id:uid(), type, description:desc, materialNumber,
        quantity:quantity>0?quantity:1, amount:quantity>0?quantity:1,
        length, lengthUnit, materialType,
        ballastAmountTons:type==='Ballast'?quantity:'',
        sc:af360ExtractNumber(desc,/\b(?:SC|SC\s*No\.?)\s*[:#-]?\s*(\d+)\b/i),
        points:af360ExtractNumber(desc,/\b(?:Point|Points)\s*[:#-]?\s*([A-Za-z0-9-]+)\b/i),
        railType:af360ExtractNumber(desc,/\b(56E1|54E1|CEN60)\b/i),
        sourceLine:line,
        needsReview:(type==='Miscellaneous'||((type==='Bearer'||type==='Sleeper')&&!materialType)||(type==='Rail'&&!length))
      };
      addItem(item);
    }

    // Fallback for documents whose OCR did not preserve table rows.
    if(!out.length){
      for(const line of rawLines){
        if(line.length<8) continue;
        const materialNumber=af360ExtractNumber(line,/^(\d{6,})\b/);
        const type=af360GuessType(line);
        const likely=/\b(bearer|bearerr|sleeper|ballast|rail|irj|switch|crossing|point)\b/i.test(line);
        if(!materialNumber && !likely) continue;
        const lenM=line.match(/(\d+(?:\.\d+)?)\s*(mm|m|ft)\b/i);
        const length=lenM?Number(lenM[1]):''; const lengthUnit=lenM?lenM[2].toLowerCase():'';
        const materialType=/\b(concrete|wood|steel|composite)\b/i.exec(line)?.[1]||'';
        const desc=af360NormaliseDescription(line.replace(/^\d{6,}\s*/,'').replace(/\b\d+(?:\.\d+)?\s*(?:EA|EACH|NOS?|NO\.?)\b/gi,''));
        const item={id:uid(),type,description:desc,materialNumber,quantity:1,amount:1,length,lengthUnit,materialType,ballastAmountTons:type==='Ballast'?(line.match(/(\d+(?:\.\d+)?)\s*(?:t|tonnes?)\b/i)?.[1]||''):'',sc:'',points:'',railType:'',sourceLine:line,needsReview:true};
        addItem(item);
      }
    }

    // Group identical material lines even when OCR produces slightly different
    // descriptions (for example stray column text on one occurrence). The
    // material number + classified type + dimensions/material are the stable
    // identity for a manifest line. This keeps 3 + 7 identical bearers as one
    // review item with Qty 10 instead of separate cards.
    const grouped=[]; const map=new Map();
    const cleanGroupText=v=>af360NormaliseDescription(String(v||''))
      .toLowerCase()
      .replace(/\b(?:ea|each|nos?|no\.)\b/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    for(const item of out){
      const stableDescription=cleanGroupText(item.description);
      // Material number is the primary identity. OCR can vary the description
      // between otherwise identical rows, so do not let stray OCR text create
      // separate cards. Dimensions/type are retained as safeguards.
      const key=item.materialNumber
        ? ['MAT',item.materialNumber,item.type || '',item.length || '',item.lengthUnit || '',String(item.materialType||'').toLowerCase()].join('|')
        : ['DESC',item.type || '',item.length || '',item.lengthUnit || '',String(item.materialType||'').toLowerCase(),stableDescription.replace(/[^a-z0-9]+/g,' ')].join('|');
      if(map.has(key)){
        const existing=map.get(key);
        existing.quantity = (Number(existing.quantity)||0) + (Number(item.quantity)||1);
        existing.amount = existing.quantity;
        existing.needsReview = !!(existing.needsReview || item.needsReview);
      } else {
        map.set(key,item); grouped.push(item);
      }
    }
    return grouped.slice(0,100);
  }
  async function af360ExtractDocument(file, progressEl){
    const setp=(txt,pct)=>{if(progressEl)progressEl.innerHTML=`<div class="af360-step"><span class="dot">✓</span>${esc(txt)}</div><div style="height:8px;background:#d7e5ef;border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#ffd000"></div></div>`;};
    if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)){
      setp('Reading PDF…',15);
      const pdfjs=await af360LoadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs','pdfjsLib');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
      const data=await file.arrayBuffer(); const pdf=await pdfjs.getDocument({data}).promise; let text='';
      for(let n=1;n<=Math.min(pdf.numPages,5);n++){const page=await pdf.getPage(n);const c=await page.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n';setp(`Reading page ${n} of ${pdf.numPages}…`,15+Math.round(n/Math.min(pdf.numPages,5)*45));}
      if(text.trim().length>40){setp('Identifying assets…',70);return text;}
      setp('PDF appears scanned — running OCR…',55);
      const T=await af360LoadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
      let ocrText='';
      for(let n=1;n<=Math.min(pdf.numPages,3);n++){const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1.6});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const r=await T.recognize(canvas,'eng',{logger:m=>{if(m.status==='recognizing text')setp(`OCR page ${n}…`,55+Math.round((m.progress||0)*25));}});ocrText+=r.data.text+'\n';}
      return ocrText;
    }
    setp('Preparing image OCR…',15);
    const T=await af360LoadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
    const r=await T.recognize(file,'eng',{logger:m=>{if(m.status==='recognizing text')setp('Reading document…',25+Math.round((m.progress||0)*55));}});return r.data.text||'';
  }
  function openManifestImport(){
    if(!isAdmin()) return alert('Only Owners and Patch Admins can import manifests.');
    const aps=patchInventory(state.currentPatchId).accessPoints||[];
    $('#sheet').innerHTML=`<div class="af-import-card"><h2>Import Manifest</h2><p class="small">Upload a delivery note or manifest. Asset Finder will extract and classify the materials before you assign them.</p><input id="manifestFile" type="file" accept="application/pdf,image/*"><div id="manifestProgress" style="margin:12px 0"></div><div id="manifestReview"></div><div class="actions"><button type="button" class="btn light" id="cancelManifest">Cancel</button></div></div>`;
    $('#modal').classList.remove('hidden'); $('#cancelManifest').onclick=closeModal;
    $('#manifestFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;const review=$('#manifestReview');try{const text=await af360ExtractDocument(file,$('#manifestProgress'));const items=af360ParseManifest(text);if(!items.length)throw new Error('No likely asset lines were detected. Try a clearer PDF/photo.');renderManifestReview(items,aps,file.name);}catch(err){review.innerHTML=`<div class="notice" style="border-color:#c93434;color:#7d2020;background:#fff1f1">${esc(err.message||'Could not read document.')}</div>`;}};
  }
  function renderManifestReview(items,aps,fileName){
    const accessOpts=aps.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    $('#manifestReview').innerHTML=`<div class="card"><div class="title">Detected assets</div><div class="small">${esc(fileName)} · ${items.length} grouped asset line${items.length===1?'':'s'}</div><div class="af360-import-toolbar"><label style="font-weight:800">Assign all to <select id="manifestBulkAccess"><option value="">Choose access point</option>${accessOpts}</select></label><button class="btn secondary" id="manifestApplyBulk">Apply to all</button></div><div class="af360-import-list">${items.map((it,i)=>`<div class="af360-import-row ${it.needsReview?'needs-review':''}" data-item="${i}"><label style="display:flex;gap:8px;align-items:center;font-weight:900"><input type="checkbox" class="manifest-check" checked> ${esc(it.type)} · ${esc(it.description)}</label><div class="small">Material ${esc(it.materialNumber||'—')} · Qty ${esc(it.quantity)}${it.length?` · ${esc(it.length)} ${esc(it.lengthUnit)}`:''}${it.materialType?` · ${esc(it.materialType)}`:''}</div><div class="mini-grid"><select class="manifest-type">${['Switch','Crossing','IRJ','Ballast','Rail','Bearer','Sleeper','Miscellaneous'].map(t=>`<option ${it.type===t?'selected':''}>${t}</option>`).join('')}</select><input class="manifest-amount" type="number" min="0" step="0.01" value="${esc(it.amount||it.quantity||1)}" placeholder="Amount"><select class="manifest-access"><option value="">Assign access point</option>${accessOpts}</select></div><div class="mini-grid"><input class="manifest-material" value="${esc(it.materialType||'')}" placeholder="Concrete / Wood / Steel / Composite"><div style="display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:8px"><input class="manifest-length" value="${esc(it.length||'')}" placeholder="Length"><select class="manifest-unit"><option value="">Unit</option><option ${it.lengthUnit==='mm'?'selected':''}>mm</option><option ${it.lengthUnit==='m'?'selected':''}>m</option><option ${it.lengthUnit==='ft'?'selected':''}>ft</option></select></div></div></div>`).join('')}</div><div class="actions" style="margin-top:12px"><button type="button" class="btn light" id="manifestCancel2">Cancel</button><button type="button" class="btn primary" id="manifestAdd">Add selected to inventory</button></div></div>`;
    $('#manifestCancel2').onclick=closeModal; $('#manifestBulkAccess').onchange=()=>{}; $('#manifestApplyBulk').onclick=()=>{const v=$('#manifestBulkAccess').value;if(!v)return alert('Choose an access point first.');document.querySelectorAll('.manifest-access').forEach(x=>x.value=v);}; $('#manifestAdd').onclick=()=>commitManifestImport(items);
  }
  async function commitManifestImport(items){
    const patchId=state.currentPatchId; const rows=[...document.querySelectorAll('.af360-import-row')].filter(r=>r.querySelector('.manifest-check')?.checked); if(!rows.length)return alert('Select at least one detected asset.');
    try{await mutateInventory(patchId,inv=>{for(const row of rows){const i=Number(row.dataset.item),src=items[i];const type=row.querySelector('.manifest-type')?.value||src.type;const accessId=row.querySelector('.manifest-access')?.value;if(!accessId)throw new Error(`Choose an access point for ${src.description}.`);const amount=Number(row.querySelector('.manifest-amount')?.value||src.quantity||1);const materialType=row.querySelector('.manifest-material')?.value?.trim()||src.materialType||'';const length=Number(row.querySelector('.manifest-length')?.value||src.length||0);const unit=row.querySelector('.manifest-unit')?.value||src.lengthUnit||'';const ap=inv.accessPoints.find(a=>String(a.id)===String(accessId));if(!ap)throw new Error('Access point not found.');const asset={id:uid(),type,status:'Stored',description:src.description,materialNumber:src.materialNumber||'',quantity:amount,amount,materialType,length,lengthUnit:unit,sc:src.sc||'',points:src.points||'',railType:src.railType||'',ballastAmountTons:type==='Ballast'?amount:undefined,importSource:'Manifest import',importedAt:new Date().toISOString(),needsReview:!!src.needsReview};
          const norm=v=>af360NormaliseDescription(String(v||'')).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
          const sameAsset=z=>String(z.materialNumber||'')===String(asset.materialNumber||'') && String(z.type||'')===String(asset.type||'') && Number(z.length||0)===Number(asset.length||0) && String(z.lengthUnit||'')===String(asset.lengthUnit||'') && String(z.materialType||'').toLowerCase()===String(asset.materialType||'').toLowerCase() && norm(z.description)===norm(asset.description);
          const existing=(ap.assets||[]).find(sameAsset);
          if(existing){ existing.quantity=(Number(existing.quantity)||0)+amount; existing.amount=existing.quantity; if(type==='Ballast') existing.ballastAmountTons=existing.quantity; existing.needsReview=!!(existing.needsReview||asset.needsReview); }
          else (ap.assets ||= []).push(asset);}});closeModal();renderHome();alert('Manifest assets added to the selected access points.');}catch(e){alert(e.message||'Could not import manifest assets.');}
  }
  function assetTypeOptions(selected=''){
    const types=['Switch','Crossing','IRJ','Ballast','Rail','Bearer','Sleeper','Miscellaneous'];
    return `<option value="">Select asset type</option>${types.map(t=>`<option value="${esc(t)}" ${selected===t?'selected':''}>${esc(t)}</option>`).join('')}`;
  }

  function sketchInput(x,key,left,top,title,cls=''){ const v=x?.sketch?.[key]??''; return `<input class="af-sketch-input ${cls}" data-sketch-key="${key}" style="left:${left}px;top:${top}px" value="${esc(v)}" title="${esc(title)}" aria-label="${esc(title)}" autocomplete="off">`; }
  function readSketchData(type){ const out={}; document.querySelectorAll('#dynamicAssetFields .af-sketch-input').forEach(el=>{const k=el.dataset.sketchKey;if(k)out[k]=el.value.trim();}); return out; }

  const switchSketchSvg = `<svg class="af-sketch-svg" viewBox="0 0 1060 560" preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id="arrS" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#111"/></marker></defs>
    <g fill="none" stroke="#111" stroke-width="3">
      <line x1="90" y1="120" x2="520" y2="120"/><line x1="90" y1="145" x2="520" y2="145"/>
      <line x1="90" y1="120" x2="90" y2="145"/><line x1="520" y1="120" x2="520" y2="145"/>
      <line x1="90" y1="190" x2="700" y2="240"/><line x1="90" y1="215" x2="700" y2="265"/>
      <line x1="310" y1="155" x2="700" y2="240"/><line x1="310" y1="180" x2="700" y2="265"/>
      <line x1="90" y1="350" x2="520" y2="350"/><line x1="90" y1="375" x2="520" y2="375"/>
      <line x1="90" y1="325" x2="700" y2="275"/><line x1="90" y1="350" x2="700" y2="300"/>
      <line x1="310" y1="310" x2="700" y2="240"/><line x1="310" y1="335" x2="700" y2="265"/>
      <line x1="90" y1="80" x2="520" y2="80" marker-start="url(#arrS)" marker-end="url(#arrS)" stroke-width="1.5"/>
      <line x1="90" y1="100" x2="90" y2="120"/><line x1="520" y1="100" x2="520" y2="120"/>
      <line x1="90" y1="285" x2="310" y2="285" marker-start="url(#arrS)" marker-end="url(#arrS)" stroke-width="1.5"/>
      <line x1="310" y1="285" x2="700" y2="285" marker-start="url(#arrS)" marker-end="url(#arrS)" stroke-width="1.5"/>
      <line x1="90" y1="410" x2="520" y2="410" marker-start="url(#arrS)" marker-end="url(#arrS)" stroke-width="1.5"/>
    </g>
    <g>
      <text x="115" y="62" class="dim">LH STOCK RAIL</text><text x="380" y="62" class="dim">Total Length</text>
      <text x="115" y="180" class="dim">LH FRONT</text><text x="470" y="210" class="dim">LH SWITCH RAIL</text>
      <text x="110" y="275" class="dim">Main Line Radius</text><text x="420" y="275" class="dim">Comp/Rad Drilling</text>
      <text x="470" y="325" class="dim">RH SWITCH RAIL</text><text x="735" y="250" class="dim">TOE TO NOSE</text>
      <text x="110" y="400" class="dim">RH FRONT</text><text x="210" y="450" class="dim">RH STOCK RAIL</text>
      <text x="100" y="500" class="dim">TWISTED FRONTS</text><text x="570" y="450" class="dim">DISTANCE FROM TOE</text>
      <text x="30" y="530" class="note">All dimensions are in millimetres except radii which are expressed in metres.</text>
      <text x="70" y="112" class="dim">Drill</text><text x="535" y="112" class="dim">Drill</text><text x="70" y="340" class="dim">Drill</text><text x="720" y="220" class="dim">Drill</text>
    </g>
  </svg>`;
  const crossingSketchSvg = `<svg class="af-sketch-svg" viewBox="0 0 1060 650" preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id="arrC" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#111"/></marker></defs>
    <g fill="none" stroke="#111" stroke-width="3">
      <line x1="90" y1="135" x2="960" y2="75"/><line x1="90" y1="165" x2="960" y2="105"/>
      <line x1="90" y1="455" x2="960" y2="515"/><line x1="90" y1="485" x2="960" y2="545"/>
      <line x1="90" y1="135" x2="960" y2="515"/><line x1="90" y1="165" x2="960" y2="545"/>
      <line x1="90" y1="455" x2="960" y2="105"/><line x1="90" y1="485" x2="960" y2="75"/>
      <path d="M390 150L520 300L390 450"/><path d="M670 150L540 300L670 450"/>
      <line x1="90" y1="95" x2="960" y2="35" marker-start="url(#arrC)" marker-end="url(#arrC)" stroke-width="1.5"/>
      <line x1="90" y1="185" x2="90" y2="455" marker-start="url(#arrC)" marker-end="url(#arrC)" stroke-width="1.5"/>
      <line x1="960" y1="105" x2="960" y2="515" marker-start="url(#arrC)" marker-end="url(#arrC)" stroke-width="1.5"/>
      <line x1="400" y1="300" x2="650" y2="300" marker-start="url(#arrC)" marker-end="url(#arrC)" stroke-width="1.5"/>
    </g>
    <g>
      <text x="115" y="62" class="dim">Overall LH Wing Length</text><text x="430" y="55" class="dim">Total Length</text><text x="720" y="45" class="dim">LH Leg</text>
      <text x="135" y="210" class="dim">LH Wing Front</text><text x="720" y="150" class="dim">LH Twisted Vee Leg</text><text x="720" y="180" class="dim">Distance From Nose</text>
      <text x="330" y="260" class="dim">R1</text><text x="655" y="260" class="dim">R3</text><text x="480" y="235" class="dim">Wing Cover</text>
      <text x="110" y="320" class="dim">Front Spread</text><text x="875" y="300" class="dim">Leg Spread</text>
      <text x="330" y="355" class="dim">R2</text><text x="655" y="355" class="dim">R4</text><text x="480" y="390" class="dim">Wing Cover</text>
      <text x="135" y="430" class="dim">RH Wing Front</text><text x="115" y="565" class="dim">Overall RH Wing Length</text><text x="720" y="435" class="dim">RH Twisted Vee Leg</text>
      <text x="720" y="465" class="dim">Distance From Nose</text><text x="715" y="520" class="dim">RH Leg</text>
      <text x="365" y="575" class="dim">WING FRONTS</text><text x="530" y="575" class="dim">NOSE</text><text x="755" y="575" class="dim">CROSSING VEE</text>
      <text x="25" y="630" class="note">All dimensions are in millimetres except radii which are expressed in metres.</text>
      <text x="60" y="125" class="dim">Drill</text><text x="970" y="130" class="dim">Drill</text><text x="60" y="450" class="dim">Drill</text><text x="970" y="455" class="dim">Drill</text>
    </g>
  </svg>`;
  function switchSketch(x){ return `<div class="af-sketch-wrap field full"><div class="af-sketch-title">Switch Design</div><div class="af-sketch-help">Custom technical sketch — every white box is a text field. Enter dimensions exactly as shown on your drawing.</div><div class="af-sketch-board">${switchSketchSvg}
    ${sketchInput(x,'s_lh_stock',220,92,'LH stock rail')} ${sketchInput(x,'s_total',455,48,'Total length')}
    ${sketchInput(x,'s_drill_1',70,112,'Drill option')} ${sketchInput(x,'s_drill_2',530,112,'Drill option')} ${sketchInput(x,'s_drill_3',760,198,'Drill option')}
    ${sketchInput(x,'s_lh_front',180,160,'LH front')} ${sketchInput(x,'s_lh_switch',470,192,'LH switch rail')}
    ${sketchInput(x,'s_radius',170,255,'Main line radius')} ${sketchInput(x,'s_radius_unit',235,255,'Radius unit','tiny')} ${sketchInput(x,'s_comp_rad',500,255,'Comp/Rad drilling','tiny')}
    ${sketchInput(x,'s_rh_switch',470,305,'RH switch rail')} ${sketchInput(x,'s_toe_nose',760,230,'Toe to nose')}
    ${sketchInput(x,'s_rh_front',180,350,'RH front')} ${sketchInput(x,'s_rh_stock',230,405,'RH stock rail')}
    ${sketchInput(x,'s_twisted_fronts',170,455,'Twisted fronts')} ${sketchInput(x,'s_distance_toe',650,405,'Distance from toe')}
    ${sketchInput(x,'s_drill_4',70,325,'Drill option')} ${sketchInput(x,'s_drill_5',550,345,'Drill option')} ${sketchInput(x,'s_drill_6',780,290,'Drill option')}
  </div><div class="af-sketch-note">Note: All dimensions are in millimetres except radii which are expressed in metres.</div></div>`; }
  function crossingSketch(x){ const bearers=Array.from({length:12},(_,i)=>sketchInput(x,'c_bearer_'+(i+1),360+i*48,570,'Bearer centre','bearer')).join(''); const base=Array.from({length:12},(_,i)=>sketchInput(x,'c_baseplate_'+(i+1),360+i*48,605,'Baseplate','bearer')).join(''); return `<div class="af-sketch-wrap field full"><div class="af-sketch-title">Crossing Design</div><div class="af-sketch-help">Custom technical sketch — every white box is a text field. Enter dimensions exactly as shown on your drawing.</div><div class="af-sketch-board crossing">${crossingSketchSvg}
    ${sketchInput(x,'c_overall_lh_wing',210,75,'Overall LH wing length','wide')} ${sketchInput(x,'c_total',470,72,'Total length')} ${sketchInput(x,'c_lh_leg',730,55,'LH leg')}
    ${sketchInput(x,'c_lh_wing_front',255,185,'LH wing front')} ${sketchInput(x,'c_lh_twisted_vee',800,135,'LH twisted vee leg')} ${sketchInput(x,'c_dist_nose_lh',800,165,'Distance from nose')}
    ${sketchInput(x,'c_r1',335,235,'R1')} ${sketchInput(x,'c_r1_unit',405,235,'R1 unit','tiny')} ${sketchInput(x,'c_r3',650,235,'R3')} ${sketchInput(x,'c_r3_unit',720,235,'R3 unit','tiny')}
    ${sketchInput(x,'c_wing_cover_top',500,210,'Wing cover')} ${sketchInput(x,'c_front_spread',130,300,'Front spread')} ${sketchInput(x,'c_leg_spread',900,280,'Leg spread')}
    ${sketchInput(x,'c_r2',335,330,'R2')} ${sketchInput(x,'c_r2_unit',405,330,'R2 unit','tiny')} ${sketchInput(x,'c_r4',650,330,'R4')} ${sketchInput(x,'c_r4_unit',720,330,'R4 unit','tiny')}
    ${sketchInput(x,'c_rh_wing_front',255,410,'RH wing front')} ${sketchInput(x,'c_overall_rh_wing',210,535,'Overall RH wing length','wide')} ${sketchInput(x,'c_rh_twisted_vee',800,410,'RH twisted vee leg')}
    ${sketchInput(x,'c_dist_nose_rh',800,440,'Distance from nose')} ${sketchInput(x,'c_rh_leg',730,500,'RH leg')} ${sketchInput(x,'c_wing_cover_bottom',500,375,'Wing cover')}
    ${sketchInput(x,'c_drill_1',65,105,'Drill option')} ${sketchInput(x,'c_drill_2',930,115,'Drill option')} ${sketchInput(x,'c_drill_3',65,425,'Drill option')} ${sketchInput(x,'c_drill_4',930,430,'Drill option')}
    ${bearers}${base}</div><div class="af-sketch-note">Note: All dimensions are in millimetres except radii which are expressed in metres.</div></div>`; }

  function dynamicAssetFields(x={}){
    const type=x.type||'';
    const common = `
      <div class="field"><label>SC Number *</label><input id="asc" value="${esc(x.sc||'')}" required></div>
      <div class="field"><label>Description</label><input id="adesc" value="${esc(x.description||'')}"></div>`;
    if(type==='Rail') return common + `
      <div class="field"><label>Rail Type *</label><select id="arail" required><option value="">Select rail type</option>${['56E1','54E1','CEN60','Other'].map(t=>`<option value="${t}" ${x.railType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Rail Length *</label><div style="display:grid;grid-template-columns:1fr 120px;gap:8px"><input id="railLength" inputmode="decimal" value="${esc(x.railLength||'')}" required><select id="railLengthUnit" required><option value="m" ${(!x.railLengthUnit||x.railLengthUnit==='m')?'selected':''}>m</option><option value="ft" ${x.railLengthUnit==='ft'?'selected':''}>ft</option><option value="mm" ${x.railLengthUnit==='mm'?'selected':''}>mm</option></select></div></div>
      <div class="field"><label>Rail Weight (lbs) *</label><input id="railWeight" inputmode="decimal" value="${esc(x.railWeight||'')}" required></div>`;
    if(type==='Switch') return common + `
      <div class="field"><label>Point Number *</label><input id="apoints" value="${esc(x.points||'')}" required></div>
      <div class="field"><label>Rail Type *</label><select id="arail" required><option value="">Select rail type</option>${['56E1','54E1','CEN60','Other'].map(t=>`<option value="${t}" ${x.railType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field full"><label>Hand / Set *</label><div class="choice-row"><label><input type="radio" name="switchHand" value="Left hand" ${x.switchHand==='Left hand'?'checked':''}> Left hand</label><label><input type="radio" name="switchHand" value="Right hand" ${x.switchHand==='Right hand'?'checked':''}> Right hand</label><label><input type="radio" name="switchHand" value="Full set" ${(!x.switchHand||x.switchHand==='Full set')?'checked':''}> Full set</label></div></div>
      <div class="field"><label>Switch Type *</label><select id="switchType" required><option value="">Select switch type</option>${['Straight cut','Chamfered','Undercut'].map(t=>`<option value="${t}" ${x.switchType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      ${switchSketch(x)}`;
    if(type==='Crossing') return common + `
      <div class="field"><label>Point Number *</label><input id="apoints" value="${esc(x.points||'')}" required></div>
      <div class="field"><label>Crossing Type *</label><select id="crossingType" required><option value="">Select crossing type</option>${['Common Crossing','Diamond Crossing','Single Slip','Double Slip','Other'].map(t=>`<option value="${t}" ${x.crossingType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Rail Weight (lbs) *</label><input id="railWeight" inputmode="decimal" value="${esc(x.railWeight||'')}" required></div>
      ${crossingSketch(x)}`;
    if(type==='IRJ') return common + `
      <div class="field"><label>Rail Length *</label><div style="display:grid;grid-template-columns:1fr 120px;gap:8px"><input id="railLength" inputmode="decimal" value="${esc(x.railLength||'')}" required><select id="railLengthUnit" required><option value="m" ${(!x.railLengthUnit||x.railLengthUnit==='m')?'selected':''}>m</option><option value="ft" ${x.railLengthUnit==='ft'?'selected':''}>ft</option><option value="mm" ${x.railLengthUnit==='mm'?'selected':''}>mm</option></select></div></div>
      <div class="field"><label>Rail Type *</label><select id="arail" required><option value="">Select rail type</option>${['56E1','54E1','CEN60','Other'].map(t=>`<option value="${t}" ${x.railType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>IRJ Type *</label><select id="irjType" required><option value="">Select IRJ type</option>${['4 Hole Glued','4 Hole Manufactured','6 Hole Glued','6 Hole Manufactured'].map(t=>`<option value="${t}" ${x.irjType===t?'selected':''}>${t}</option>`).join('')}</select></div>`;
    if(type==='Bearer' || type==='Sleeper') return `
      <div class="field"><label>Amount *</label><input id="materialAmount" inputmode="decimal" value="${esc(x.amount??x.quantity??'')}" min="0" step="1" required></div>
      <div class="field"><label>${type} Type *</label><select id="materialType" required><option value="">Select type</option>${['Concrete','Wood','Steel','Composite'].map(t=>`<option value="${t}" ${x.materialType===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Length *</label><div style="display:grid;grid-template-columns:1fr 120px;gap:8px"><input id="materialLength" inputmode="decimal" value="${esc(x.length??x.railLength??'')}" required><select id="materialLengthUnit" required><option value="m" ${(!x.lengthUnit||x.lengthUnit==='m')?'selected':''}>m</option><option value="ft" ${x.lengthUnit==='ft'?'selected':''}>ft</option><option value="mm" ${x.lengthUnit==='mm'?'selected':''}>mm</option></select></div></div>`;
    if(type==='Ballast') return `<div class="field full"><label>Amount (tonnes) *</label><input id="ballastAmountTons" inputmode="decimal" value="${esc(x.ballastAmountTons??'')}" min="0" step="0.01" placeholder="e.g. 10" required></div>`;
    if(type==='Miscellaneous') return `
      <div class="field full"><label>What is the asset? *</label><textarea id="miscDetails" required>${esc(x.miscDetails||'')}</textarea></div>`;
    return common;
  }

  function readAssetDynamicFields(){
    const type=$('#atype')?.value||'';
    const get=v=>document.querySelector(v)?.value?.trim()||'';
    const data={type,sc:get('#asc'),description:get('#adesc'),points:get('#apoints'),railType:get('#arail'),railLength:get('#railLength'),railLengthUnit:get('#railLengthUnit'),railWeight:get('#railWeight'),switchHand:document.querySelector('input[name="switchHand"]:checked')?.value||'',stockLength:get('#stockLength'),switchLength:get('#switchLength'),switchType:get('#switchType'),crossingType:get('#crossingType'),irjType:get('#irjType'),materialAmount:get('#materialAmount'),materialType:get('#materialType'),materialLength:get('#materialLength'),materialLengthUnit:get('#materialLengthUnit'),ballastAmountTons:get('#ballastAmountTons'),miscDetails:get('#miscDetails'),sketch:readSketchData(type)};
    if(!type) throw new Error('Please select an asset type.');
    if(!['Ballast','Bearer','Sleeper','Miscellaneous'].includes(type) && !data.sc) throw new Error('SC number is required.');
    if(type==='Switch' && (!data.points||!data.railType||!data.switchHand||!data.stockLength||!data.switchLength||!data.switchType)) throw new Error('Please complete all Switch fields.');
    if(type==='Rail' && (!data.railType||!data.railLength||!data.railLengthUnit||!data.railWeight)) throw new Error('Please complete all Rail fields.');
    if(type==='Crossing' && (!data.points||!data.crossingType||!data.railWeight)) throw new Error('Please complete all Crossing fields.');
    if(type==='IRJ' && (!data.railLength||!data.railLengthUnit||!data.railType||!data.irjType)) throw new Error('Please complete all IRJ fields.');
    if(type==='Ballast' && !(Number(data.ballastAmountTons)>0)) throw new Error('Ballast amount must be greater than 0 tonnes.');
    if(type==='Miscellaneous' && !data.miscDetails) throw new Error('Please describe the miscellaneous asset.');
    if(type==='Bearer'||type==='Sleeper'){ if(!(Number(data.materialAmount)>0) || !data.materialType || !(Number(data.materialLength)>0) || !data.materialLengthUnit) throw new Error(`Please complete all ${type} fields.`); data.materialAmount=Number(data.materialAmount); data.materialLength=Number(data.materialLength); data.length=data.materialLength; data.lengthUnit=data.materialLengthUnit; data.quantity=data.materialAmount; data.amount=data.materialAmount; } if(type==='Ballast') data.ballastAmountTons=Number(data.ballastAmountTons);
    return data;
  }

  function openAsset(aid,xid=null){
    const a=patchInventory(state.currentPatchId).accessPoints.find(x=>String(x.id)===String(aid)); if(!a)return;
    const x=xid?(a.assets||[]).find(z=>String(z.id)===String(xid)):null;
    const selectedType=x?.type||'';
    $('#sheet').innerHTML=`<h2>${x?'Edit Asset':(isAdmin()?'Add Asset':'Request New Asset')}</h2><div class="notice">Stored under <b>${esc(a.name)}</b>. Select an asset type and the relevant fields will appear for <b>every role</b>.</div><form class="form two" id="assetForm">
      <div class="field full"><label>Asset Type *</label><select id="atype" required>${assetTypeOptions(selectedType)}</select></div>
      <div class="field full" id="dynamicAssetFields">${selectedType?dynamicAssetFields(x||{}):'<div class="notice">Select <b>Switch</b>, <b>Crossing</b>, <b>IRJ</b>, <b>Ballast</b>, <b>Rail</b> or <b>Miscellaneous</b> to load its specific fields.</div>'}</div>
      <div class="field"><label>Status</label><select id="astatus">${['In Use','Stored','Defective (scrap)'].map(t=>`<option ${x?.status===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>What3Words</label><input id="aw3a" value="${esc(x?.w3||'')}"></div>
      <div class="field full"><label>Asset Photos</label><input id="photos" type="file" accept="image/*" multiple><div class="small">Photos are stored centrally with the asset record.</div><div id="photoPreview" class="photo-grid"></div></div>
      <div class="actions full"><button type="button" class="btn light" id="cancelAsset">Cancel</button><button class="btn primary" id="assetSubmit" disabled>${isAdmin()?'Save Asset':'Submit Asset for Approval'}</button></div></form>`;
    $('#modal').classList.remove('hidden');
    $('#cancelAsset').onclick=closeModal;
    const typeEl=$('#atype'), dynamicEl=$('#dynamicAssetFields'), submitEl=$('#assetSubmit');
    function renderSelectedType(){
      const selected=typeEl.value;
      const existing={
        type:selected,
        status:$('#astatus')?.value||'In Use',
        w3:$('#aw3a')?.value||'',
        sc:$('#asc')?.value||'',
        description:$('#adesc')?.value||'',
        points:$('#apoints')?.value||'',
        railType:$('#arail')?.value||'',
        railLength:$('#railLength')?.value||'',
        railLengthUnit:$('#railLengthUnit')?.value||'m',
        railWeight:$('#railWeight')?.value||'',
        switchHand:document.querySelector('input[name="switchHand"]:checked')?.value||'',
        stockLength:$('#stockLength')?.value||'',
        switchLength:$('#switchLength')?.value||'',
        switchType:$('#switchType')?.value||'',
        crossingType:$('#crossingType')?.value||'',
        irjType:$('#irjType')?.value||'',
        materialAmount:$('#materialAmount')?.value||'',
        materialType:$('#materialType')?.value||'',
        materialLength:$('#materialLength')?.value||'',
        materialLengthUnit:$('#materialLengthUnit')?.value||'m',
        ballastAmountTons:$('#ballastAmountTons')?.value||'',
        miscDetails:$('#miscDetails')?.value||''
      };
      dynamicEl.innerHTML=selected?dynamicAssetFields(existing):'<div class="notice">Select an asset type to load its specific fields.</div>';
      submitEl.disabled=!selected;
    }
    typeEl.addEventListener('change',renderSelectedType);
    $('#assetForm').onsubmit=e=>{e.preventDefault();if(typeEl.value)saveAsset(aid,xid);};
    if(selectedType) submitEl.disabled=false;
  }

  async function readPhotos(input){ const files=[...(input?.files||[])].slice(0,6); const out=[]; for(const f of files){ if(f.size>2_000_000) throw new Error('Each photo must be 2 MB or smaller.'); out.push(await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(f)})); } return out; }

  async function saveAsset(aid,xid=null){
    const patchId=state.currentPatchId; let base; try{base={...readAssetDynamicFields(),status:$('#astatus').value,w3:normaliseW3($('#aw3a').value)};}catch(e){alert(e.message);return;}
    let photos=[]; try{photos=await readPhotos($('#photos'));}catch(e){alert(e.message);return;}
    if(!isAdmin()){
      try {
        await api('/rest/v1/asset_approvals',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_id:patchId,access_point_id:aid,access_point_name:patchInventory(patchId).accessPoints.find(x=>x.id===aid)?.name||'',asset_data:{...base,id:uid(),created:Date.now(),photos,submittedById:state.profile.id,submittedByName:state.profile.name,submittedByEmployeeNumber:state.profile.employee_number,submittedAt:now()},requested_by:state.profile.id,submitted_by_name:state.profile.name,submitted_by_employee_number:state.profile.employee_number,status:'pending'})});
        closeModal(); alert('Asset submitted for approval.'); if(isAdmin()) await loadAdminData(); else { await loadUserRequests(); renderAccessDetail(state.currentPatchId, aid); } return;
      } catch(e) { alert(e.message||'Could not submit asset for approval.'); return; }
    }
    try {
      await mutateInventory(patchId,inv=>{const ap=inv.accessPoints.find(x=>String(x.id)===String(aid));if(!ap)throw new Error('Access point not found.');if(xid){const i=(ap.assets||[]).findIndex(z=>String(z.id)===String(xid));if(i<0)throw new Error('Asset not found.');ap.assets[i]={...ap.assets[i],...base,photos:photos.length?photos:(ap.assets[i].photos||[])};} else {ap.assets=ap.assets||[];ap.assets.push({...base,id:uid(),created:Date.now(),photos,submittedById:state.profile.id,submittedByName:state.profile.name,submittedByEmployeeNumber:state.profile.employee_number,submittedAt:now(),approvedById:state.profile.id,approvedByName:state.profile.name,approvedByEmployeeNumber:state.profile.employee_number,approvedAt:now()});}});
      closeModal(); renderAccessDetail(patchId,aid);
    } catch(e) { alert(e.message||'Could not save asset to the central database.'); }
  }

  async function removeAsset(aid,xid){
    try{
      const ap=patchInventory(state.currentPatchId).accessPoints.find(x=>String(x.id)===String(aid));const asset=(ap?.assets||[]).find(x=>String(x.id)===String(xid));
      if(!asset)throw new Error('Asset not found.');
      let removalAmount=null;
      const assetType=String(asset.type||'');
      const isBallast=assetType==='Ballast';
      const quantity=Number(asset.quantity??asset.amount??0);
      const isBulkAsset=!isBallast && quantity>1;

      if(isBallast){
        const current=Number(asset.ballastAmountTons||0);
        if(!(current>0))throw new Error('This ballast asset has no remaining quantity recorded.');
        const entered=prompt(`How many tonnes of ballast do you want to remove?\nAvailable: ${current} tonnes`,String(current));
        if(entered===null)return;
        removalAmount=Number(String(entered).replace(',','.'));
        if(!(removalAmount>0)||removalAmount>current)throw new Error(`Enter an amount between 0 and ${current} tonnes.`);
      } else if(isBulkAsset){
        const current=Math.floor(quantity);
        const entered=prompt(`How many ${assetType.toLowerCase()} units do you want to remove?\nAvailable: ${current}`,String(current));
        if(entered===null)return;
        removalAmount=Number(String(entered).replace(',','.'));
        if(!Number.isInteger(removalAmount)||!(removalAmount>0)||removalAmount>current)throw new Error(`Enter a whole number of units between 1 and ${current}.`);
      } else if(['Bearer','Sleeper'].includes(assetType)){
        const current=Number(asset.quantity??asset.amount??0);
        if(!(current>0))throw new Error(`This ${assetType.toLowerCase()} asset has no remaining quantity recorded.`);
        removalAmount=1;
        if(!confirm(`Remove 1 ${assetType.toLowerCase()}?\nThis is the final unit and it will move to Past History.`))return;
      } else if(!confirm('Remove this asset? It will move to Past History.'))return;

      const workOrderNumber=String(prompt('Enter the Work Order Number for this asset removal:',String(asset.workOrderNumber||''))||'').trim();
      if(!workOrderNumber){ alert('A Work Order Number is required for every asset removal.'); return; }

      if(!isAdmin()){
        const requestAsset={...asset};
        if(isBallast)requestAsset._removalAmountTons=removalAmount;
        else if(isBulkAsset||['Bearer','Sleeper'].includes(assetType))requestAsset._removalQuantity=removalAmount;
        requestAsset._workOrderNumber=workOrderNumber;
        requestAsset._requestedByName=state.profile.name||'Unknown user';
        requestAsset._requestedByEmployeeNumber=state.profile.employee_number||'';
        await api('/rest/v1/asset_removal_requests',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_id:state.currentPatchId,access_point_id:aid,access_point_name:ap.name,asset_id:xid,asset_data:requestAsset,requested_by:state.profile.id,status:'pending'})});
        const msg=isBallast?`Ballast removal request for ${removalAmount} tonnes submitted for approval.`:(isBulkAsset||['Bearer','Sleeper'].includes(assetType))?`Removal request for ${removalAmount} ${assetType.toLowerCase()} unit${removalAmount===1?'':'s'} submitted for approval.`:'Removal request submitted for approval.';
        alert(msg); if(isAdmin())await loadAdminData();else{await loadUserRequests();renderAccessDetail(state.currentPatchId,state.currentAccessId);}return;
      }

      await mutateInventory(state.currentPatchId,inv=>{
        const ap2=inv.accessPoints.find(x=>String(x.id)===String(aid));if(!ap2)throw new Error('Access point not found.');
        const i=(ap2.assets||[]).findIndex(x=>String(x.id)===String(xid));if(i<0)throw new Error('Asset not found.');
        const currentAsset=ap2.assets[i];
        if(currentAsset.type==='Ballast'){
          const current=Number(currentAsset.ballastAmountTons||0);const qty=Number(removalAmount);
          if(qty>current)throw new Error('Removal amount exceeds the available ballast.');
          currentAsset.ballastAmountTons=Number((current-qty).toFixed(3));
          inv.history.unshift({...currentAsset,id:uid(),ballastAmountTons:qty,removedAmountTons:qty,originalBallastAmountTons:current,removed:Date.now(),accessPointId:ap2.id,accessPointName:ap2.name,workOrderNumber,removedById:state.profile.id,removedByName:state.profile.name||'Unknown user',removedByEmployeeNumber:state.profile.employee_number||'',status:'Removed'});
          if(currentAsset.ballastAmountTons<=0.000001)ap2.assets.splice(i,1);
        } else if(Number(currentAsset.quantity??currentAsset.amount??0)>0){
          const current=Number(currentAsset.quantity??currentAsset.amount??0);const qty=Number(removalAmount||1);
          if(!Number.isInteger(qty)||qty<1||qty>current)throw new Error(`Removal amount must be between 1 and ${current}.`);
          const removedUnit={...currentAsset,id:uid(),quantity:qty,amount:qty,removedQuantity:qty,originalQuantity:current,removed:Date.now(),accessPointId:ap2.id,accessPointName:ap2.name,workOrderNumber,removedById:state.profile.id,removedByName:state.profile.name||'Unknown user',removedByEmployeeNumber:state.profile.employee_number||'',status:'Removed'};
          inv.history.unshift(removedUnit);
          const remaining=current-qty;
          if(remaining<=0)ap2.assets.splice(i,1);else{currentAsset.quantity=remaining;currentAsset.amount=remaining;}
        } else {
          const [assetRemoved]=ap2.assets.splice(i,1);
          inv.history.unshift({...assetRemoved,removed:Date.now(),accessPointId:ap2.id,accessPointName:ap2.name,workOrderNumber,removedById:state.profile.id,removedByName:state.profile.name||'Unknown user',removedByEmployeeNumber:state.profile.employee_number||'',status:'Removed'});
        }
      });
      renderAccessDetail(state.currentPatchId,aid);
    }catch(e){alert(e.message||'Could not remove asset from the central database.');}
  }

  async function mutateInventory(patchId, mutator){
    if(!canEditInventory(patchId)) throw new Error('You do not have permission to change this patch.');
    const rows=await api(`/rest/v1/patch_inventories?select=patch_id,patch_name,inventory&patch_id=eq.${encodeURIComponent(patchId)}&limit=1`);
    const row=rows?.[0]; if(!row)throw new Error('The central patch inventory could not be found.');
    const inv=normaliseInventory(row.inventory); await mutator(inv);
    await api(`/rest/v1/patch_inventories?patch_id=eq.${encodeURIComponent(patchId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({inventory:inv,patch_name:row.patch_name})});
    state.inventories.set(String(patchId),{...row,inventory:inv});
  }

  function closeModal(){ $('#modal')?.classList.add('hidden'); $('#sheet').innerHTML=''; }
  window.closeModal=closeModal;

  function renderHistory(){
    state.currentView='history'; nav('navHistory'); const p=state.patches.find(x=>x.id===state.currentPatchId); const inv=p?patchInventory(p.id):{history:[]};
    $('#view').innerHTML=`<button class="back" id="histBack">← Back to Asset Finder</button><div class="card"><div class="title">${esc(p?.name||'Patch')} · Past History</div></div>${inv.history.length?inv.history.map(h=>`<div class="card"><div class="cardhead"><div><div class="title">${esc(h.type||'Asset')}</div><div class="sub">SC: ${esc(h.sc||'—')} · Points: ${esc(h.points||'—')}</div><div class="meta">Removed: ${esc(new Date(h.removed||Date.now()).toLocaleString())} · Access point: ${esc(h.accessPointName||'—')} · Work Order: ${esc(h.workOrderNumber||'—')} · Removed by: ${esc(h.removedByName||'—')}${h.removedByEmployeeNumber?` · Employee: ${esc(h.removedByEmployeeNumber)}`:''}</div></div>${isAdmin()?`<div class="actions"><button class="btn light" data-restore="${esc(h.id)}">Restore</button><button class="btn danger" data-delete-history="${esc(h.id)}">Delete</button></div>`:''}</div></div>`).join(''):`<div class="card empty"><b>No past history</b></div>`}`;
    $('#histBack').onclick=renderHome; document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreAsset(b.dataset.restore)); document.querySelectorAll('[data-delete-history]').forEach(b=>b.onclick=()=>deleteHistory(b.dataset.deleteHistory));
  }
  async function restoreAsset(id){
    await mutateInventory(state.currentPatchId,inv=>{const i=inv.history.findIndex(x=>String(x.id)===String(id));if(i<0)throw new Error('History item not found.');const h=inv.history[i];const ap=inv.accessPoints.find(x=>String(x.id)===String(h.accessPointId));if(!ap)throw new Error('The original access point no longer exists.');const {...asset}=h;delete asset.removed;delete asset.accessPointId;delete asset.accessPointName;delete asset.workOrderNumber;delete asset.removedById;delete asset.removedByName;delete asset.removedByEmployeeNumber;delete asset.approvedById;delete asset.approvedByName;delete asset.approvedByEmployeeNumber;asset.status=asset.status==='Removed'?'In Use':asset.status;ap.assets=ap.assets||[];ap.assets.push(asset);inv.history.splice(i,1);}); renderHistory();
  }
  async function deleteHistory(id){ if(!confirm('Permanently delete this history item?'))return; await mutateInventory(state.currentPatchId,inv=>{const i=inv.history.findIndex(x=>String(x.id)===String(id));if(i<0)throw new Error('History item not found.');inv.history.splice(i,1);}); renderHistory(); }

  function renderProfile(){
    state.currentView='profile'; nav('navSettings'); const p=state.profile;
    $('#view').innerHTML=`<div class="card"><div class="title">Profile</div><div class="form two"><div class="field"><label>Name</label><input value="${esc(p.name)}" disabled class="immutable"></div><div class="field"><label>Employee Number</label><input value="${esc(p.employee_number)}" disabled class="immutable"></div><div class="field"><label>Role</label><input value="${esc(roleLabel(p.role))}" disabled class="immutable"></div><div class="field full"><label>Login & Recovery Email</label><input id="loginRecoveryEmail" type="email" autocomplete="email" value="${esc(p.login_code||p.recovery_email||'')}" placeholder="name@example.com"><button class="btn secondary" id="saveLoginRecovery" type="button" style="margin-top:8px">Save Email Address</button><div class="small">This single email address is used for signing in and password recovery.</div></div><div class="field full"><label>Profile Photo</label><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div id="profilePhotoPreview" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:#e8edf1;display:flex;align-items:center;justify-content:center;font-weight:800;color:#6b7785">${p.profile_photo_data_url?`<img src="${esc(p.profile_photo_data_url)}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover">`:'Photo'}</div><input id="profilePhoto" type="file" accept="image/*"><button type="button" class="btn secondary" id="removeProfilePhoto" ${p.profile_photo_data_url?'':'disabled'}>Remove photo</button></div><div class="small">Choose an image; it is resized and stored centrally in your profile.</div></div><div class="field"><label>New Password</label><input id="newPw" type="password" minlength="10"></div><div class="field"><label>Confirm New Password</label><input id="newPw2" type="password" minlength="10"></div><div class="actions full"><button class="btn primary" id="savePw">Change Password</button></div></div></div>`;
    $('#saveLoginRecovery').onclick=saveLoginRecovery; $('#profilePhoto').onchange=saveProfilePhoto; $('#removeProfilePhoto').onclick=removeProfilePhoto; $('#savePw').onclick=savePassword;
  }
  async function saveLoginRecovery(){
    try{
      const email=String($('#loginRecoveryEmail')?.value||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Please enter a valid email address.');
      await edge('account-recovery',{action:'set_recovery_email',email},true);
      await loadProfile(); renderProfile(); alert('Login and recovery email updated.');
    }catch(e){alert(e.message||'Could not update email address.');}
  }
  async function saveRecovery(){ return; }
  async function removeProfilePhoto(){try{await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.profile.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({profile_photo_data_url:null})});await loadProfile();renderProfile();}catch(e){alert(e.message);}}
  async function saveProfilePhoto(){
    const f=$('#profilePhoto').files?.[0]; if(!f)return;
    if(!f.type.startsWith('image/')) return alert('Please choose an image file.');
    try{
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>{const img=new Image();img.onload=()=>{const max=256;const scale=Math.min(1,max/Math.max(img.width,img.height));const w=Math.max(1,Math.round(img.width*scale));const h=Math.max(1,Math.round(img.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',0.82));};img.onerror=reject;img.src=String(reader.result);};reader.onerror=reject;reader.readAsDataURL(f);
      });
      if(String(data).length>700000) return alert('This photo could not be compressed enough. Please choose a smaller image.');
      await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.profile.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({profile_photo_data_url:data})});
      await loadProfile(); renderProfile();
    }catch(e){alert(e.message||'Could not save profile photo.');}
  }
  async function savePassword(){const a=$('#newPw').value,b=$('#newPw2').value;if(a.length<10)return alert('Password must be at least 10 characters.');if(a!==b)return alert('Passwords do not match.');try{await api('/auth/v1/user',{method:'PUT',body:JSON.stringify({password:a})});alert('Password changed.');$('#newPw').value='';$('#newPw2').value='';}catch(e){alert(e.message);}}

  async function createPatch(){if(!isOwner())return alert('Only the Owner can create patches.');const name=prompt('Patch name:');if(name===null)return;const clean=name.trim();if(!clean)return;const id=clean.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)+'-'+Date.now().toString(36);await api('/rest/v1/patches',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,name:clean})});try{await api('/rest/v1/patch_inventories',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_id:id,patch_name:clean,inventory:{accessPoints:[],history:[]}})});}catch(e){await api(`/rest/v1/patches?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});throw e;}await reload();}
  async function renamePatch(id){if(!isOwner())return alert('Only the Owner can rename patches.');const p=state.patches.find(x=>x.id===id);const name=prompt('Patch name:',p?.name||'');if(name===null)return;const clean=name.trim();if(!clean)return;await api(`/rest/v1/patches?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({name:clean})});await api(`/rest/v1/patch_inventories?patch_id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_name:clean})});await reload();}
  async function deletePatch(id){if(!isOwner())return alert('Only the Owner can delete patches.');if(state.patches.length<=1)return alert('You must keep at least one patch.');const p=state.patches.find(x=>x.id===id);if(!p||!confirm(`Delete patch "${p.name}"?`))return;await api(`/rest/v1/patches?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});await reload();}
  window.createPatch=createPatch; window.renamePatch=renamePatch; window.deletePatch=deletePatch;

  async function createUser(){
    const form=$('#createUserForm'); if(!form)return;
    const fd=new FormData(form); const body={name:String(fd.get('name')||'').trim(),employee_number:String(fd.get('employee_number')||'').trim(),login_code:String(fd.get('login_code')||'').trim(),password:String(fd.get('password')||''),role:String(fd.get('role')||'user'),patch_id:String(fd.get('patch_id')||'')};
    if(!body.name||!body.employee_number||!body.login_code||body.password.length<10||!body.patch_id)return alert('Complete all fields. Temporary password must be at least 10 characters.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.login_code))return alert('Login & Recovery Email must be a valid email address.');
    if(!isOwner())body.role='user';
    try{const r=await edge('admin-create-user',body,true);alert(`User created: ${r.name} (${r.login_code})`);await loadAdminData();renderAdmin();}catch(e){alert(e.message||'Could not create user.');}
  }

  async function changeUserLoginEmail(id,currentEmail,name){
    if(!isOwner()) return alert('Only the Owner can change another user\'s login email.');
    const email=prompt(`New login & recovery email for ${name||'user'}:`,currentEmail||'');
    if(email===null) return;
    const clean=email.trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(clean)) return alert('Please enter a valid email address.');
    try{
      await edge('account-recovery',{action:'set_user_email',user_id:id,email:clean},true);
      await loadAdminData();
      renderAdmin();
      alert('Login and recovery email updated.');
    }catch(e){alert(e.message||'Could not change login email.');}
  }

  async function deleteUser(id){
    if(!isOwner() && !state.users.find(u=>u.id===id && u.role==='user')) return alert('You do not have permission to delete this account.');
    if(!confirm('Delete this account permanently?')) return;
    try{
      const b=document.querySelector(`[data-delete-user=\"${CSS.escape(id)}\"]`); if(b){b.disabled=true;b.textContent='Deleting…';}
      const r=await edge('admin-delete-user',{user_id:id},true);
      await loadAdminData();
      renderAdmin();
      alert(`Deleted ${r.deleted_name||'user'}.`);
    }catch(e){
      await loadAdminData().catch(()=>{});
      renderAdmin();
      alert(e.message||'Could not delete user.');
    }
  }

  async function openFlyTipReport(){
    state.currentView='flytip'; nav('navHome');
    const p=state.patches.find(x=>String(x.id)===String(state.currentPatchId));
    const inv=p?patchInventory(p.id):{accessPoints:[]};
    const accessPoints=inv.accessPoints||[];
    if(!p) return alert('Please select a patch before reporting a fly tip.');
    $('#view').innerHTML=`<div class="queue-head"><button class="back" id="flyTipBack">← Back to Asset Finder</button><div><div class="section-title">Report Fly Tip</div><div class="sub">Report the location and access point so the admin team can investigate it.</div></div></div>
      <div class="card"><form class="form two" id="flyTipForm">
        <div class="field full"><label>Access Point Name *</label><select id="flyTipAccess" required><option value="">Select access point</option>${accessPoints.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field full"><label>What3Words</label><input id="flyTipW3" placeholder="e.g. filled.count.soap"><div class="small">Enter the ///What3Words location, or use the map below.</div></div>
        <div class="field full"><label>Map Location</label><div class="af358-loc-actions"><button type="button" class="btn secondary" id="flyTipMapBtn">📍 Pin Location on Map</button><span id="flyTipCoords" class="af358-coords">No map location selected</span></div><input type="hidden" id="flyTipLat"><input type="hidden" id="flyTipLng"><div class="af358-location-note">You only need one location method: What3Words or a map pin.</div></div>
        <div class="field full"><label>Description *</label><textarea id="flyTipDescription" required placeholder="Describe the fly tip, waste type, approximate size and any hazards..."></textarea></div>
        <div class="field full"><label>Photos (optional)</label><input id="flyTipPhotos" type="file" accept="image/*" multiple><div class="small">You can add up to 5 photos. Images are resized before being stored.</div></div>
        <div class="actions full"><button type="button" class="btn light" id="flyTipCancel">Cancel</button><button class="btn primary">🗑 Submit Fly Tip Report</button></div>
      </form></div>`;
    $('#flyTipBack').onclick=renderHome; $('#flyTipCancel').onclick=renderHome;
    $('#flyTipMapBtn').onclick=()=>showMapPicker($('#flyTipLat').value,$('#flyTipLng').value,(lat,lng)=>{ $('#flyTipLat').value=lat; $('#flyTipLng').value=lng; $('#flyTipCoords').textContent=`${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`; },'Pin Fly Tip Location');
    $('#flyTipForm').onsubmit=e=>{e.preventDefault();submitFlyTipReport();};
  }

  async function resizeReportPhoto(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader(); reader.onload=()=>{const img=new Image(); img.onload=()=>{const max=1280; const scale=Math.min(1,max/Math.max(img.width,img.height)); const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale)); const c=document.createElement('canvas'); c.width=w;c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); resolve(c.toDataURL('image/jpeg',0.78));}; img.onerror=reject; img.src=String(reader.result);}; reader.onerror=reject; reader.readAsDataURL(file);
    });
  }

  async function submitFlyTipReport(){
    const patchId=state.currentPatchId, accessId=$('#flyTipAccess')?.value, access=patchInventory(patchId).accessPoints.find(a=>String(a.id)===String(accessId));
    const w3=normaliseW3($('#flyTipW3')?.value||''); const lat=$('#flyTipLat')?.value, lng=$('#flyTipLng')?.value; const description=String($('#flyTipDescription')?.value||'').trim();
    if(!access) return alert('Please select the access point name.');
    if(!w3 && !validCoords(lat,lng)) return alert('Please enter a What3Words location or pin the fly tip on the map.');
    if(!description) return alert('Please describe the fly tip.');
    const files=[...($('#flyTipPhotos')?.files||[])].slice(0,5);
    try{
      const photos=[]; for(const f of files){ if(!f.type.startsWith('image/')) continue; const data=await resizeReportPhoto(f); if(data.length>700000) throw new Error('One of the photos could not be compressed enough. Please choose smaller images.'); photos.push(data); }
      await api('/rest/v1/fly_tip_reports',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_id:patchId,access_point_id:String(access.id),access_point_name:access.name,what3words:w3||null,latitude:validCoords(lat,lng)?Number(lat):null,longitude:validCoords(lat,lng)?Number(lng):null,description,photos,created_by:state.profile.id,created_by_name:state.profile.name,created_by_employee_number:state.profile.employee_number,status:'new'})});
      await loadUserRequests();
      $('#view').innerHTML=`<div class="card af37-success"><div class="af37-success-icon">✓</div><div class="section-title">Fly Tip Reported</div><p>Thank you for your report. It has been sent to the admin team for review.</p><button class="btn primary" id="flyTipDone">Back to Asset Finder</button></div>`;
      $('#flyTipDone').onclick=renderHome;
    }catch(e){alert(e.message||'Could not submit the fly tip report.');}
  }

  async function openScrapReport(){
    state.currentView='scrap'; nav('navHome');
    const p=state.patches.find(x=>String(x.id)===String(state.currentPatchId));
    const inv=p?patchInventory(p.id):{accessPoints:[]}; const accessPoints=inv.accessPoints||[];
    if(!p) return alert('Please select a patch before reporting scrap.');
    $('#view').innerHTML=`<div class="queue-head"><button class="back" id="scrapBack">← Back to Asset Finder</button><div><div class="section-title">Report Scrap</div><div class="sub">Report scrap found at an access point so the admin team can investigate and arrange removal.</div></div></div>
      <div class="card"><form class="form two" id="scrapForm">
        <div class="field full"><label>Access Point Name *</label><select id="scrapAccess" required><option value="">Select access point</option>${accessPoints.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Scrap Type</label><select id="scrapType"><option value="General scrap">General scrap</option><option value="Metal">Metal</option><option value="Cable">Cable</option><option value="Rail">Rail</option><option value="Bearers / Sleepers">Bearers / Sleepers</option><option value="Other">Other</option></select></div>
        <div class="field"><label>Approximate Amount</label><input id="scrapAmount" placeholder="e.g. 2 bags / 1 pile"></div>
        <div class="field full"><label>What3Words</label><input id="scrapW3" placeholder="e.g. filled.count.soap"><div class="small">Enter the ///What3Words location, or use the map below.</div></div>
        <div class="field full"><label>Map Location</label><div class="af358-loc-actions"><button type="button" class="btn secondary" id="scrapMapBtn">📍 Pin Location on Map</button><span id="scrapCoords" class="af358-coords">No map location selected</span></div><input type="hidden" id="scrapLat"><input type="hidden" id="scrapLng"><div class="af358-location-note">You only need one location method: What3Words or a map pin.</div></div>
        <div class="field full"><label>Description *</label><textarea id="scrapDescription" required placeholder="Describe what scrap is present, where it is and any hazards..."></textarea></div>
        <div class="field full"><label>Photos (optional)</label><input id="scrapPhotos" type="file" accept="image/*" multiple><div class="small">You can add up to 5 photos. Images are resized before being stored.</div></div>
        <div class="actions full"><button type="button" class="btn light" id="scrapCancel">Cancel</button><button class="btn primary">♻ Submit Scrap Report</button></div>
      </form></div>`;
    $('#scrapBack').onclick=renderHome; $('#scrapCancel').onclick=renderHome;
    $('#scrapMapBtn').onclick=()=>showMapPicker($('#scrapLat').value,$('#scrapLng').value,(lat,lng)=>{ $('#scrapLat').value=lat; $('#scrapLng').value=lng; $('#scrapCoords').textContent=`${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`; },'Pin Scrap Location');
    $('#scrapForm').onsubmit=e=>{e.preventDefault();submitScrapReport();};
  }

  async function submitScrapReport(){
    const patchId=state.currentPatchId, accessId=$('#scrapAccess')?.value, access=patchInventory(patchId).accessPoints.find(a=>String(a.id)===String(accessId));
    const w3=normaliseW3($('#scrapW3')?.value||''); const lat=$('#scrapLat')?.value, lng=$('#scrapLng')?.value; const description=String($('#scrapDescription')?.value||'').trim();
    if(!access) return alert('Please select the access point name.');
    if(!w3 && !validCoords(lat,lng)) return alert('Please enter a What3Words location or pin the scrap on the map.');
    if(!description) return alert('Please describe the scrap.');
    const files=[...($('#scrapPhotos')?.files||[])].slice(0,5);
    try{ const photos=[]; for(const f of files){ if(!f.type.startsWith('image/')) continue; const data=await resizeReportPhoto(f); if(data.length>700000) throw new Error('One of the photos could not be compressed enough. Please choose smaller images.'); photos.push(data); }
      await api('/rest/v1/scrap_reports',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({patch_id:patchId,access_point_id:String(access.id),access_point_name:access.name,scrap_type:$('#scrapType')?.value||'General scrap',approximate_amount:$('#scrapAmount')?.value?.trim()||null,what3words:w3||null,latitude:validCoords(lat,lng)?Number(lat):null,longitude:validCoords(lat,lng)?Number(lng):null,description,photos,created_by:state.profile.id,created_by_name:state.profile.name,created_by_employee_number:state.profile.employee_number,status:'new'})});
      await loadUserRequests(); $('#view').innerHTML=`<div class="card af37-success"><div class="af37-success-icon">✓</div><div class="section-title">Scrap Reported</div><p>Thank you for your report. It has been sent to the admin team for review.</p><button class="btn primary" id="scrapDone">Back to Asset Finder</button></div>`; $('#scrapDone').onclick=renderHome;
    }catch(e){alert(e.message||'Could not submit the scrap report.');}
  }

  async function openScrapReports(){ state.currentView='admin'; state.adminSubView='scrap'; nav('navAdmin'); try { state.scrapReports=await api('/rest/v1/scrap_reports?select=*&order=created_at.desc'); } catch(e){state.scrapReports=[]; throw e;} renderScrapReports(); }
  function scrapStatusBadge(s){ const t=String(s||'new'); const cls=t==='in_progress'?'planned':'defective'; return `<span class="badge ${cls}">${esc(t==='in_progress'?'In Progress':'New')}</span>`; }
  function renderScrapReportCard(r,inProgress=false){
    const patchName=state.patches.find(p=>String(p.id)===String(r.patch_id))?.name||'—';
    const location=`${r.what3words?`What3Words ${esc(r.what3words)}`:''}${r.what3words&&validCoords(r.latitude,r.longitude)?' · ':''}${validCoords(r.latitude,r.longitude)?`${esc(Number(r.latitude).toFixed(6))}, ${esc(Number(r.longitude).toFixed(6))}`:''}`||'—';
    const actions=inProgress?`<button class="btn primary" data-scrap-status="resolved" data-scrap-id="${esc(r.id)}">Complete and Delete</button><button class="btn light" data-scrap-status="new" data-scrap-id="${esc(r.id)}">Return to New</button>`:`<button class="btn secondary" data-scrap-status="in_progress" data-scrap-id="${esc(r.id)}">Mark In Progress</button><button class="btn primary" data-scrap-status="resolved" data-scrap-id="${esc(r.id)}">Complete and Delete</button>`;
    return `<div class="card af-flytip-card ${inProgress?'af-flytip-inprogress':''}"><div class="cardhead"><div><div class="title">${esc(r.access_point_name||'Access Point')}</div><div class="sub">${esc(r.scrap_type||'General scrap')}${r.approximate_amount?` · ${esc(r.approximate_amount)}`:''} · ${esc(r.created_at?new Date(r.created_at).toLocaleString():'—')} · Patch: ${esc(patchName)}</div><div class="sub">Location: ${location}</div><div class="sub" style="margin-top:8px">${esc(r.description||'')}</div>${r.photos?.length?`<div class="photo-grid">${r.photos.slice(0,5).map(p=>`<img class="asset-photo" src="${esc(p)}" alt="Scrap photo">`).join('')}</div>`:''}</div><div>${scrapStatusBadge(r.status)}</div></div><div class="actions">${actions}</div></div>`;
  }
  function renderScrapReports(){
    state.currentView='admin'; state.adminSubView='scrap'; nav('navAdmin'); const rows=Array.isArray(state.scrapReports)?state.scrapReports:[]; const newRows=rows.filter(r=>String(r.status)==='new'); const progressRows=rows.filter(r=>String(r.status)==='in_progress');
    $('#view').innerHTML=`<div class="queue-head"><button class="back" id="scrapAdminBack">← Back to Admin</button><div><div class="section-title">Scrap Reports <span class="pill" style="margin-left:8px">${newRows.length} new</span></div><div class="sub">New reports and reports currently being dealt with are kept in separate sections.</div></div><button class="btn light" id="refreshScrap" type="button">↻ Refresh</button></div>${newRows.length?`<div class="af-flytip-section"><div class="af-flytip-section-title">🔴 New Scrap Reports <span>${newRows.length}</span></div>${newRows.map(r=>renderScrapReportCard(r,false)).join('')}</div>`:`<div class="card empty"><b>No new scrap reports</b><span>New scrap reports submitted by users will appear here.</span></div>`}${progressRows.length?`<div class="af-flytip-section af-flytip-progress-section"><div class="af-flytip-section-title">🟡 In Progress <span>${progressRows.length}</span></div>${progressRows.map(r=>renderScrapReportCard(r,true)).join('')}</div>`:''}`;
    $('#scrapAdminBack').onclick=renderAdmin; $('#refreshScrap').onclick=()=>openScrapReports().catch(e=>alert(e.message)); document.querySelectorAll('[data-scrap-status]').forEach(b=>b.onclick=()=>updateScrapStatus(b.dataset.scrapId,b.dataset.scrapStatus)); updateApprovalBadge();
  }
  async function updateScrapStatus(id,status){ if(!isAdmin())return; try{ if(status==='resolved'){ if(!confirm('Complete this scrap report and permanently delete it? This cannot be undone.'))return; const deleted=await api(`/rest/v1/scrap_reports?id=eq.${encodeURIComponent(id)}&select=id`,{method:'DELETE',headers:{Prefer:'return=representation'}}); if(!Array.isArray(deleted)||deleted.length===0) throw new Error('The scrap report could not be deleted. Please refresh Asset Finder and try again.'); } else { await api(`/rest/v1/scrap_reports?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,reviewed_by:state.profile.id,reviewed_at:now(),completed_by_name:state.profile.name,completed_by_employee_number:state.profile.employee_number})}); } await openScrapReports(); }catch(e){alert(e.message||'Could not update scrap report.');} }

  async function openFlyTipReports(){ state.currentView='admin'; state.adminSubView='flytips'; try { state.flyTipReports = await api('/rest/v1/fly_tip_reports?select=*&order=created_at.desc'); } catch(e) { state.flyTipReports=[]; throw e; } renderFlyTipReports(); }
  function flyTipStatusBadge(s){ const t=String(s||'new'); const cls=t==='in_progress'?'planned':'defective'; return `<span class="badge ${cls}">${esc(t==='in_progress'?'In Progress':'New')}</span>`; }
  function renderFlyTipReportCard(r, inProgress=false){
    const patchName=state.patches.find(p=>String(p.id)===String(r.patch_id))?.name || '—';
    const location=`${r.what3words?`What3Words ${esc(r.what3words)}`:''}${r.what3words&&validCoords(r.latitude,r.longitude)?' · ':''}${validCoords(r.latitude,r.longitude)?`${esc(Number(r.latitude).toFixed(6))}, ${esc(Number(r.longitude).toFixed(6))}`:''}` || '—';
    const actions=inProgress
      ? `<button class="btn primary" data-flytip-status="resolved" data-flytip-id="${esc(r.id)}">Complete and Delete</button><button class="btn light" data-flytip-status="new" data-flytip-id="${esc(r.id)}">Return to New</button>`
      : `<button class="btn secondary" data-flytip-status="in_progress" data-flytip-id="${esc(r.id)}">Mark In Progress</button><button class="btn primary" data-flytip-status="resolved" data-flytip-id="${esc(r.id)}">Complete and Delete</button>`;
    return `<div class="card af-flytip-card ${inProgress?'af-flytip-inprogress':''}"><div class="cardhead"><div><div class="title">${esc(r.access_point_name||'Access Point')}</div><div class="sub">${esc(r.created_at?new Date(r.created_at).toLocaleString():'—')} · Patch: ${esc(patchName)}</div><div class="sub">Location: ${location}</div><div class="sub" style="margin-top:8px">${esc(r.description||'')}</div>${r.photos?.length?`<div class="photo-grid">${r.photos.slice(0,5).map(p=>`<img class="asset-photo" src="${esc(p)}" alt="Fly tip photo">`).join('')}</div>`:''}</div><div>${flyTipStatusBadge(r.status)}</div></div><div class="actions">${actions}</div></div>`;
  }
  function renderFlyTipReports(){
    state.currentView='admin'; state.adminSubView='flytips'; nav('navAdmin'); const rows=Array.isArray(state.flyTipReports)?state.flyTipReports:[];
    const newRows=rows.filter(r=>String(r.status)==='new');
    const progressRows=rows.filter(r=>String(r.status)==='in_progress');
    $('#view').innerHTML=`<div class="queue-head"><button class="back" id="flyTipAdminBack">← Back to Admin</button><div><div class="section-title">Fly Tip Reports <span class="pill" style="margin-left:8px" id="flyTipCount">${newRows.length} new</span></div><div class="sub">New reports and reports currently being dealt with are kept in separate sections.</div></div><button class="btn light" id="refreshFlyTips" type="button">↻ Refresh</button></div>${newRows.length?`<div class="af-flytip-section"><div class="af-flytip-section-title">🔴 New Reports <span>${newRows.length}</span></div>${newRows.map(r=>renderFlyTipReportCard(r,false)).join('')}</div>`:`<div class="card empty"><b>No new fly tip reports</b><span>New reports submitted by users will appear here.</span></div>`}${progressRows.length?`<div class="af-flytip-section af-flytip-progress-section"><div class="af-flytip-section-title">🟡 In Progress <span>${progressRows.length}</span></div>${progressRows.map(r=>renderFlyTipReportCard(r,true)).join('')}</div>`:''}`;
    $('#flyTipAdminBack').onclick=renderAdmin; $('#refreshFlyTips').onclick=()=>openFlyTipReports().catch(e=>alert(e.message));
    document.querySelectorAll('[data-flytip-status]').forEach(b=>b.onclick=()=>updateFlyTipStatus(b.dataset.flytipId,b.dataset.flytipStatus)); updateApprovalBadge();
  }
  async function updateFlyTipStatus(id,status){
    if(!isAdmin()) return;
    try{
      if(status==='resolved'){
        if(!confirm('Complete this fly tip report and permanently delete it? This cannot be undone.')) return;
        const deleted=await api(`/rest/v1/fly_tip_reports?id=eq.${encodeURIComponent(id)}&select=id`,{method:'DELETE',headers:{Prefer:'return=representation'}});
        if(!Array.isArray(deleted) || deleted.length===0){
          throw new Error('The report could not be deleted. Please refresh Asset Finder and try again.');
        }
      }else{
        await api(`/rest/v1/fly_tip_reports?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,reviewed_by:state.profile.id,reviewed_at:now(),completed_by_name:state.profile.name,completed_by_employee_number:state.profile.employee_number})});
      }
      await loadAdminData();
      await openFlyTipReports();
    }catch(e){alert(e.message||'Could not update fly tip report.');}
  }

  function renderAdmin(){
    state.currentView='admin'; state.adminSubView='admin'; nav('navAdmin');
    const patchOptions=state.patches.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const userRows=state.users.filter(u=>u.id!==state.profile.id).map(u=>{const patchIds=state.assignments.filter(a=>a.user_id===u.id).map(a=>a.patch_id);const patches=patchIds.map(id=>state.patches.find(p=>p.id===id)?.name||id).join(', ')||'—';const canDelete=isOwner()?u.role!=='owner':(u.role==='user'&&patchIds.some(id=>state.assignments.some(a=>a.user_id===state.profile.id&&a.patch_id===id)));const canEditEmail=isOwner();return `<div class="card"><div class="cardhead"><div><div class="title">${esc(u.name)} · ${esc(roleLabel(u.role))}</div><div class="sub">Employee: ${esc(u.employee_number)} · Email: ${esc(u.login_code)}</div><div class="sub">Patch: ${esc(patches)} · Status: ${esc(u.status)}</div></div><div class="actions">${canEditEmail?`<button type="button" class="btn light" data-edit-user-email="${esc(u.id)}" data-user-email="${esc(u.login_code||'')}" data-user-name="${esc(u.name||'User')}">Change Email</button>`:''}${canDelete?`<button type="button" class="btn danger" data-delete-user="${esc(u.id)}">Delete</button>`:''}</div></div></div>`;}).join('');
    const pendingApprovalCount=state.approvals.filter(x=>x.status==='pending').length;
    const pendingRemovalCount=state.removalRequests.filter(x=>x.status==='pending').length;
    const pendingFlyTipCount=state.flyTipReports.filter(x=>x.status==='new').length;
    const pendingScrapCount=state.scrapReports.filter(x=>x.status==='new').length;
    $('#view').innerHTML=`<div class="af38-admin-head"><div><div class="af35-kicker">ADMINISTRATION</div><div class="af38-admin-title">Admin Dashboard</div><div class="af38-admin-sub">Review requests and manage patch activity from one place.</div></div>${isOwner()?'<button class="btn primary" id="createPatchBtn">＋ Create Patch</button>':''}</div>
      <div class="af38-admin-panel"><div class="af38-admin-panel-head"><div><div class="title">Patch Administration</div><div class="sub">Review and manage items for your patch.</div></div><div class="af38-admin-total">${pendingApprovalCount+pendingRemovalCount+pendingFlyTipCount+pendingScrapCount} pending</div></div>
      <div class="af38-admin-grid">
        <button type="button" class="af38-admin-card approval" id="approvalsBtn"><span class="af38-admin-icon">📄</span><span class="af38-admin-card-title">Pending Asset Approvals</span><span class="af38-admin-card-sub">Review new asset additions</span><span class="af38-admin-count">${pendingApprovalCount}</span></button>
        <button type="button" class="af38-admin-card removal" id="removalsBtn"><span class="af38-admin-icon">🗑</span><span class="af38-admin-card-title">Removal Requests</span><span class="af38-admin-card-sub">Review asset removal requests</span><span class="af38-admin-count">${pendingRemovalCount}</span></button>
        <button type="button" class="af38-admin-card flytip" id="flyTipReportsBtn"><span class="af38-admin-icon">🗑</span><span class="af38-admin-card-title">Fly Tip Reports</span><span class="af38-admin-card-sub">View and manage fly tip reports</span><span class="af38-admin-count">${pendingFlyTipCount}</span></button>
        <button type="button" class="af38-admin-card scrap" id="scrapReportsBtn"><span class="af38-admin-icon">♻</span><span class="af38-admin-card-title">Scrap Reports</span><span class="af38-admin-card-sub">View and manage scrap reports</span><span class="af38-admin-count">${pendingScrapCount}</span></button>
      </div></div>
      ${isOwner()?`<div class="card"><div class="title">Patch Management</div>${state.patches.map(p=>`<div class="cardhead" style="margin-top:8px"><div><b>${esc(p.name)}</b></div><div class="actions"><button class="btn light" data-rename-patch="${esc(p.id)}">Rename</button><button class="btn danger" data-delete-patch="${esc(p.id)}">Delete</button></div></div>`).join('')}</div>`:''}
      <div class="card af38-create-user-card"><div class="title">Create User</div><form id="createUserForm" class="form two"><div class="field"><label>Name *</label><input name="name" required></div><div class="field"><label>Employee Number *</label><input name="employee_number" required></div><div class="field"><label>Email Address (Login & Recovery) *</label><input name="login_code" type="email" autocomplete="email" required></div><div class="field"><label>Temporary Password *</label><input name="password" minlength="10" required></div><div class="field"><label>Role</label><select name="role" ${isOwner()?'':'disabled'}><option value="user">User</option>${isOwner()?'<option value="patch_admin">Patch Admin</option>':''}</select></div><div class="field"><label>Patch *</label><select name="patch_id" required>${patchOptions}</select></div><div class="actions full"><button class="btn primary">Create User</button></div></form></div>
      <div><div class="section-title">Users</div>${userRows||'<div class="card empty"><b>No other users</b></div>'}</div>`;
    $('#createPatchBtn')?.addEventListener('click',()=>createPatch().catch(e=>alert(e.message)));
    $('#approvalsBtn').onclick=()=>openApprovals().catch(e=>alert(e.message));
    $('#removalsBtn').onclick=()=>openRemovalRequests().catch(e=>alert(e.message));
    $('#flyTipReportsBtn').onclick=()=>openFlyTipReports().catch(e=>alert(e.message));
    $('#scrapReportsBtn').onclick=()=>openScrapReports().catch(e=>alert(e.message));
    updateApprovalBadge();
    $('#createUserForm').onsubmit=e=>{e.preventDefault();createUser();};
    $('#view').onclick=async (ev)=>{
      const b=ev.target.closest('button'); if(!b) return;
      try{
        if(b.dataset.deleteUser){ await deleteUser(b.dataset.deleteUser); return; }
        if(b.dataset.editUserEmail){ await changeUserLoginEmail(b.dataset.editUserEmail,b.dataset.userEmail,b.dataset.userName); return; }
        if(b.dataset.renamePatch){ await renamePatch(b.dataset.renamePatch); return; }
        if(b.dataset.deletePatch){ await deletePatch(b.dataset.deletePatch); return; }
      }catch(e){ alert(e.message||'Operation failed.'); }
    };
  }
  window.renderAdminPanel=renderAdmin;

  async function openApprovals(){ state.currentView='admin'; state.adminSubView='approvals'; await loadAdminData(); renderApprovals(); }
  async function openRemovalRequests(){ state.currentView='admin'; state.adminSubView='removals'; await loadAdminData(); renderRemovalRequests(); }
  window.openFlyTipReports=openFlyTipReports; window.openFlyTipReport=openFlyTipReport;
  function renderApprovals(){state.currentView='admin';state.adminSubView='approvals';nav('navAdmin');const rows=pendingApprovals();$('#view').innerHTML=`<div class="queue-head"><button class="back" id="adminBack">← Back to Admin</button><div><div class="section-title">Pending Asset Approvals <span class="pill" style="margin-left:8px" id="queueTypeCount">${rows.length} pending</span></div><div class="sub">This queue stays open while live notifications update in the background.</div></div><button class="btn light" id="refreshApprovalQueue" type="button">↻ Refresh</button></div>${rows.length?rows.map(r=>`<div class="card"><div class="title">${esc(r.asset_data?.type||'Asset')}</div><div class="sub">Patch: ${esc(state.patches.find(p=>p.id===r.patch_id)?.name||r.patch_id)} · Access: ${esc(r.access_point_name)}</div><div class="sub">SC: ${esc(r.asset_data?.sc||'—')} · Points: ${esc(r.asset_data?.points||'—')}</div><div class="af-audit"><b>Submitted by:</b> ${esc(r.asset_data?.submittedByName||personName(r.requested_by))}${r.asset_data?.submittedByEmployeeNumber?` · ${esc(r.asset_data.submittedByEmployeeNumber)}`:''} · ${esc(r.created_at?new Date(r.created_at).toLocaleString():'—')}</div><div class="actions"><button class="btn primary" data-approve="${esc(r.id)}">Approve</button><button class="btn danger" data-reject="${esc(r.id)}">Reject</button></div></div>`).join(''):`<div class="card empty"><b>No pending asset approvals</b><span>New submissions will appear here automatically.</span></div>`}`;$('#adminBack').onclick=renderAdmin;$('#refreshApprovalQueue').onclick=()=>openApprovals().catch(e=>alert(e.message));document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>decideApproval(b.dataset.approve,'approved'));document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>decideApproval(b.dataset.reject,'rejected'));updateApprovalBadge();}
  async function decideApproval(id,status){const r=state.approvals.find(x=>String(x.id)===String(id));if(!r)return; if(status==='approved'){await mutateInventory(r.patch_id,inv=>{const ap=inv.accessPoints.find(x=>String(x.id)===String(r.access_point_id));if(!ap)throw new Error('The access point no longer exists.');ap.assets=ap.assets||[];if(!ap.assets.some(a=>String(a.id)===String(r.asset_data?.id))){ const submitted={...r.asset_data}; submitted.submittedById=submitted.submittedById||r.requested_by; submitted.submittedByName=submitted.submittedByName||personName(r.requested_by); submitted.submittedByEmployeeNumber=submitted.submittedByEmployeeNumber||profileFor(r.requested_by)?.employee_number||''; submitted.submittedAt=submitted.submittedAt||r.created_at||now(); submitted.approvedById=state.profile.id; submitted.approvedByName=state.profile.name; submitted.approvedByEmployeeNumber=state.profile.employee_number; submitted.approvedAt=now(); ap.assets.push(submitted); }});}await api(`/rest/v1/asset_approvals?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,reviewed_by:state.profile.id,reviewed_at:now(),approved_by_name:status==='approved'?state.profile.name:null,approved_by_employee_number:status==='approved'?state.profile.employee_number:null})});await loadAdminData();renderApprovals();}

  function renderRemovalRequests(){state.currentView='admin';state.adminSubView='removals';nav('navAdmin');const rows=pendingRemovals();$('#view').innerHTML=`<div class="queue-head"><button class="back" id="remBack">← Back to Admin</button><div><div class="section-title">Removal Requests <span class="pill" style="margin-left:8px" id="queueTypeCount">${rows.length} pending</span></div><div class="sub">This queue stays open while live notifications update in the background.</div></div><button class="btn light" id="refreshRemovalQueue" type="button">↻ Refresh</button></div>${rows.length?rows.map(r=>`<div class="card"><div class="title">${esc(r.asset_data?.type||'Asset')}</div><div class="sub">Patch: ${esc(state.patches.find(p=>p.id===r.patch_id)?.name||r.patch_id)} · Access: ${esc(r.access_point_name)}</div><div class="sub">SC: ${esc(r.asset_data?.sc||'—')} · Points: ${esc(r.asset_data?.points||'—')}${r.asset_data?.type==='Ballast'&&r.asset_data?._removalAmountTons?` · Remove: ${esc(r.asset_data._removalAmountTons)} t`:r.asset_data?._removalQuantity?` · Remove: ${esc(r.asset_data._removalQuantity)} unit${Number(r.asset_data._removalQuantity)===1?'':'s'}`:''}</div><div class="sub">Work Order: ${esc(r.asset_data?._workOrderNumber||'—')} · Requested by: ${esc(r.asset_data?._requestedByName||'—')}${r.asset_data?._requestedByEmployeeNumber?` · Employee: ${esc(r.asset_data._requestedByEmployeeNumber)}`:''}</div><div class="actions"><button class="btn primary" data-approve-removal="${esc(r.id)}">Approve</button><button class="btn danger" data-reject-removal="${esc(r.id)}">Reject</button></div></div>`).join(''):`<div class="card empty"><b>No pending removal requests</b></div>`}`;$('#remBack').onclick=renderAdmin;$('#refreshRemovalQueue').onclick=()=>openRemovalRequests().catch(e=>alert(e.message));document.querySelectorAll('[data-approve-removal]').forEach(b=>b.onclick=()=>decideRemoval(b.dataset.approveRemoval,'approved'));document.querySelectorAll('[data-reject-removal]').forEach(b=>b.onclick=()=>decideRemoval(b.dataset.rejectRemoval,'rejected'));updateApprovalBadge();}
  async function decideRemoval(id,status){
    const r=state.removalRequests.find(x=>String(x.id)===String(id));if(!r)return;
    if(status==='approved'){
      await mutateInventory(r.patch_id,inv=>{
        const ap=inv.accessPoints.find(x=>String(x.id)===String(r.access_point_id));if(!ap)throw new Error('The access point no longer exists.');
        const i=(ap.assets||[]).findIndex(x=>String(x.id)===String(r.asset_id));if(i<0)throw new Error('The asset is already gone.');
        const currentAsset=ap.assets[i];
        const audit={workOrderNumber:r.asset_data?._workOrderNumber||'',removedById:r.requested_by||null,removedByName:r.asset_data?._requestedByName||'Unknown user',removedByEmployeeNumber:r.asset_data?._requestedByEmployeeNumber||'',approvedById:state.profile.id,approvedByName:state.profile.name||'Unknown user',approvedByEmployeeNumber:state.profile.employee_number||''};
        if(currentAsset.type==='Ballast'){
          const qty=Number(r.asset_data?._removalAmountTons||0);const current=Number(currentAsset.ballastAmountTons||0);
          if(!(qty>0)||qty>current)throw new Error('Invalid ballast removal amount.');
          currentAsset.ballastAmountTons=Number((current-qty).toFixed(3));
          inv.history.unshift({...currentAsset,id:uid(),ballastAmountTons:qty,removedAmountTons:qty,originalBallastAmountTons:current,removed:Date.now(),accessPointId:ap.id,accessPointName:ap.name,...audit,status:'Removed'});
          if(currentAsset.ballastAmountTons<=0.000001)ap.assets.splice(i,1);
        } else if(Number(r.asset_data?._removalQuantity||0)>0 && Number(currentAsset.quantity??currentAsset.amount??0)>0){
          const current=Number(currentAsset.quantity??currentAsset.amount??0);const qty=Number(r.asset_data._removalQuantity);
          if(!Number.isInteger(qty)||qty<1||qty>current)throw new Error(`Invalid removal quantity. Available: ${current}.`);
          inv.history.unshift({...currentAsset,id:uid(),quantity:qty,amount:qty,removedQuantity:qty,originalQuantity:current,removed:Date.now(),accessPointId:ap.id,accessPointName:ap.name,...audit,status:'Removed'});
          const remaining=current-qty;
          if(remaining<=0)ap.assets.splice(i,1);else{currentAsset.quantity=remaining;currentAsset.amount=remaining;}
        } else {
          const [asset]=ap.assets.splice(i,1);
          inv.history.unshift({...asset,removed:Date.now(),accessPointId:ap.id,accessPointName:ap.name,...audit,status:'Removed'});
        }
      });
    }
    await api(`/rest/v1/asset_removal_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,reviewed_by:state.profile.id,reviewed_at:now()})});
    await loadAdminData();renderRemovalRequests();
  }

  function startSessionMaintenance(){
    const refresh=()=>{ if(state.session?.refresh_token) refreshAuthSession().catch(()=>{}); };
    setInterval(refresh, 15*60*1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) refresh();});
    let lastY=window.scrollY||0; let ticking=false;
    window.addEventListener('scroll',()=>{
      if(ticking) return; ticking=true;
      requestAnimationFrame(()=>{
        const top=document.querySelector('.top');
        if(window.innerWidth<=700 && top){ const y=Math.max(0,window.scrollY||0); const delta=y-lastY; if(delta>8 && y>90) top.classList.add('af-hide-on-scroll'); else if(delta<-8 || y<24) top.classList.remove('af-hide-on-scroll'); lastY=y; }
        ticking=false;
      });
    },{passive:true});
  }

  function wireStatic(){
    $('#cloudLoginForm')?.addEventListener('submit',e=>{e.preventDefault();login($('#cloudCode').value,$('#cloudPassword').value);});
    $('#cloudChangeForm')?.addEventListener('submit',e=>{e.preventDefault();changePassword();});
    $('#cloudRecoveryForm')?.addEventListener('submit',e=>{e.preventDefault();submitRecovery();});
    $('#backToLogin')?.addEventListener('click',()=>showLoginForm());
    const forgot=document.createElement('button'); forgot.type='button'; forgot.className='btn light'; forgot.textContent='Forgot password?'; forgot.style.width='100%'; forgot.style.marginTop='8px'; forgot.onclick=showRecoveryForm; $('#cloudLoginForm')?.appendChild(forgot);
    $('#navHome').onclick=()=>{state.currentView='home';renderHome()}; $('#navHistory').onclick=()=>{state.currentView='history';renderHistory()}; $('#navSettings').onclick=()=>{state.currentView='profile';renderProfile()}; $('#navAdmin').onclick=()=>{state.currentView='admin';renderAdmin()};
    window.addEventListener('beforeunload',()=>{});
    startSessionMaintenance();
  }

  async function bootstrap(){
    wireStatic(); setGate(true);
    const recovering=await handleRecoveryRedirect();
    if(recovering) return;
    const restored=await restoreAuthSession();
    if(restored && state.session?.access_token && state.profile){
      setGate(false);
      await loadAllData();
      await loadAppMeta();
      renderHome();
      mountAccountBar();
      renderStatusBar();
    } else {
      showLoginForm();
      $('#cloudCode')?.focus();
    }
  }


  function renderResponsiveHeader(){
    const mount=document.getElementById('af338HeaderMount'); if(!mount) return;
    if(!state.profile){mount.innerHTML='';return;}
    const latest=String(state.appMeta.latestVersion||APP_VERSION).replace(/^v/i,'').trim();
    const cur=String(APP_VERSION).replace(/^v/i,'').trim();
    const upToDate=!latest||latest===cur;
    const serverOk=!!state.appMeta.serverOk;
    const total=isAdmin()?pendingApprovals().length+pendingRemovals().length:0;
    const nav=[`<button data-h="home" class="${state.currentView==='home'?'on':''}">Home</button>`,`<button data-h="history" class="${state.currentView==='history'?'on':''}">History</button>`].join('');
    const adminNav=isAdmin()?`<button data-h="admin" class="${state.currentView==='admin'?'on':''}">Admin${total?`<span class="af35-badge-static">${total}</span>`:''}</button>`:'';
    const sync=serverOk&&upToDate?'Synced':serverOk?'Update':'Offline';
    mount.innerHTML=`<div class="af35-header" id="af35Header"><div class="af35-head-inner"><div class="af35-brand"><img src="logo.png" alt="Asset Finder"><div class="txt"><strong>Asset Finder</strong><small>Railway access points &amp; asset register</small></div></div><div class="af35-nav">${nav}${adminNav}</div><div class="af35-actions"><div class="af35-sync"><span class="af35-sync-dot"></span>${sync} <span>v${esc(cur)}</span></div><button class="af35-refresh" type="button" data-h-refresh aria-label="Refresh Asset Finder" title="Refresh live data">↻</button>${isAdmin()?`<button class="af35-bell" type="button" data-h-bell aria-label="Pending requests">🔔${total?`<span class="af35-badge">${total}</span>`:''}</button>`:''}<button class="af35-menu" type="button" data-h-menu aria-expanded="false">☰</button><div class="af35-user"><button data-h-profile>Profile</button><button class="af35-logout" data-h-logout>Log out</button></div><img class="af35-ogrt" src="ogrt-logo.png" alt="OGRT"></div><div class="af35-mobile-panel" data-h-panel hidden><button data-m="settings">⚙ Settings</button>${isAdmin()?'<button data-m="admin">🛠 Admin</button>':''}<button data-m="profile">◉ Profile</button><button data-m="logout">🚪 Log out</button></div></div></div>`;
    mount.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{const n=b.dataset.h;if(n==='home')renderHome();else if(n==='history'){state.currentView='history';renderHistory();}else if(n==='admin'){state.currentView='admin';renderAdmin();}});
    mount.querySelector('[data-h-profile]')?.addEventListener('click',()=>{state.currentView='profile';renderProfile();});
    mount.querySelector('[data-h-logout]')?.addEventListener('click',logout);
    mount.querySelector('[data-h-refresh]')?.addEventListener('click', async (e)=>{
      const btn=e.currentTarget;
      if(btn.dataset.refreshing==='1') return;
      btn.dataset.refreshing='1'; btn.setAttribute('aria-busy','true'); btn.classList.add('af-refreshing'); btn.textContent='↻';
      try{
        // Refresh live Supabase data first, then check whether a newer PWA build is available.
        await loadAllData();
        await loadAppMeta();
        if('serviceWorker' in navigator){
          const reg=await navigator.serviceWorker.getRegistration();
          if(reg) await reg.update();
        }
        renderCurrent();
      }catch(err){
        console.warn('Manual refresh failed',err);
        alert('Refresh failed. Please check your connection and try again.');
      }
    });
    mount.querySelector('[data-h-bell]')?.addEventListener('click',()=>{if(pendingApprovals().length)openApprovals().catch(e=>alert(e.message));else if(pendingRemovals().length)openRemovalRequests().catch(e=>alert(e.message));});
    const menu=mount.querySelector('[data-h-panel]'), btn=mount.querySelector('[data-h-menu]'); btn?.addEventListener('click',e=>{e.stopPropagation();if(menu){menu.hidden=!menu.hidden;btn.setAttribute('aria-expanded',String(!menu.hidden));}});
    menu?.querySelector('[data-m="settings"]')?.addEventListener('click',()=>{menu.hidden=true;state.currentView='profile';renderProfile();});
    menu?.querySelector('[data-m="admin"]')?.addEventListener('click',()=>{menu.hidden=true;state.currentView='admin';renderAdmin();});
    menu?.querySelector('[data-m="profile"]')?.addEventListener('click',()=>{menu.hidden=true;state.currentView='profile';renderProfile();});
    menu?.querySelector('[data-m="logout"]')?.addEventListener('click',()=>{menu.hidden=true;logout();});
    if(!state.af35HeaderOutsideClick){state.af35HeaderOutsideClick=true;document.addEventListener('click',e=>{const m=document.querySelector('[data-h-panel]'),b=document.querySelector('[data-h-menu]');if(m&&!m.hidden&&!m.contains(e.target)&&e.target!==b)m.hidden=true;});}
    if(!state.af35ScrollBound){state.af35ScrollBound=true;let last=window.scrollY||0,ticking=false;window.addEventListener('scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{const h=document.getElementById('af35Header'),y=window.scrollY||0,d=y-last;if(d>8&&y>90)h?.classList.add('hidden');else if(d<-8||y<24)h?.classList.remove('hidden');last=y;ticking=false;});},{passive:true});}
  }
  function mountAccountBar(){renderResponsiveHeader();}

  function renderStatusBar(){renderResponsiveHeader();}
  const _updateApprovalBadge338=updateApprovalBadge;
  updateApprovalBadge=function(){_updateApprovalBadge338();renderResponsiveHeader();};

  // Robust Fly Tip launcher: use capture-phase delegation so the action keeps working
  // after Home is re-rendered and on touch/standalone PWA windows as well as desktop.
  document.addEventListener('click', e => {
    const btn = e.target?.closest?.('[data-af-action=\"report-fly-tip\"], [data-af-action=\"report-scrap\"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.afAction;
    const opener = action === 'report-scrap' ? openScrapReport : openFlyTipReport;
    Promise.resolve().then(() => opener()).catch(err => alert(err?.message || 'Could not open the report form.'));
  }, true);

  // Expose selected functions used by buttons and other code-free UI.
  window.renderHome=renderHome; window.renderHistory=renderHistory; window.openAccess=openAccess; window.openAsset=openAsset; window.saveAsset=saveAsset; window.saveAccess=saveAccess; window.removeAsset=removeAsset;

  document.addEventListener('DOMContentLoaded',bootstrap);
})();
