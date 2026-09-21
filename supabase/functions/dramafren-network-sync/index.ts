import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();
async function sha256Text(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function authorized(req:Request){
  const token=req.headers.get("x-bingebox-sync-token")||"";
  if(!token)return false;
  const {data,error}=await db.from("source_sync_state").select("metadata")
    .eq("source_key","dramafren_network").maybeSingle();
  if(error||!data?.metadata?.token_sha256)return false;
  return await sha256Text(token)===String(data.metadata.token_sha256);
}
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36";

type SourceRow={source_key:string;provider:string;base_url:string;enabled:boolean;mode:string;canonical_source_key:string|null;metadata:any};
type FoundRow={source_content_id:string|null;source_title:string;source_url:string;cover_url:string|null;observation_kind:string};

function decodeHtml(v:string){
  return String(v||"").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&nbsp;/gi," ")
    .replace(/&#(\d+);/g,(_:string,n:string)=>String.fromCharCode(Number(n)||32))
    .replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}
function slugify(v:any){
  return String(v||"").toLowerCase().replace(/[’‘\x60´']/g,"").replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"").slice(0,70)||"drama";
}
function titleFromUrl(u:URL,id:string|null){
  const slug=u.searchParams.get("slug");
  if(slug)return decodeURIComponent(slug).replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
  const seg=u.pathname.split("/").filter(Boolean).pop()||"";
  let s=decodeURIComponent(seg);
  if(id&&s.startsWith(id))s=s.slice(id.length).replace(/^[-_]+/,"");
  return s.replace(/\.(?:html?|php)$/i,"").replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
}
function sourceId(u:URL){
  for(const k of ["id","bookId","book_id","dramaId","drama_id","seriesId","series_id","videoId","video_id"]){
    const v=u.searchParams.get(k);
    if(v&&/^[A-Za-z0-9_-]{3,80}$/.test(v))return v;
  }
  if(/\/drama\//i.test(u.pathname)){
    const last=u.pathname.split("/").filter(Boolean).pop()||"";
    const m=last.match(/^([A-Za-z0-9]{4,80})(?:[-_]|$)/);
    if(m&&/\d/.test(m[1]))return m[1];
  }
  return null;
}
function validCover(raw:string,base:string){
  try{const u=new URL(raw,base);return (u.protocol==="https:"||u.protocol==="http:")?u.toString():null}catch{return null}
}
function parseHtml(html:string,baseUrl:string){
  const base=new URL(baseUrl),found=new Map<string,FoundRow>(),pagination=new Set<string>();
  const a=/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m:RegExpExecArray|null;
  while((m=a.exec(html))){
    let u:URL;
    try{u=new URL(decodeHtml(m[2]),base)}catch{continue}
    if(u.hostname.toLowerCase()!==base.hostname.toLowerCase())continue;
    u.hash="";
    for(const key of ["hp","p_hist","history","page_no","pageNum"]){
      const v=u.searchParams.get(key); if(v&&/^\d{1,3}$/.test(v))pagination.add(u.toString());
    }
    const p=u.searchParams.get("page"); if(p&&/^\d{1,3}$/.test(p))pagination.add(u.toString());
    const id=sourceId(u);
    const page=(u.searchParams.get("page")||u.searchParams.get("view")||"").toLowerCase();
    if(!id||(page==="home"&&!/\/drama\//i.test(u.pathname)))continue;
    const attrs=(m[1]||"")+" "+(m[3]||""),inner=m[4]||"";
    const img=(inner+" "+attrs).match(/<(?:img|source)\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
    const alt=(inner+" "+attrs).match(/\b(?:alt|title)=["']([^"']+)["']/i);
    let title=decodeHtml(inner).replace(/\b(?:Watch Now|Play Now|Watch|Play|Details?|View)\b\s*$/i,"").replace(/\s+/g," ").trim();
    if(!title&&alt)title=decodeHtml(alt[1]);
    if(!title)title=titleFromUrl(u,id);
    if(!title||title.length<2||title.length>300)continue;
    const cover=img?validCover(img[1],u.toString()):null;
    const key="id:"+id;
    if(!found.has(key))found.set(key,{source_content_id:id,source_title:title,source_url:u.toString(),cover_url:cover,observation_kind:"listing"});
  }
  return {found:[...found.values()],pagination:[...pagination]};
}
function parseSitemap(xml:string,baseUrl:string){
  const base=new URL(baseUrl),out:FoundRow[]=[],seen=new Set<string>();
  const re=/<loc>\s*([^<]+?)\s*<\/loc>/gi; let m:RegExpExecArray|null;
  while((m=re.exec(xml))){
    let u:URL; try{u=new URL(decodeHtml(m[1]),base)}catch{continue}
    if(u.hostname.toLowerCase()!==base.hostname.toLowerCase())continue;
    const id=sourceId(u); if(!id)continue;
    const title=titleFromUrl(u,id); if(!title||title.length<2)continue;
    const key=id+"|"+u.toString(); if(seen.has(key))continue; seen.add(key);
    out.push({source_content_id:id,source_title:title,source_url:u.toString(),cover_url:null,observation_kind:"sitemap"});
    if(out.length>=5000)break;
  }
  return out;
}
async function fetchText(url:string,timeout=12000){
  try{
    const r=await fetch(url,{headers:{"Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","User-Agent":UA,"Accept-Language":"en,en-US;q=0.9"},redirect:"follow",signal:AbortSignal.timeout(timeout)});
    const text=await r.text();
    return {ok:r.ok,status:r.status,text,final_url:r.url,blocked:r.status===403&&/cf-chl-|Just a moment|challenge-platform|Cloudflare/i.test(text),error:null};
  }catch(e){return {ok:false,status:0,text:"",final_url:url,blocked:false,error:e?.message||String(e)}}
}
async function uniqueSlug(provider:string,title:string,id:string){
  const base=(slugify(provider)+"-"+slugify(title)+"-"+slugify(id).slice(-12)).slice(0,96);
  for(let i=0;i<10;i++){
    const s=i?base+"-"+String(i+1):base;
    const {data}=await db.from("dramas").select("id").eq("slug",s).maybeSingle();
    if(!data)return s;
  }
  return base+"-"+crypto.randomUUID().slice(0,6);
}
async function ensureDraft(src:SourceRow,row:FoundRow){
  if(!row.source_content_id)return null;
  const id=row.source_content_id;
  const {data:map,error:me}=await db.from("content_source_map").select("drama_id").eq("source_key",src.source_key).eq("source_content_id",id).maybeSingle();
  if(me)throw me; if(map?.drama_id)return map.drama_id;
  if(src.source_key==="dramafren_v2"){
    const {data:canonical,error:ce}=await db.from("content_source_map").select("drama_id").eq("source_key","dramafren_webfic").eq("source_content_id",id).maybeSingle();
    if(ce)throw ce;
    if(canonical?.drama_id){
      const {error}=await db.from("content_source_map").upsert({source_key:src.source_key,source_content_id:id,drama_id:canonical.drama_id,source_url:row.source_url,last_seen_at:N(),metadata:{alias_of:"dramafren_webfic",discovered_by:"dramafren-network-sync"}},{onConflict:"source_key,source_content_id"});
      if(error)throw error; return canonical.drama_id;
    }
    return null;
  }
  const slug=await uniqueSlug(src.provider,row.source_title,id);
  const {data:d,error:de}=await db.from("dramas").insert({slug,title:row.source_title,genre:"drama",mood:[],description:"",poster_url:row.cover_url,featured:false,published:false,is_complete:false,is_r18:false}).select("id").single();
  if(de)throw de;
  const {error:mapError}=await db.from("content_source_map").insert({source_key:src.source_key,source_content_id:id,drama_id:d.id,source_url:row.source_url,last_seen_at:N(),metadata:{provider:src.provider,created_by:"dramafren-network-sync",discovery_only:true}});
  if(mapError)throw mapError;
  await db.from("sync_events").insert({source_key:src.source_key,event_type:"provider_title_discovered",source_content_id:id,details:{provider:src.provider,title:row.source_title,source_url:row.source_url,drama_id:d.id}});
  return d.id;
}
async function saveObservation(src:SourceRow,row:FoundRow){
  let existing:any=null;
  if(row.source_content_id){
    const {data,error}=await db.from("dramafren_source_observations").select("id,canonical_drama_id").eq("source_key",src.source_key).eq("source_content_id",row.source_content_id).maybeSingle();
    if(error)throw error; existing=data;
  }
  if(!existing&&row.source_url){
    const {data,error}=await db.from("dramafren_source_observations").select("id,canonical_drama_id").eq("source_key",src.source_key).eq("source_url",row.source_url).maybeSingle();
    if(error)throw error; existing=data;
  }
  let oid:string;
  if(existing){
    oid=existing.id;
    const {error}=await db.from("dramafren_source_observations").update({source_title:row.source_title,source_url:row.source_url,last_seen_at:N(),observation_kind:row.observation_kind,metadata:{cover_url:row.cover_url,provider:src.provider}}).eq("id",oid);
    if(error)throw error;
  }else{
    const {data,error}=await db.from("dramafren_source_observations").insert({source_key:src.source_key,source_content_id:row.source_content_id,source_title:row.source_title,source_url:row.source_url,observation_kind:row.observation_kind,match_status:"discovered",metadata:{cover_url:row.cover_url,provider:src.provider}}).select("id").single();
    if(error)throw error; oid=data.id;
  }
  const dramaId=await ensureDraft(src,row);
  if(dramaId)await db.from("dramafren_source_observations").update({canonical_drama_id:dramaId,match_status:"matched",last_seen_at:N()}).eq("id",oid);
  return {new_observation:!existing,matched:!!dramaId};
}
async function updateState(src:SourceRow,patch:any){
  const {data:cur}=await db.from("source_sync_state").select("metadata").eq("source_key",src.source_key).maybeSingle();
  const row={source_key:src.source_key,...patch,metadata:{...(cur?.metadata||{}),provider:src.provider,source_url:src.base_url,...(patch.metadata||{})},updated_at:N()};
  const {error}=await db.from("source_sync_state").upsert(row,{onConflict:"source_key"}); if(error)throw error;
}
async function scanSource(src:SourceRow,maxPages:number){
  const home=await fetchText(src.base_url);
  if(!home.ok){
    await updateState(src,{last_seen_timestamp:N(),metadata:{last_probe_at:N(),last_http_status:home.status,cloudflare_blocked:home.blocked,last_error:home.error||null}});
    return {source_key:src.source_key,provider:src.provider,ok:false,http_status:home.status,blocked:home.blocked,error:home.error||null,pages_scanned:0,discovered:0};
  }
  const rows=new Map<string,FoundRow>(),listingQueue:string[]=[home.final_url||src.base_url],fetched=new Set<string>();
  let pagesScanned=0,lastStatus=home.status;
  const absorb=(parsed:{found:FoundRow[];pagination:string[]})=>{
    for(const x of parsed.found){const key=x.source_content_id?"id:"+x.source_content_id:"url:"+x.source_url;const old=rows.get(key);if(!old||(!old.cover_url&&x.cover_url))rows.set(key,x)}
    for(const x of parsed.pagination)if(!fetched.has(x)&&!listingQueue.includes(x)&&listingQueue.length<maxPages*3)listingQueue.push(x);
  };
  absorb(parseHtml(home.text,src.base_url)); fetched.add(home.final_url||src.base_url); pagesScanned=1;
  while(listingQueue.length&&pagesScanned<maxPages){
    const url=listingQueue.shift()!; if(fetched.has(url))continue;
    const r=await fetchText(url); fetched.add(url); lastStatus=r.status||lastStatus; if(!r.ok)continue;
    pagesScanned++; absorb(parseHtml(r.text,src.base_url));
  }
  const sm=await fetchText(new URL("/sitemap.xml",src.base_url).toString(),10000);
  if(sm.ok&&/<urlset|<sitemapindex/i.test(sm.text)){
    for(const x of parseSitemap(sm.text,src.base_url)){const key=x.source_content_id?"id:"+x.source_content_id:"url:"+x.source_url;if(!rows.has(key))rows.set(key,x)}
  }
  let inserted=0,matched=0,errors=0; const arr=[...rows.values()];
  for(const row of arr){
    try{const r=await saveObservation(src,row);if(r.new_observation)inserted++;if(r.matched)matched++}
    catch(e){errors++;if(errors<=5)await db.from("sync_events").insert({source_key:src.source_key,event_type:"provider_discovery_error",source_content_id:row.source_content_id,details:{provider:src.provider,title:row.source_title,error:e?.message||String(e)}})}
  }
  const {count}=await db.from("dramafren_source_observations").select("id",{count:"exact",head:true}).eq("source_key",src.source_key);
  await updateState(src,{last_successful_scan_at:N(),last_seen_timestamp:N(),last_seen_source_id:arr[0]?.source_content_id||null,catalog_count:count||0,metadata:{last_probe_at:N(),last_http_status:lastStatus,cloudflare_blocked:false,pages_scanned:pagesScanned,last_discovered:arr.length,last_new_observations:inserted,last_matched:matched,last_errors:errors,sitemap_status:sm.status||0}});
  await db.from("sync_events").insert({source_key:src.source_key,event_type:"provider_scanner_run",source_content_id:null,details:{provider:src.provider,pages_scanned:pagesScanned,discovered:arr.length,new_observations:inserted,matched,errors}});
  return {source_key:src.source_key,provider:src.provider,ok:true,http_status:lastStatus,blocked:false,pages_scanned:pagesScanned,discovered:arr.length,new_observations:inserted,matched,errors,total_observations:count||0};
}
Deno.serve(async(req:Request)=>{
  if(!(await authorized(req)))return J({error:"Unauthorized"},401);
  const u=new URL(req.url);
  if(req.method==="GET"){
    const {data}=await db.from("dramafren_source_registry").select("source_key,provider,base_url").eq("enabled",true);
    return J({ok:true,service:"dramafren-network-sync",sources:data||[]});
  }
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  const sourceKey=u.searchParams.get("source"),maxPages=Math.max(1,Math.min(25,Number(u.searchParams.get("pages")||"12")||12));
  let q=db.from("dramafren_source_registry").select("*").eq("enabled",true);
  if(sourceKey)q=q.eq("source_key",sourceKey);
  const {data,error}=await q; if(error)return J({ok:false,error:error.message},500);
  const sources=(data||[]) as SourceRow[]; if(!sources.length)return J({ok:false,error:"No enabled source matched"},404);
  if(!sourceKey&&sources.length>3)return J({ok:false,error:"Specify ?source=source_key when scanning the full registry"},400);
  const results:any[]=[];
  for(const src of sources){try{results.push(await scanSource(src,maxPages))}catch(e){results.push({source_key:src.source_key,provider:src.provider,ok:false,error:e?.message||String(e)})}}
  return J({ok:results.every((x:any)=>x.ok!==false),results});
});