import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const SOURCE="dramafren_v2";
const CANONICAL_SOURCE="dramafren_webfic";
const HOME="https://dramaboxv2.dramafren.org/";
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();

function decodeHtml(v:string){
  return String(v||"")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}
function slugify(v:any){
  return String(v||"").toLowerCase().replace(/[’‘`´']/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100);
}
function asIso(v:any){
  const s=String(v||"").trim(); if(!s)return null;
  const d=new Date(s.includes("T")?s:s.replace(" ","T")+"Z");
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
function tagsOf(book:any){
  return [...new Set([
    ...(Array.isArray(book?.tags)?book.tags:[]),
    ...(Array.isArray(book?.labels)?book.labels:[]),
    ...(Array.isArray(book?.typeTwoNames)?book.typeTwoNames:[])
  ].map((x:any)=>String(x||"").trim()).filter(Boolean))].slice(0,20);
}
async function sha(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function parseLinks(html:string){
  const out=new Map<string,{book_id:string,title:string,url:string}>();
  const re=/<a\b[^>]*href=["']([^"']*index\.php[^"']*\bid=(\d{6,20})[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    const book_id=m[2];
    const title=decodeHtml(m[3]).replace(/\bWatch Now\b.*$/i,"").trim();
    const raw=decodeHtml(m[1]);
    let url:string;
    try{url=new URL(raw,HOME).toString()}catch{continue}
    if(!url.startsWith(HOME)||!title)continue;
    if(!out.has(book_id))out.set(book_id,{book_id,title,url});
  }
  return [...out.values()];
}
async function publicDetail(bookId:string){
  const r=await fetch("https://www.webfic.com/webfic/book/detail",{
    method:"POST",
    headers:{
      "Content-Type":"application/json","Accept":"application/json",
      "pline":"DRAMABOX","language":"en",
      "User-Agent":"BingeBox v2 Discovery/1.0 (+https://bingebox.bond)"
    },
    body:JSON.stringify({bookId}),
    signal:AbortSignal.timeout(12000)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Webfic detail HTTP ${r.status}`);
  let json:any; try{json=JSON.parse(text)}catch{throw new Error("Webfic detail invalid JSON")}
  const book=json?.data?.book;
  if(!book?.bookId||String(book.bookId)!==String(bookId))throw new Error("Webfic detail book mismatch");
  return book;
}
async function enqueue(bookId:string,type:string,payload:any,version:string,priority:number){
  const key=`bingebox:${CANONICAL_SOURCE}:${bookId}:${type}:v2:${version}`;
  const {error}=await db.from("sync_queue").upsert({
    source_key:CANONICAL_SOURCE,source_content_id:bookId,job_type:type,
    idempotency_key:key,payload,priority,status:"pending",updated_at:N()
  },{onConflict:"idempotency_key",ignoreDuplicates:true});
  if(error)throw error;
}
async function ensureObservation(row:any,status:string,meta:any={}){
  const {data:existing}=await db.from("dramafren_v2_observations")
    .select("id").eq("book_id",row.book_id).maybeSingle();
  if(existing){
    await db.from("dramafren_v2_observations").update({
      source_title:row.title,source_url:row.url,match_status:status,last_seen_at:N(),
      metadata:meta
    }).eq("id",existing.id);
  }else{
    await db.from("dramafren_v2_observations").insert({
      book_id:row.book_id,source_title:row.title,source_url:row.url,
      observation_kind:"homepage",match_status:status,metadata:meta
    });
  }
}
async function reconcile(row:any){
  const {data:cat,error:ce}=await db.from("dramafren_catalog_queue")
    .select("book_id,title,matched_drama_id,metadata_fingerprint")
    .eq("book_id",row.book_id).maybeSingle();
  if(ce)throw ce;

  if(cat){
    await ensureObservation(row,"matched",{canonical_title:cat.title});
    if(cat.matched_drama_id){
      await db.from("content_source_map").upsert({
        source_key:SOURCE,source_content_id:row.book_id,drama_id:cat.matched_drama_id,
        source_url:row.url,last_seen_at:N(),
        metadata:{alias_of:CANONICAL_SOURCE,discovered_by:"v2_home"}
      },{onConflict:"source_key,source_content_id"});
    }
    return {book_id:row.book_id,status:"matched",queued:false};
  }

  const book=await publicDetail(row.book_id);
  const title=String(book.bookName||row.title||"").trim();
  const cover=String(book.cover||book.coverWap||"").trim()||null;
  const description=String(book.introduction||"").trim().slice(0,8000)||null;
  const chapterCount=Number.isFinite(Number(book.chapterCount))?Number(book.chapterCount):null;
  const shelf=asIso(book.firstShelfTime||book.shelfTime);
  const tags=tagsOf(book);
  const fingerprint=await sha(JSON.stringify({title,cover,description,chapterCount,shelf,tags}));
  const canonical=`https://dramabox.dramafren.org/index.php?page=detail&id=${encodeURIComponent(row.book_id)}&lang=en${slugify(title)?`&slug=${encodeURIComponent(slugify(title))}`:""}`;

  const {error:ie}=await db.from("dramafren_catalog_queue").insert({
    book_id:row.book_id,canonical_url:canonical,discovered_from:"dramafren_v2",
    status:"ready",depth:0,title,cover_url:cover,description,language:"en",
    chapter_count:chapterCount,shelf_time:shelf,tags,recommendation_ids:[],
    metadata:{book,metadata_source:"https://www.webfic.com/webfic/book/detail",secondary_source_url:row.url},
    metadata_fingerprint:fingerprint,last_change_detected_at:N(),last_fetched_at:N(),
    next_attempt_at:new Date(Date.now()+30*24*60*60*1000).toISOString(),updated_at:N()
  });
  if(ie)throw ie;

  await ensureObservation(row,"new",{canonical_title:title});
  await enqueue(row.book_id,"title_new",{catalog:{book_id:row.book_id,title,chapter_count:chapterCount,canonical_url:canonical},detected_at:N(),secondary_source:SOURCE},fingerprint,20);
  await enqueue(row.book_id,"resolve_episodes",{chapter_count:chapterCount,canonical_url:canonical,detected_at:N(),secondary_source:SOURCE},fingerprint,30);
  await db.from("sync_events").insert({
    source_key:SOURCE,event_type:"secondary_title_new",source_content_id:row.book_id,
    details:{title,chapter_count:chapterCount,source_url:row.url}
  });
  return {book_id:row.book_id,status:"new",queued:true};
}
async function updateState(patch:any){
  const {data:cur}=await db.from("source_sync_state").select("metadata").eq("source_key",SOURCE).maybeSingle();
  await db.from("source_sync_state").update({
    ...patch,metadata:{...(cur?.metadata||{}),...(patch.metadata||{})},updated_at:N()
  }).eq("source_key",SOURCE);
}
async function run(){
  let r:Response;
  try{
    r=await fetch(HOME,{
      headers:{
        "Accept":"text/html,application/xhtml+xml,*/*",
        "User-Agent":"BingeBox v2 Discovery/1.0 (+https://bingebox.bond)",
        "Accept-Language":"en,en;q=0.9"
      },
      redirect:"follow",signal:AbortSignal.timeout(12000)
    });
  }catch(e){
    await updateState({metadata:{last_probe_at:N(),last_error:e?.message||String(e)}});
    return {ok:false,blocked:false,error:e?.message||String(e)};
  }
  const html=await r.text();
  if(r.status===403&&/cf-chl-|Just a moment|challenge-platform/i.test(html)){
    await updateState({
      metadata:{last_probe_at:N(),last_http_status:403,cloudflare_blocked:true},
      last_seen_timestamp:N()
    });
    return {ok:true,blocked:true,http_status:403,discovered:0};
  }
  if(!r.ok)throw new Error(`v2 homepage HTTP ${r.status}`);

  const rows=parseLinks(html);
  const results:any[]=[];
  for(const row of rows.slice(0,50)){
    try{results.push(await reconcile(row))}
    catch(e){results.push({book_id:row.book_id,status:"error",error:e?.message||String(e)})}
  }
  const {count}=await db.from("dramafren_v2_observations").select("id",{count:"exact",head:true});
  await updateState({
    last_successful_scan_at:N(),
    last_seen_timestamp:N(),
    last_seen_source_id:rows[0]?.book_id||null,
    catalog_count:count||0,
    metadata:{last_probe_at:N(),last_http_status:r.status,cloudflare_blocked:false,last_discovered:rows.length}
  });
  return {
    ok:true,blocked:false,http_status:r.status,discovered:rows.length,
    new_titles:results.filter(x=>x.status==="new").length,
    matched:results.filter(x=>x.status==="matched").length,
    errors:results.filter(x=>x.status==="error")
  };
}
Deno.serve(async(req:Request)=>{
  if(req.method==="GET")return J({ok:true,service:"dramafren-v2-sync",mode:"secondary_discovery",source:HOME});
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  try{return J(await run())}catch(e){return J({ok:false,error:e?.message||String(e)},502)}
});