import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();

function slugify(v:any){
  return String(v||"")
    .toLowerCase()
    .replace(/[’‘`´']/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,100);
}
function asIso(v:any){
  const s=String(v||"").trim();
  if(!s)return null;
  const d=new Date(s.includes("T")?s:s.replace(" ","T")+"Z");
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
function isEnglish(x:any){
  const simple=String(x?.simpleLanguage||"").toLowerCase();
  const lang=String(x?.language||"").toLowerCase();
  return !simple&&!lang || simple==="en" || lang==="english" || lang==="en";
}
function canonical(book:any){
  const id=String(book?.bookId||"");
  const slug=slugify(book?.bookNameLower||book?.replacedBookName||book?.bookName||"");
  return `https://dramabox.dramafren.org/index.php?page=detail&id=${encodeURIComponent(id)}&lang=en${slug?`&slug=${encodeURIComponent(slug)}`:""}`;
}
async function detail(bookId:string){
  const r=await fetch("https://www.webfic.com/webfic/book/detail",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Accept":"application/json",
      "pline":"DRAMABOX",
      "language":"en",
      "User-Agent":"BingeBox Metadata Sync/1.0 (+https://bingebox.bond)"
    },
    body:JSON.stringify({bookId}),
    signal:AbortSignal.timeout(12000)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Webfic metadata HTTP ${r.status}`);
  let json:any;
  try{json=JSON.parse(text)}catch{throw new Error("Webfic metadata returned invalid JSON")}
  const book=json?.data?.book;
  if(!book?.bookId)throw new Error("Webfic metadata response did not contain a book");
  if(String(book.bookId)!==String(bookId))throw new Error("Webfic metadata book ID mismatch");
  return {book,recommends:Array.isArray(json?.data?.recommends)?json.data.recommends:[]};
}

async function work(){
  const worker=crypto.randomUUID();
  const {data:claimed,error:claimError}=await db.rpc("claim_dramafren_catalog_item",{p_worker:worker,p_lease_seconds:120});
  if(claimError)return {ok:false,error:"claim failed: "+claimError.message};
  const item=claimed?.[0];
  if(!item)return {ok:true,idle:true};

  try{
    const {book,recommends}=await detail(String(item.book_id));
    const tags=[...new Set([
      ...(Array.isArray(book.tags)?book.tags:[]),
      ...(Array.isArray(book.labels)?book.labels:[]),
      ...(Array.isArray(book.typeTwoNames)?book.typeTwoNames:[])
    ].map((x:any)=>String(x||"").trim()).filter(Boolean))].slice(0,20);
    const recs=recommends
      .filter((x:any)=>x?.bookId&&isEnglish(x))
      .map((x:any)=>String(x.bookId))
      .filter((v:string)=>/^[0-9]{6,20}$/.test(v));
    const recIds=[...new Set(recs)].slice(0,20);
    const now=N();

    const {error:updateError}=await db.from("dramafren_catalog_queue").update({
      canonical_url:canonical(book),
      status:"ready",
      title:String(book.bookName||"").trim()||null,
      cover_url:String(book.cover||book.coverWap||"").trim()||null,
      description:String(book.introduction||"").trim().slice(0,8000)||null,
      language:String(book.simpleLanguage||book.language||"en"),
      chapter_count:Number.isFinite(Number(book.chapterCount))?Number(book.chapterCount):null,
      shelf_time:asIso(book.firstShelfTime||book.shelfTime),
      tags,
      recommendation_ids:recIds,
      metadata:{book,metadata_source:"https://www.webfic.com/webfic/book/detail"},
      last_error:null,
      last_fetched_at:now,
      next_attempt_at:now,
      updated_at:now
    }).eq("book_id",item.book_id);
    if(updateError)throw updateError;

    let enqueued=0;
    if(Number(item.depth||0)<3){
      for(const rec of recommends){
        if(!rec?.bookId||!isEnglish(rec))continue;
        const id=String(rec.bookId);
        if(!/^[0-9]{6,20}$/.test(id)||id===String(item.book_id))continue;
        const payload={
          book_id:id,
          canonical_url:canonical(rec),
          discovered_from:String(item.book_id),
          status:"pending",
          depth:Number(item.depth||0)+1,
          title:String(rec.bookName||"").trim()||null,
          cover_url:String(rec.cover||rec.coverWap||"").trim()||null,
          description:String(rec.introduction||"").trim().slice(0,8000)||null,
          language:String(rec.simpleLanguage||rec.language||"en"),
          chapter_count:Number.isFinite(Number(rec.chapterCount))?Number(rec.chapterCount):null,
          shelf_time:asIso(rec.firstShelfTime||rec.shelfTime),
          tags:[...new Set([
            ...(Array.isArray(rec.tags)?rec.tags:[]),
            ...(Array.isArray(rec.labels)?rec.labels:[]),
            ...(Array.isArray(rec.typeTwoNames)?rec.typeTwoNames:[])
          ].map((x:any)=>String(x||"").trim()).filter(Boolean))].slice(0,20),
          updated_at:now
        };
        const {error}=await db.from("dramafren_catalog_queue").upsert(payload,{onConflict:"book_id",ignoreDuplicates:true});
        if(!error)enqueued++;
      }
    }
    return {ok:true,book_id:item.book_id,title:book.bookName,chapter_count:book.chapterCount,recommendations:recIds.length,enqueued};
  }catch(e){
    const m=e?.message||String(e);
    const attempts=Number(item.attempt_count||1);
    const delay=Math.min(1440,5*Math.pow(2,Math.min(attempts,8)));
    const next=new Date(Date.now()+delay*60000).toISOString();
    await db.from("dramafren_catalog_queue").update({
      status:"failed",
      last_error:String(m).slice(0,1000),
      next_attempt_at:next,
      last_fetched_at:N(),
      updated_at:N()
    }).eq("book_id",item.book_id);
    return {ok:false,book_id:item.book_id,error:m,next_attempt_at:next};
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==="GET")return J({ok:true,service:"dramafren-metadata-sync",source:"webfic-public-metadata"});
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  return J(await work());
});
