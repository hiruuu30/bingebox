import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const RELAY=`${U}/functions/v1/external-media?id=`;
const ALLOWED=["dramaboxdb.com","netshort.com","wolftv.online"];
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const fam=(h="")=>ALLOWED.find(x=>h===x||h.endsWith(`.${x}`));
const origin=(s:any)=>String(s.origin_source_url||(!String(s.source_url||"").startsWith(RELAY)?s.source_url:"")||"").trim();

function expiryMs(raw=""){
  try{
    const u=new URL(raw),auth=u.searchParams.get("auth_key");
    if(auth){const m=auth.match(/^(\d{9,13})-/);if(m){const n=Number(m[1]);return n>1e12?n:n*1000}}
    for(const key of ["expires","expire","expiry","exp","deadline","token_expiry","token_expire"]){const v=u.searchParams.get(key);if(v&&/^\d{9,13}$/.test(v)){const n=Number(v);return n>1e12?n:n*1000}}
    for(const [,v] of u.searchParams){if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v))continue;try{let p=v.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');while(p.length%4)p+='=';const data=JSON.parse(atob(p));if(Number(data?.exp)>0)return Number(data.exp)*1000}catch{}}
  }catch{}
  return null;
}
function signed(raw=""){try{const u=new URL(raw);const keys=new Set([...u.searchParams.keys()].map(k=>k.toLowerCase()));return ["auth_key","token","signature","sig","expires","expire","expiry","exp","policy","key-pair-id","hdnts"].some(k=>keys.has(k))}catch{return false}}
function sourceMeta(raw=""){
  const e=expiryMs(raw),temporary=signed(raw),now=Date.now();
  let health="healthy";
  if(temporary&&e&&e<=now+30000)health="expired";
  else if(temporary&&e&&e<=now+24*3600000)health="expiring";
  return{source_stability:temporary?"temporary":"durable",expires_at:e?new Date(e).toISOString():null,health_status:health};
}
function legacyProviderPage(s:any){if(!s?.active||String(s.source_type||"").toLowerCase()!=="embed")return false;const raw=String(s.origin_source_url||s.source_url||"").trim();try{const u=new URL(raw),h=u.hostname.toLowerCase();return (h==="netshort.com"||h.endsWith(".netshort.com"))&&/^\/(?:episode|full-episodes|shortsearch)(?:\/|$)/i.test(u.pathname)}catch{return false}}
function legacyR2Playable(s:any){if(!s?.active||String(s.provider||'').toLowerCase()!=='legacy_r2'||String(s.source_type||'').toLowerCase()!=='direct')return false;const raw=String(s.source_url||s.origin_source_url||'').trim();try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname.toLowerCase()==='media.bingebox.bond'}catch{return false}}
async function admin(r:Request){const t=(r.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!t)return null;const {data,error}=await db.auth.getUser(t);if(error||!data.user)return null;const {data:a}=await db.from("admins").select("user_id").eq("user_id",data.user.id).maybeSingle();return a?data.user:null}
async function all(t:string,s:string){const out:any[]=[];for(let f=0;;f+=1000){const {data,error}=await db.from(t).select(s).range(f,f+999);if(error)throw error;out.push(...(data||[]));if(!data||data.length<1000)break}return out}
async function probe(raw:string){try{const u=new URL(raw),e=expiryMs(raw);if(u.protocol!=="https:"||!fam(u.hostname)||(e&&e<=Date.now()+30000))return false;const c=new AbortController(),tm=setTimeout(()=>c.abort(),5000);try{const r=await fetch(raw,{headers:{Range:"bytes=0-0"},redirect:"follow",signal:c.signal});clearTimeout(tm);try{await r.body?.cancel()}catch{}return r.status>=200&&r.status<300}catch{clearTimeout(tm);return false}}catch{return false}}
async function mapLimit(a:any[],n:number,fn:(v:any)=>Promise<void>){let i=0;async function worker(){for(;;){const j=i++;if(j>=a.length)return;try{await fn(a[j])}catch{}}}await Promise.all(Array.from({length:Math.min(n,Math.max(1,a.length))},worker))}
function compareSources(a:any,b:any){
  const sr=(s:any)=>String(s.source_stability||'unknown')==='durable'?0:String(s.source_stability||'unknown')==='temporary'?1:2;
  const ra=sr(a),rb=sr(b);if(ra!==rb)return ra-rb;
  if(ra===1){const ae=a.expires_at?new Date(a.expires_at).getTime():0,be=b.expires_at?new Date(b.expires_at).getTime():0;if(ae!==be)return be-ae;}
  return Number(a.priority||0)-Number(b.priority||0);
}

Deno.serve(async r=>{
  if(r.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(r.method!=="POST")return J({error:"Method not allowed"},405);
  if(!await admin(r))return J({error:"Administrator access required"},403);
  const action=new URL(r.url).searchParams.get("action")||"fix-broken";
  if(!["fix-all","fix-broken","repair-library","recover-inactive","maintain-lifetimes"].includes(action))return J({error:"Unknown action"},400);

  const [eps,srcs,ds]=await Promise.all([
    all("episodes","id,drama_id,episode_number,published,video_key,video_url"),
    all("episode_sources","id,episode_id,provider,source_type,source_url,origin_source_url,priority,active,source_stability,expires_at,health_status,last_verified_at,last_failed_at,source_fingerprint"),
    all("dramas","id,title,published")
  ]);

  let quarantined_page_embeds=0,classified=0,expired_disabled=0,expiring_sources=0;
  const nowIso=new Date().toISOString();
  for(const s of srcs){
    if(legacyProviderPage(s)){const {error}=await db.from("episode_sources").update({active:false,health_status:"failed",last_failed_at:nowIso,updated_at:nowIso}).eq("id",s.id);if(!error){s.active=false;s.health_status="failed";quarantined_page_embeds++}continue}
    if(String(s.source_type||'').toLowerCase()!=='direct')continue;
    const raw=origin(s)||String(s.source_url||'');if(!raw)continue;
    const m=String(s.provider||'').toLowerCase()==='legacy_r2'?{source_stability:'durable',expires_at:null,health_status:s.active?'healthy':String(s.health_status||'unknown')} : sourceMeta(raw);
    const patch:any={};
    if(String(s.source_stability||'unknown')!==m.source_stability)patch.source_stability=m.source_stability;
    const oldExp=s.expires_at?new Date(s.expires_at).toISOString():null;if(oldExp!==m.expires_at)patch.expires_at=m.expires_at;
    if(m.health_status==='expiring')expiring_sources++;
    if(m.health_status==='expired'&&s.active){patch.active=false;patch.health_status='expired';patch.last_failed_at=nowIso;expired_disabled++;s.active=false;s.health_status='expired'}
    else if(m.health_status==='expiring'&&s.active&&s.health_status!=='expiring')patch.health_status='expiring';
    // Durable URLs are not automatically healthy. Only an actual probe may upgrade health.
    if(Object.keys(patch).length){patch.updated_at=nowIso;const {error}=await db.from('episode_sources').update(patch).eq('id',s.id);if(!error){Object.assign(s,patch);classified++}}
  }

  const dm=new Map(ds.map((d:any)=>[d.id,d]));
  const by=new Map<string,any[]>();for(const s of srcs){const a=by.get(s.episode_id)||[];a.push(s);by.set(s.episode_id,a)}
  const hasPlayable=(e:any)=>(by.get(e.id)||[]).some((s:any)=>legacyR2Playable(s)||(s.active&&["direct","hls"].includes(String(s.source_type||"").toLowerCase())&&["healthy","unknown","expiring"].includes(String(s.health_status||"").toLowerCase())&&(!s.expires_at||new Date(s.expires_at).getTime()>Date.now()+120000)&&/^https:\/\//i.test(String(s.source_url||""))));
  const broken=eps.filter((e:any)=>e.published&&!e.video_key&&!hasPlayable(e));

  if(action==="repair-library"){
    const gs=new Map<string,any>();for(const e of broken){const d:any=dm.get(e.drama_id);if(!d)continue;let g=gs.get(e.drama_id);if(!g){g={drama_id:e.drama_id,title:d.title,episodes:[]};gs.set(e.drama_id,g)}g.episodes.push(e.episode_number)}
    const targets=[...gs.values()].map(g=>({...g,broken_count:g.episodes.length,episodes:g.episodes.sort((a:number,b:number)=>a-b)})).sort((a,b)=>b.broken_count-a.broken_count);
    return J({ok:true,mode:"repair-existing-library",broken_episodes:broken.length,affected_dramas:targets.length,quarantined_page_embeds,classified,expired_disabled,expiring_sources,targets});
  }

  let checked=0,disabled=0,reactivated=0,synced=0;
  if(action!=="maintain-lifetimes"){
    const ext=srcs.filter((s:any)=>s.provider==="external"&&s.source_type==="direct"&&(action!=="recover-inactive"||!s.active));
    await mapLimit(ext,36,async(s:any)=>{const o=origin(s);if(!o)return;checked++;const ok=await probe(o),m=sourceMeta(o),t=new Date().toISOString();if(ok&&!s.active){const patch={active:true,source_url:RELAY+s.id,origin_source_url:o,source_stability:m.source_stability,expires_at:m.expires_at,health_status:m.health_status,last_verified_at:t,updated_at:t};const {error}=await db.from("episode_sources").update(patch).eq("id",s.id);if(!error){Object.assign(s,patch);reactivated++}}else if(ok&&s.active){const patch={source_stability:m.source_stability,expires_at:m.expires_at,health_status:m.health_status,last_verified_at:t,updated_at:t};await db.from('episode_sources').update(patch).eq('id',s.id);Object.assign(s,patch)}else if(action!=="recover-inactive"&&!ok&&s.active){const health=m.health_status==='expired'?'expired':'failed';const {error}=await db.from("episode_sources").update({active:false,health_status:health,last_failed_at:t,updated_at:t}).eq("id",s.id);if(!error){s.active=false;s.health_status=health;disabled++}}});
  }

  for(const e of eps){if(e.video_key)continue;const rows=(by.get(e.id)||[]);const external=rows.filter((s:any)=>s.provider==="external"&&s.source_type==="direct"&&s.active&&s.health_status!=="expired"&&s.health_status!=="failed"&&(!s.expires_at||new Date(s.expires_at).getTime()>Date.now()+30000)).sort(compareSources)[0];const legacy=rows.filter((s:any)=>legacyR2Playable(s)).sort((a:any,b:any)=>(a.priority||0)-(b.priority||0))[0];if(!external&&!legacy)continue;const want=external?RELAY+external.id:String(legacy.source_url||legacy.origin_source_url||'');if(want&&(e.video_url||null)!==want){const {error}=await db.from("episodes").update({video_url:want,updated_at:new Date().toISOString()}).eq("id",e.id);if(!error)synced++}}

  const stillBroken=eps.filter((e:any)=>e.published&&!e.video_key&&!hasPlayable(e)).length;
  return J({ok:true,mode:action,checked,disabled,reactivated,reactivated_sources:reactivated,broken_episodes:broken.length,unresolved_episodes:stillBroken,repaired_episodes:Math.max(0,broken.length-stillBroken),fallbacks_synced:synced,quarantined_page_embeds,classified,expired_disabled,expiring_sources,note:action==="maintain-lifetimes"?"Source lifetime metadata normalized; expired signed sources retired; expiring sources remain active for pre-expiry maintenance.":action==="recover-inactive"?"Inactive external/direct sources re-probed after lifetime normalization.":"Source health normalized with durable-source and latest-expiry preference."});
});