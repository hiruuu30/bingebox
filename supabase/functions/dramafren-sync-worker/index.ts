import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const SOURCE="dramafren_webfic";
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();

function slugify(v:any){
  return String(v||"").toLowerCase().replace(/[’‘`´']/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,72)||"drama";
}
function genreOf(tags:any[]){
  const allowed=["romance","fantasy","action","comedy","thriller","mystery","historical","revenge","family","werewolf","billionaire","mafia","supernatural","crime","school","office","medical","sci-fi"];
  const text=(tags||[]).join(" ").toLowerCase();
  return allowed.find(x=>text.includes(x))||"drama";
}
function expiry(url:string){
  try{
    const u=new URL(url);
    for(const k of ["Expires","expires","expire","expiry","exp"]){
      const v=u.searchParams.get(k);
      if(v&&/^\d{9,13}$/.test(v)){
        const n=Number(v);
        return new Date(n>1e12?n:n*1000).toISOString();
      }
    }
  }catch{}
  return null;
}
function validMedia(url:string){
  try{
    const u=new URL(url);
    const h=u.hostname.toLowerCase();
    return u.protocol==="https:"&&(h==="dramaboxdb.com"||h.endsWith(".dramaboxdb.com"))&&/\.mp4(?:$|\?)/i.test(url);
  }catch{return false}
}
async function sha(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function catalog(bookId:string){
  const {data,error}=await db.from("dramafren_catalog_queue").select("*").eq("book_id",bookId).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error("Catalog record not found");
  return data;
}
async function mapRow(bookId:string){
  const {data,error}=await db.from("content_source_map").select("*").eq("source_key",SOURCE).eq("source_content_id",bookId).maybeSingle();
  if(error)throw error;
  return data;
}
async function uniqueSlug(title:string,bookId:string){
  const base=(slugify(title)+"-"+bookId.slice(-6)).slice(0,96);
  for(let i=0;i<10;i++){
    const s=i?base+"-"+(i+1):base;
    const {data}=await db.from("dramas").select("id").eq("slug",s).maybeSingle();
    if(!data)return s;
  }
  return base+"-"+crypto.randomUUID().slice(0,6);
}
async function ensureDrama(bookId:string,allowCreate=true){
  const existingMap=await mapRow(bookId);
  if(existingMap){
    const {data,error}=await db.from("dramas").select("*").eq("id",existingMap.drama_id).maybeSingle();
    if(error)throw error;
    if(data)return data;
  }
  const c=await catalog(bookId);
  if(c.matched_drama_id){
    const {data:d,error}=await db.from("dramas").select("*").eq("id",c.matched_drama_id).maybeSingle();
    if(error)throw error;
    if(d){
      await db.from("content_source_map").upsert({
        source_key:SOURCE,source_content_id:bookId,drama_id:d.id,source_url:c.canonical_url,last_seen_at:N(),
        metadata:{linked_from:"catalog_matched_drama"}
      },{onConflict:"source_key,source_content_id"});
      return d;
    }
  }
  if(!allowCreate)return null;
  const sl=await uniqueSlug(c.title||("Drama "+bookId),bookId);
  const b=c.metadata?.browse||{};
  const complete=/complete/i.test(String(b.lastUpdateTimeDisplay||""));
  const {data:d,error}=await db.from("dramas").insert({
    slug:sl,title:c.title||("Drama "+bookId),genre:genreOf(c.tags||[]),mood:[],
    description:c.description||"",poster_url:c.cover_url||null,featured:false,published:false,
    is_complete:complete,is_r18:false
  }).select("*").single();
  if(error)throw error;
  await db.from("drama_rights").upsert({
    drama_id:d.id,rights_basis:"unverified",verified:false,
    rights_notes:"Created by automated DramaBox/Webfic sync. Publication remains blocked until rights are verified."
  },{onConflict:"drama_id"});
  await db.from("content_source_map").insert({
    source_key:SOURCE,source_content_id:bookId,drama_id:d.id,source_url:c.canonical_url,
    metadata:{created_by:"dramafren-sync-worker"}
  });
  await db.from("dramafren_catalog_queue").update({matched_drama_id:d.id,matched_at:N(),updated_at:N()}).eq("book_id",bookId);
  return d;
}
async function updateDrama(bookId:string){
  const c=await catalog(bookId);
  const d=await ensureDrama(bookId,true);
  const b=c.metadata?.browse||{};
  const complete=/complete/i.test(String(b.lastUpdateTimeDisplay||""));
  const {error}=await db.from("dramas").update({
    title:c.title||d.title,
    genre:genreOf(c.tags||[]),
    description:c.description||d.description||"",
    poster_url:c.cover_url||d.poster_url||null,
    is_complete:complete,
    updated_at:N()
  }).eq("id",d.id);
  if(error)throw error;
  await db.from("content_source_map").update({source_url:c.canonical_url,last_seen_at:N(),metadata:{chapter_count:c.chapter_count,shelf_time:c.shelf_time}}).eq("source_key",SOURCE).eq("source_content_id",bookId);
  return d;
}
async function fetchOfficial(bookId:string){
  const r=await fetch(`https://www.dramabox.com/en/drama/${encodeURIComponent(bookId)}`,{
    headers:{
      "Accept":"text/html,application/xhtml+xml,*/*",
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
      "Accept-Language":"en,en;q=0.9"
    },
    redirect:"follow",
    signal:AbortSignal.timeout(15000)
  });
  if(!r.ok)throw new Error(`Official DramaBox detail HTTP ${r.status}`);
  const html=await r.text();
  const m=html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if(!m)throw new Error("Official DramaBox page did not contain __NEXT_DATA__");
  let next:any;
  try{next=JSON.parse(m[1])}catch{throw new Error("Official DramaBox __NEXT_DATA__ was invalid JSON")}
  const pp=next?.props?.pageProps||{};
  const info=pp.bookInfo||{};
  if(String(info.bookId||bookId)!==String(bookId))throw new Error("Official DramaBox book ID mismatch");
  const chapters=Array.isArray(pp.chapterList)?pp.chapterList:[];
  if(!chapters.length)throw new Error("Official DramaBox page returned no chapters");
  return {info,chapters,final_url:r.url};
}
async function resolveEpisodes(job:any){
  const bookId=String(job.source_content_id);
  const d=await ensureDrama(bookId,false);
  if(!d)throw new Error("Source mapping not ready; title job must complete first");
  const {info,chapters,final_url}=await fetchOfficial(bookId);
  const {data:rights}=await db.from("drama_rights").select("verified").eq("drama_id",d.id).maybeSingle();
  const {data:existing,error:existingError}=await db.from("episodes")
    .select("id,episode_number,video_key,video_url,published")
    .eq("drama_id",d.id);
  if(existingError)throw existingError;
  const oldMap=new Map((existing||[]).map((e:any)=>[Number(e.episode_number),e]));
  const upserts:any[]=[];
  for(let i=0;i<chapters.length;i++){
    const ch=chapters[i]||{};
    const n=Number.isInteger(Number(ch.index))?Number(ch.index)+1:i+1;
    if(!n||n<1)continue;
    const old:any=oldMap.get(n);
    const durationMs=Number(ch.duration||0);
    const durationSeconds=durationMs>10000?Math.round(durationMs/1000):(durationMs||null);
    upserts.push({
      drama_id:d.id,episode_number:n,title:String(ch.name||""),
      duration_seconds:durationSeconds,
      video_key:old?.video_key||null,
      video_url:old?.video_url||null,
      published:!!old?.published,
      updated_at:N()
    });
  }
  const {data:eps,error:upsertError}=await db.from("episodes")
    .upsert(upserts,{onConflict:"drama_id,episode_number"})
    .select("id,episode_number,video_key,published");
  if(upsertError)throw upsertError;
  const epMap=new Map((eps||[]).map((e:any)=>[Number(e.episode_number),e]));
  const mediaPriority=job.payload?.refresh?6:(job.payload?.backfill?220:40);
  const mediaItems:any[]=[];
  for(let i=0;i<chapters.length;i++){
    const ch=chapters[i]||{};
    const n=Number.isInteger(Number(ch.index))?Number(ch.index)+1:i+1;
    const ep:any=epMap.get(n);
    const url=String(ch.mp4||"");
    if(!ep||ep.video_key||!ch.unlock||!validMedia(url))continue;
    mediaItems.push({
      episode_id:ep.id,episode_number:n,chapter_id:String(ch.id||""),
      url,expires_at:expiry(url),referer:"https://www.dramabox.com/"
    });
  }
  if(mediaItems.length){
    const version=await sha(mediaItems.map(x=>x.url).join("|"));
    const {error:mediaError}=await db.from("sync_queue").upsert({
      source_key:SOURCE,source_content_id:bookId,job_type:"resolve_media",
      idempotency_key:`bingebox:${SOURCE}:${bookId}:resolve_media_batch:${version}`,
      payload:{drama_id:d.id,items:mediaItems,backfill:!!job.payload?.backfill,refresh:!!job.payload?.refresh},
      priority:mediaPriority,status:"pending",updated_at:N()
    },{onConflict:"idempotency_key",ignoreDuplicates:true});
    if(mediaError)throw mediaError;
  }
  const c=await catalog(bookId);
  await db.from("dramafren_catalog_queue").update({
    chapter_count:chapters.length,matched_drama_id:d.id,matched_at:N(),updated_at:N(),
    metadata:{...(c.metadata||{}),official_web:{url:final_url,chapter_count:chapters.length,last_resolved_at:N(),public_media_count:mediaItems.length}}
  }).eq("book_id",bookId);
  await db.from("content_source_map").update({
    last_seen_at:N(),
    metadata:{official_chapter_count:chapters.length,public_media_count:mediaItems.length,last_resolved_at:N()}
  }).eq("source_key",SOURCE).eq("source_content_id",bookId);
  return {
    book_id:bookId,drama_id:d.id,title:info.bookName||d.title,chapters:chapters.length,
    episodes_upserted:(eps||[]).length,public_media:mediaItems.length,
    media_jobs:mediaItems.length?1:0,rights_verified:!!rights?.verified,media_priority:mediaPriority
  };
}
async function verifyMedia(url:string,referer:string){
  const r=await fetch(url,{
    headers:{"Range":"bytes=0-0","Accept":"video/*","Origin":"https://bingebox.bond","Referer":referer||"https://www.dramabox.com/"},
    redirect:"follow",
    signal:AbortSignal.timeout(15000)
  });
  const ct=(r.headers.get("content-type")||"").toLowerCase();
  if(!(r.status===206||r.status===200)||!ct.includes("video"))throw new Error(`Media verification failed HTTP ${r.status} ${ct||"unknown"}`);
  try{await r.body?.cancel()}catch{}
  return {status:r.status,content_type:ct,content_range:r.headers.get("content-range")};
}
async function storeOneMedia(p:any){
  const url=String(p.url||"");
  if(!validMedia(url))throw new Error("Rejected non-DramaBox direct media URL");
  const {data:ep,error:ee}=await db.from("episodes").select("id,drama_id,episode_number,video_key,published").eq("id",p.episode_id).maybeSingle();
  if(ee)throw ee;
  if(!ep)throw new Error("Episode not found");
  if(ep.video_key)return {episode_id:ep.id,preserved_r2:true};
  const verified=await verifyMedia(url,String(p.referer||""));
  const u=new URL(url);
  const fp=await sha(u.hostname.toLowerCase()+u.pathname);
  const {data:rows,error:se}=await db.from("episode_sources").select("*").eq("episode_id",ep.id).order("priority",{ascending:true});
  if(se)throw se;
  const list=rows||[];
  let row=list.find((x:any)=>x.provider==="dramabox_web");
  if(!row)row=list.find((x:any)=>x.priority===1&&x.provider!=="legacy_r2"&&x.source_type==="direct");
  let sourceId:string;
  const exp=p.expires_at||expiry(url);
  const patch={
    provider:"dramabox_web",server_label:"DramaBox Web",source_type:"direct",
    source_url:url,origin_source_url:url,source_fingerprint:fp,active:true,
    source_stability:exp?"temporary":"unknown",expires_at:exp,
    health_status:"healthy",last_verified_at:N(),last_failed_at:null,updated_at:N()
  };
  if(row){
    const {error}=await db.from("episode_sources").update(patch).eq("id",row.id);
    if(error)throw error;
    sourceId=row.id;
  }else{
    const maxp=list.reduce((m:number,x:any)=>Math.max(m,Number(x.priority)||0),0);
    const {data:newRow,error}=await db.from("episode_sources").insert({
      episode_id:ep.id,priority:maxp+1,...patch
    }).select("id").single();
    if(error)throw error;
    sourceId=newRow.id;
  }
  for(const old of list){
    if(old.id!==sourceId&&old.provider==="dramabox_web"&&old.active){
      await db.from("episode_sources").update({active:false,health_status:"expired",last_failed_at:N(),updated_at:N()}).eq("id",old.id);
    }
  }
  await db.from("episodes").update({video_url:url,updated_at:N()}).eq("id",ep.id);
  const {data:drama}=await db.from("dramas").select("published").eq("id",ep.drama_id).maybeSingle();
  const {data:rights}=await db.from("drama_rights").select("verified").eq("drama_id",ep.drama_id).maybeSingle();
  if(drama?.published&&rights?.verified&&!ep.published){
    await db.from("episodes").update({published:true,updated_at:N()}).eq("id",ep.id);
  }
  return {episode_id:ep.id,episode_number:ep.episode_number,source_id:sourceId,expires_at:exp,verified};
}
async function storeMedia(job:any){
  const payload=job.payload||{};
  const items=Array.isArray(payload.items)?payload.items:[payload];
  const results:any[]=[];
  const failures:any[]=[];
  for(let i=0;i<items.length;i+=5){
    const chunk=items.slice(i,i+5);
    const settled=await Promise.allSettled(chunk.map((p:any)=>storeOneMedia(p)));
    settled.forEach((s:any,idx:number)=>{
      if(s.status==="fulfilled")results.push(s.value);
      else failures.push({episode_number:chunk[idx]?.episode_number,error:s.reason?.message||String(s.reason)});
    });
  }
  if(failures.length)throw new Error(`${failures.length} media item(s) failed: ${failures.slice(0,3).map(x=>`EP ${x.episode_number}: ${x.error}`).join("; ")}`);
  return {validated:results.length,items:results};
}
async function complete(id:string,result:any){
  await db.from("sync_queue").update({status:"completed",payload:{...result,_completed:true},heartbeat_at:N(),lease_expires_at:null,completed_at:N(),updated_at:N(),last_error:null}).eq("id",id);
}
async function retry(job:any,error:any){
  const m=error?.message||String(error);
  const attempts=Number(job.attempt_count||1);
  if(attempts>=6){
    await db.from("sync_queue").update({status:"failed",last_error:m.slice(0,1500),heartbeat_at:N(),lease_expires_at:null,updated_at:N()}).eq("id",job.id);
    return {failed:true,error:m};
  }
  const minutes=Math.min(180,Math.pow(2,Math.min(attempts,7)));
  await db.from("sync_queue").update({status:"retry_wait",last_error:m.slice(0,1500),next_retry_at:new Date(Date.now()+minutes*60000).toISOString(),heartbeat_at:N(),lease_expires_at:null,updated_at:N()}).eq("id",job.id);
  return {retry:true,error:m,retry_minutes:minutes};
}
async function workOne(types:string[]){
  const worker=crypto.randomUUID();
  const {data:claimed,error}=await db.rpc("claim_sync_queue_job_filtered",{p_worker:worker,p_job_types:types,p_lease_seconds:150});
  if(error)return {ok:false,error:"claim: "+error.message};
  const job=claimed?.[0];
  if(!job)return {ok:true,idle:true};
  try{
    let result:any;
    if(job.job_type==="title_new"||job.job_type==="title_changed"){
      const d=await updateDrama(String(job.source_content_id));
      result={book_id:job.source_content_id,drama_id:d.id,job_type:job.job_type};
    }else if(job.job_type==="episode_count_changed"){
      result={book_id:job.source_content_id,job_type:job.job_type,acknowledged:true};
    }else if(job.job_type==="resolve_episodes"){
      result=await resolveEpisodes(job);
    }else if(job.job_type==="resolve_media"){
      result=await storeMedia(job);
    }else throw new Error("Unsupported job type "+job.job_type);
    await complete(job.id,result);
    await db.from("sync_events").insert({source_key:SOURCE,event_type:"job_completed",source_content_id:String(job.source_content_id),details:{job_id:job.id,job_type:job.job_type,result}});
    return {ok:true,job_id:job.id,job_type:job.job_type,result};
  }catch(e){
    const result=await retry(job,e);
    await db.from("sync_events").insert({source_key:SOURCE,event_type:result.failed?"job_failed":"job_retry",source_content_id:String(job.source_content_id),details:{job_id:job.id,job_type:job.job_type,error:e?.message||String(e)}});
    return {ok:false,job_id:job.id,job_type:job.job_type,...result};
  }
}
Deno.serve(async(req:Request)=>{
  const u=new URL(req.url);
  if(req.method==="GET")return J({ok:true,service:"dramafren-sync-worker",architecture:"sync_queue->worker->postgres",media:"official public DramaBox web MP4 only"});
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  const lane=u.searchParams.get("lane")||"general";
  const types=lane==="media"
    ? ["resolve_media"]
    : lane==="episodes"
      ? ["title_new","title_changed","episode_count_changed","resolve_episodes"]
      : ["title_new","title_changed","episode_count_changed","resolve_episodes","resolve_media"];
  const results:any[]=[];
  for(let i=0;i<5;i++){
    const r=await workOne(types);
    results.push(r);
    if(r.idle)break;
  }
  return J({ok:results.every(x=>x.ok!==false||x.retry===true),lane,processed:results.filter(x=>!x.idle).length,results});
});