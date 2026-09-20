import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();
const SOURCE="dramafren_webfic";

function slugify(v:any){
  return String(v||"").toLowerCase()
    .replace(/[’‘`´']/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,100);
}
function canonical(book:any){
  const id=String(book?.bookId||"");
  const slug=slugify(book?.bookNameLower||book?.replacedBookName||book?.bookName||"");
  return `https://dramabox.dramafren.org/index.php?page=detail&id=${encodeURIComponent(id)}&lang=en${slug?`&slug=${encodeURIComponent(slug)}`:""}`;
}
function asIso(v:any){
  const s=String(v||"").trim();
  if(!s)return null;
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
async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function fingerprint(row:any){
  return await sha256(JSON.stringify({
    title:row.title||null,
    cover_url:row.cover_url||null,
    description:row.description||null,
    chapter_count:row.chapter_count??null,
    shelf_time:row.shelf_time||null,
    tags:row.tags||[]
  }));
}
async function browse(pageNo:number){
  const r=await fetch("https://www.webfic.com/webfic/home/browse",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Accept":"application/json",
      "pline":"DRAMABOX",
      "language":"en",
      "User-Agent":"BingeBox Catalog Sync/2.0 (+https://bingebox.bond)"
    },
    body:JSON.stringify({typeTwoId:0,pageNo,pageSize:100}),
    signal:AbortSignal.timeout(15000)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Browse page ${pageNo} HTTP ${r.status}`);
  let json:any;
  try{json=JSON.parse(text)}catch{throw new Error(`Browse page ${pageNo} invalid JSON`)}
  if(json?.status!==0||!json?.data)throw new Error(`Browse page ${pageNo} returned no data`);
  return json.data;
}
async function enqueue(bookId:string,jobType:string,payload:any,version:string,priority:number){
  const key=`bingebox:${SOURCE}:${bookId}:${jobType}:${version}`;
  const {error}=await db.from("sync_queue").upsert({
    source_key:SOURCE,
    source_content_id:bookId,
    job_type:jobType,
    idempotency_key:key,
    payload,
    priority,
    status:"pending",
    updated_at:N()
  },{onConflict:"idempotency_key",ignoreDuplicates:true});
  if(error)throw new Error(`Queue insert failed for ${bookId}: ${error.message}`);
}
async function event(type:string,bookId:string|null,details:any){
  await db.from("sync_events").insert({source_key:SOURCE,event_type:type,source_content_id:bookId,details});
}
async function syncGroup(group:number){
  if(!Number.isInteger(group)||group<0||group>5)throw new Error("group must be 0..5");
  const {data:state,error:stateError}=await db.from("source_sync_state")
    .select("baseline_established_at,sync_watermark")
    .eq("source_key",SOURCE).maybeSingle();
  if(stateError)throw stateError;
  const watermark=state?.sync_watermark?new Date(state.sync_watermark):null;
  const start=group*5+1;
  const now=N();
  const refreshAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
  let totalUpserted=0,detected=0,newDetected=0,episodeChanges=0,metadataChanges=0;
  let reportedTotal:number|null=null,reportedPages:number|null=null,lastSeenId:string|null=null,lastSeenTime:string|null=null;
  const pageResults:any[]=[];

  for(let page=start;page<start+5;page++){
    const data=await browse(page);
    reportedTotal=Number(data?.total)||reportedTotal;
    reportedPages=Number(data?.pages)||reportedPages;
    const books=(Array.isArray(data?.bookList)?data.bookList:[])
      .filter((b:any)=>String(b?.simpleLanguage||"en").toLowerCase()==="en" && /^[0-9]{6,20}$/.test(String(b?.bookId||"")));
    const ids=books.map((b:any)=>String(b.bookId));
    const existingMap=new Map<string,any>();
    if(ids.length){
      const {data:existing,error}=await db.from("dramafren_catalog_queue")
        .select("book_id,title,cover_url,description,chapter_count,shelf_time,tags,metadata_fingerprint,matched_drama_id")
        .in("book_id",ids);
      if(error)throw new Error(`Page ${page} existing lookup failed: ${error.message}`);
      for(const x of existing||[])existingMap.set(String(x.book_id),x);
    }
    const rows:any[]=[];
    for(const b of books){
      const row:any={
        book_id:String(b.bookId),
        canonical_url:canonical(b),
        discovered_from:"webfic_browse",
        status:"ready",
        depth:0,
        title:String(b.bookName||b.bookNameEn||b.replacedBookName||"").trim()||null,
        cover_url:String(b.cover||b.coverWap||"").trim()||null,
        description:String(b.introduction||"").trim().slice(0,8000)||null,
        language:String(b.simpleLanguage||b.language||"en"),
        chapter_count:Number.isFinite(Number(b.chapterCount))?Number(b.chapterCount):null,
        shelf_time:asIso(b.firstShelfTime||b.shelfTime),
        tags:tagsOf(b),
        recommendation_ids:[],
        metadata:{browse:b,metadata_source:"https://www.webfic.com/webfic/home/browse",page_no:page},
        last_error:null,
        last_fetched_at:now,
        next_attempt_at:refreshAt,
        updated_at:now
      };
      row.metadata_fingerprint=await fingerprint(row);
      const old=existingMap.get(row.book_id);
      const shelf=row.shelf_time?new Date(row.shelf_time):null;
      const watermarkDay=watermark?new Date(Date.UTC(watermark.getUTCFullYear(),watermark.getUTCMonth(),watermark.getUTCDate())):null;
      const isFuture=!watermarkDay||!shelf||shelf>=watermarkDay;

      if(!old){
        row.last_change_detected_at=now;
        if(isFuture){
          await enqueue(row.book_id,"title_new",{catalog:row,detected_at:now},row.metadata_fingerprint,20);
          await enqueue(row.book_id,"resolve_episodes",{chapter_count:row.chapter_count,canonical_url:row.canonical_url,detected_at:now},row.metadata_fingerprint,30);
          await event("title_new",row.book_id,{title:row.title,chapter_count:row.chapter_count,shelf_time:row.shelf_time});
          detected++;newDetected++;
        }
      }else if(old.metadata_fingerprint){
        if(Number(old.chapter_count||0)!==Number(row.chapter_count||0)){
          row.last_change_detected_at=now;
          await enqueue(row.book_id,"episode_count_changed",{
            old_chapter_count:old.chapter_count,
            new_chapter_count:row.chapter_count,
            canonical_url:row.canonical_url,
            detected_at:now
          },row.metadata_fingerprint,10);
          await enqueue(row.book_id,"resolve_episodes",{
            chapter_count:row.chapter_count,
            canonical_url:row.canonical_url,
            detected_at:now
          },row.metadata_fingerprint,15);
          await event("episode_count_changed",row.book_id,{old:old.chapter_count,new:row.chapter_count,title:row.title});
          detected++;episodeChanges++;
        }else if(old.metadata_fingerprint!==row.metadata_fingerprint && (isFuture||old.matched_drama_id)){
          row.last_change_detected_at=now;
          await enqueue(row.book_id,"title_changed",{catalog:row,detected_at:now},row.metadata_fingerprint,50);
          await event("title_changed",row.book_id,{title:row.title,shelf_time:row.shelf_time});
          detected++;metadataChanges++;
        }
      }
      rows.push(row);
      if(!lastSeenTime || (row.shelf_time && row.shelf_time>lastSeenTime)){
        lastSeenTime=row.shelf_time;
        lastSeenId=row.book_id;
      }
    }
    if(rows.length){
      const {error}=await db.from("dramafren_catalog_queue").upsert(rows,{onConflict:"book_id"});
      if(error)throw new Error(`Page ${page} upsert failed: ${error.message}`);
    }
    totalUpserted+=rows.length;
    pageResults.push({page,count:rows.length});
  }

  await db.from("source_sync_state").update({
    last_successful_scan_at:now,
    last_seen_source_id:lastSeenId,
    last_seen_timestamp:lastSeenTime,
    catalog_count:reportedTotal||totalUpserted,
    metadata:{last_group:group,last_group_scan_at:now,reported_pages:reportedPages,reported_total:reportedTotal},
    updated_at:now
  }).eq("source_key",SOURCE);

  await event("scanner_run",null,{group,start_page:start,end_page:start+4,upserted:totalUpserted,detected,new_detected:newDetected,episode_changes:episodeChanges,metadata_changes:metadataChanges});

  return {ok:true,group,start_page:start,end_page:start+4,upserted:totalUpserted,total:reportedTotal,pages:reportedPages,detected,new_detected:newDetected,episode_changes:episodeChanges,metadata_changes:metadataChanges,page_results:pageResults};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="GET")return J({ok:true,service:"dramafren-catalog-sync",architecture:"scanner->sync_queue",groups:6,pages_per_group:5,page_size:100});
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  const u=new URL(req.url);
  const group=Number(u.searchParams.get("group")||"0");
  try{return J(await syncGroup(group))}
  catch(e){return J({ok:false,group,error:e?.message||String(e)},502)}
});