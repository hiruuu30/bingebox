import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const U=Deno.env.get("SUPABASE_URL")!;
const K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();

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
async function browse(pageNo:number){
  const r=await fetch("https://www.webfic.com/webfic/home/browse",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Accept":"application/json",
      "pline":"DRAMABOX",
      "language":"en",
      "User-Agent":"BingeBox Catalog Sync/1.0 (+https://bingebox.bond)"
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
async function syncGroup(group:number){
  if(!Number.isInteger(group)||group<0||group>5)throw new Error("group must be 0..5");
  const start=group*5+1;
  const now=N();
  const refreshAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
  let totalUpserted=0;
  let reportedTotal:number|null=null;
  let reportedPages:number|null=null;
  const pageResults:any[]=[];

  for(let page=start;page<start+5;page++){
    const data=await browse(page);
    reportedTotal=Number(data?.total)||reportedTotal;
    reportedPages=Number(data?.pages)||reportedPages;
    const books=Array.isArray(data?.bookList)?data.bookList:[];
    const rows=books
      .filter((b:any)=>String(b?.simpleLanguage||"en").toLowerCase()==="en" && /^[0-9]{6,20}$/.test(String(b?.bookId||"")))
      .map((b:any)=>({
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
      }));
    if(rows.length){
      const {error}=await db.from("dramafren_catalog_queue").upsert(rows,{onConflict:"book_id"});
      if(error)throw new Error(`Page ${page} upsert failed: ${error.message}`);
    }
    totalUpserted+=rows.length;
    pageResults.push({page,count:rows.length});
  }
  return {ok:true,group,start_page:start,end_page:start+4,upserted:totalUpserted,total:reportedTotal,pages:reportedPages,page_results:pageResults};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="GET")return J({ok:true,service:"dramafren-catalog-sync",groups:6,pages_per_group:5,page_size:100});
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  const u=new URL(req.url);
  const group=Number(u.searchParams.get("group")||"0");
  try{return J(await syncGroup(group))}
  catch(e){return J({ok:false,group,error:e?.message||String(e)},502)}
});