import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {parseHTML} from "npm:linkedom@0.18.12";

const U=Deno.env.get("SUPABASE_URL")!,K=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(U,K,{auth:{persistSession:false}});
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const N=()=>new Date().toISOString();
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36";
const PAGE_HOSTS=["dramafren.org","goodshort.com","netshort.com","shortnivo.com","reelshort.com","flickreels.net","idrama.video","idrama.com","mydramawave.com","shorttv.live","starshort.tv","flextv.cc","reelfren.com","moboreels.com"];
function allowedPageHost(h:string){h=h.toLowerCase();return PAGE_HOSTS.some(x=>h===x||h.endsWith("."+x))}


async function sha(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function authorized(req:Request){const t=req.headers.get("x-bingebox-sync-token")||"";if(!t)return false;const {data}=await db.from("source_sync_state").select("metadata").eq("source_key","dramafren_network").maybeSingle();return !!data?.metadata?.token_sha256&&(await sha(t))===String(data.metadata.token_sha256)}
function cleanTitle(v:any){let s=String(v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();s=s.replace(/^[▶►▷]\s*/,"").replace(/^\d+(?:\.\d+)?[KMB]?\s+/i,"");for(let i=0;i<3;i++){const n=s.replace(/\s*\|\s*(?:DramaPops|FlexPlayer|FlexTV|DramaFren|GoodShort|NetShort|FlickReels).*$/i,"").replace(/\s*[-–—]\s*(?:Full\s+Episodes?(?:\s+Free)?|Watch|Player).*$/i,"").replace(/\s+Drama$/i,"").trim();if(n===s)break;s=n}return s.replace(/^["'“”]+|["'“”]+$/g,"")}
function abs(v:string,b:string){try{return new URL(v,b).toString()}catch{return""}}
function epno(v:string){for(const r of [/[?&](?:ep|episode|e|no)=(\d{1,4})\b/i,/-ep-(\d{1,4})(?:[?#]|$)/i,/\/episode\/[^/?#]+-\d{5,22}-(\d{1,4})(?:[?#]|$)/i,/\/playlist\/[^/]+\/\d+\/episode-(\d{1,4})(?:[/?#]|$)/i,/(?:^|[\/_-])episode[-_\s]?(\d{1,4})/i,/\b(?:episode|ep)\s*#?\s*(\d{1,4})\b/i]){const m=String(v||"").match(r);if(m&&+m[1]>0)return +m[1]}return 0}
function genreOf(t:string,d:string){const x=(" "+t+" "+d+" ").toLowerCase();if(/\b(alpha|lycan|werewolf|wolf|mate|pack)\b/.test(x))return"werewolf";if(/\b(mafia|mob boss|gangster)\b/.test(x))return"mafia";if(/\b(revenge|vengeance|payback|betrayal)\b/.test(x))return"revenge";if(/\b(zombie|battle|warrior|assassin|action)\b/.test(x))return"action";if(/\b(thriller|suspense|stalker)\b/.test(x))return"thriller";if(/\b(magic|dragon|demon|goddess|immortal|fantasy)\b/.test(x))return"fantasy";if(/\b(ceo|billionaire|tycoon|heiress)\b/.test(x))return"billionaire";if(/\b(love|romance|marriage|husband|wife|bride|groom)\b/.test(x))return"romance";return"drama"}
function moodsOf(t:string,d:string){const x=(" "+t+" "+d+" ").toLowerCase(),a:string[]=[];for(const [m,r] of [["alpha",/\b(alpha|lycan|werewolf|mate|pack)\b/],["mafia",/\b(mafia|mob boss|gangster)\b/],["billionaire",/\b(billionaire|tycoon|ceo)\b/],["revenge",/\b(revenge|vengeance|payback|betrayal)\b/],["marriage",/\b(marriage|married|husband|wife|bride|groom)\b/],["family",/\b(family|mother|father|daughter|son|sister|brother|child)\b/],["fantasy",/\b(fantasy|magic|dragon|demon|goddess|immortal)\b/]] as any[])if(r.test(x))a.push(m);return a.slice(0,6)}
function parseMeta(html:string,url:string){const {document:d}=parseHTML(html);const vals:any[]=[];const add=(v:any,n:number)=>{const t=cleanTitle(v);if(t.length>=2&&t.length<=160)vals.push({t,n})};add(d.querySelector("h1")?.textContent,130);add(d.querySelector(".drama-title")?.textContent,125);add(d.querySelector(".series-title")?.textContent,125);add(d.querySelector('meta[property="og:title"]')?.getAttribute("content"),110);add(d.title,90);vals.sort((a,b)=>b.n-a.n);const title=vals[0]?.t||"";let description="";for(const s of ['meta[name="description"]','meta[property="og:description"]',".description",".synopsis",".summary"]){const e=d.querySelector(s),v=String(e?.getAttribute?.("content")||e?.textContent||"").replace(/\s+/g," ").trim();if(v.length>description.length&&v.length>=20)description=v}const poster=abs(String(d.querySelector('meta[property="og:image"]')?.getAttribute("content")||""),url)||null;return{title,description:description.slice(0,8000),poster,genre:genreOf(title,description),mood:moodsOf(title,description)}}
function parseEpisodes(html:string,url:string){const {document:d}=parseHTML(html),m=new Map<number,string>();for(const a of [...d.querySelectorAll("a[href]")]){const u=abs(String(a.getAttribute("href")||""),url);if(!u)continue;let x:URL;try{x=new URL(u)}catch{continue}if(!allowedPageHost(x.hostname))continue;const text=String(a.textContent||"").replace(/\s+/g," ").trim();let n=epno(u)||epno(text);if(!n&&/(^|\.)shorttv\.live$/i.test(x.hostname)&&/^\/episode\//i.test(x.pathname)){const mm=x.pathname.match(/-(\d{1,4})\/?$/);if(mm)n=Number(mm[1])}if(!n)continue;if(x.searchParams.get("page")==="watch"||x.searchParams.has("ep")||x.searchParams.has("ep_id")||x.searchParams.has("no")||/(watch|episode)/i.test(x.pathname+x.search))if(!m.has(n))m.set(n,x.toString())}return [...m.entries()].sort((a,b)=>a[0]-b[0]).map(([episode_number,watch_url])=>({episode_number,watch_url}))}

function assignedJson(html:string,marker:string){
  const at=html.indexOf(marker);if(at<0)return null;
  const start=html.indexOf("{",at+marker.length);if(start<0)return null;
  let depth=0,inStr=false,escp=false;
  for(let i=start;i<html.length;i++){
    const ch=html[i];
    if(inStr){
      if(escp){escp=false;continue}
      if(ch==="\\"){escp=true;continue}
      if(ch==='"')inStr=false;
      continue
    }
    if(ch==='"'){inStr=true;continue}
    if(ch==="{")depth++;
    else if(ch==="}"){depth--;if(depth===0){try{return JSON.parse(html.slice(start,i+1))}catch{return null}}}
  }
  return null
}
function findChapterState(x:any):any{
  if(!x||typeof x!=="object")return null;
  if(Array.isArray(x.chapterList)&&x.chapterList.length&&x.bookInfo)return x;
  if(Array.isArray(x)){for(const v of x){const hit=findChapterState(v);if(hit)return hit}return null}
  for(const v of Object.values(x)){const hit=findChapterState(v);if(hit)return hit}
  return null
}
function goodShortState(html:string){
  const root=assignedJson(html,"window.__INITIAL_STATE__=");
  return root?findChapterState(root):null;
}

async function fetchPage(url:string,ms=18000){const u=new URL(url);if(u.protocol!=="https:"||!allowedPageHost(u.hostname))throw Error("Rejected non-approved provider page");if(u.hostname==="goodshort.com"||u.hostname.endsWith(".goodshort.com")){const {data,error}=await db.rpc("fetch_goodshort_public_page",{p_url:url});if(error)throw Error("GoodShort fetch: "+error.message);const row=data?.[0]||{};if(Number(row.status||0)<200||Number(row.status||0)>=300)throw Error("GoodShort HTTP "+row.status);return{html:String(row.content||""),url}}const r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,*/*","Accept-Language":"en,en-US;q=0.9"},redirect:"follow",signal:AbortSignal.timeout(ms)});if(!r.ok)throw Error("Provider HTTP "+r.status);return{html:await r.text(),url:r.url||url}}
function blockedHost(h:string){h=h.toLowerCase();if(h==="localhost"||h.endsWith(".localhost")||h==="metadata.google.internal")return true;if(/^\d+\.\d+\.\d+\.\d+$/.test(h)){const p=h.split(".").map(Number);return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)}return false}
function candidates(html:string,url:string){const {document:d}=parseHTML(html),out:string[]=[],seen=new Set<string>();const add=(v:any)=>{let s=String(v||"").replace(/\\u002[fF]/g,"/").replace(/\\\//g,"/").replace(/&amp;/g,"&").replace(/[),;]+$/g,"");if(!s)return;let u:URL;try{u=new URL(s,url)}catch{return}if(u.protocol!=="https:"||blockedHost(u.hostname)||/(^|\.)dramafren\.org$/i.test(u.hostname)||/(^|\.)(dd133\.com|otieu\.com|cloudflareinsights\.com)$/i.test(u.hostname))return;const k=u.toString();if(!seen.has(k)){seen.add(k);out.push(k)}};for(const s of ["video[src]","source[src]","iframe[src]"])for(const e of [...d.querySelectorAll(s)])add(e.getAttribute("src"));let dec=html.replace(/\\u002[fF]/g,"/").replace(/\\\//g,"/").replace(/&amp;/g,"&");for(const m of dec.matchAll(/https:\/\/[^\s"'<>\\]+/gi))add(m[0]);for(const m of html.matchAll(/\batob\(\s*["']([A-Za-z0-9+/_=-]{20,})["']\s*\)/g)){try{let b=m[1].replace(/-/g,"+").replace(/_/g,"/");while(b.length%4)b+="=";add(atob(b))}catch{}}return out.slice(0,40)}
async function readBounded(r:Response,limit:number){if(!r.body)return new Uint8Array();const rd=r.body.getReader(),parts:Uint8Array[]=[];let size=0;try{while(size<limit){const {done,value}=await rd.read();if(done)break;const p=value.subarray(0,limit-size);parts.push(p);size+=p.length}}finally{await rd.cancel().catch(()=>{})}const o=new Uint8Array(size);let at=0;for(const p of parts){o.set(p,at);at+=p.length}return o}
async function verifyMedia(url:string){try{const u=new URL(url);if(u.protocol!=="https:"||blockedHost(u.hostname))return null;const r=await fetch(url,{headers:{Range:"bytes=0-4095","Accept":"video/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.5"},redirect:"follow",signal:AbortSignal.timeout(10000)});if(!(r.ok||r.status===206)){await r.body?.cancel();return null}const ct=(r.headers.get("content-type")||"").toLowerCase(),fin=r.url||url,path=new URL(fin).pathname.toLowerCase();if(ct.includes("mpegurl")||path.endsWith(".m3u8")){const bytes=await readBounded(r,262145);if(bytes.length>262144)return null;const t=new TextDecoder().decode(bytes);if(!t.trimStart().startsWith("#EXTM3U"))return null;const keys=t.split(/\r?\n/).filter(x=>/^#EXT-X-(SESSION-)?KEY\s*:/i.test(x));if(keys.some(x=>!/^#EXT-X-(SESSION-)?KEY\s*:\s*METHOD=NONE\s*$/i.test(x)))return null;return{url:fin,type:"hls",content_type:ct}}if(!ct.startsWith("video/")&&!ct.includes("octet-stream")&&!/\.(mp4|webm|mov)$/i.test(path)){await r.body?.cancel();return null}if((await readBounded(r,4096)).length===0)return null;return{url:fin,type:"direct",content_type:ct}}catch{return null}}
function expiry(url:string){try{const u=new URL(url);for(const k of ["Expires","expires","expire","expiry","exp","expiredTime"]){const v=u.searchParams.get(k);if(v&&/^\d{9,13}$/.test(v)){const n=Number(v);return new Date(n>1e12?n:n*1000).toISOString()}}const ak=u.searchParams.get("auth_key");if(ak){const m=ak.match(/^(\d{9,13})-/);if(m){const n=Number(m[1]);return new Date(n>1e12?n:n*1000).toISOString()}}}catch{}return null}
async function canonicalDrama(obs:any,meta:any){let current=obs.canonical_drama_id;const {data:dup}=await db.rpc("find_bingebox_drama_by_title",{p_title:meta.title||obs.source_title,p_exclude:current});const target=dup?.[0]?.id||current;if(!target)throw Error("Observation is not mapped to a BingeBox drama");if(target!==current){await db.from("content_source_map").update({drama_id:target,last_seen_at:N(),metadata:{provider:obs.metadata?.provider||null,deduped_by:"normalized_title"}}).eq("source_key",obs.source_key).eq("source_content_id",obs.source_content_id);await db.from("dramafren_source_observations").update({canonical_drama_id:target,match_status:"matched"}).eq("id",obs.id);if(current){const [{count:eps},{count:maps},{data:old}]=await Promise.all([db.from("episodes").select("id",{count:"exact",head:true}).eq("drama_id",current),db.from("content_source_map").select("id",{count:"exact",head:true}).eq("drama_id",current),db.from("dramas").select("published").eq("id",current).maybeSingle()]);if(!old?.published&&(eps||0)===0&&(maps||0)===0)await db.from("dramas").delete().eq("id",current)}}return target}
async function enqueueMany(rows:any[]){for(let i=0;i<rows.length;i+=300){const {error}=await db.from("sync_queue").upsert(rows.slice(i,i+300),{onConflict:"idempotency_key",ignoreDuplicates:true});if(error)throw error}}

let starGuest:any=null;
const STAR_BASE="https://cdp.wolftv.online";
const STAR_USER="https://user.wolftv.online";
function starHeaders(user:any=null){const h:any={"client-id":"1059","os-type":"5","language":"3","version-str":"beta3","Origin":"https://www.starshort.tv","Referer":"https://www.starshort.tv/"};if(user){h["user-token"]=String(user.userToken||"");h["uid"]=String(user.productUserId||"");h["accredit-id"]=String(user.authUserId||"")}return h}
async function starJson(url:string,init:any={}){const r=await fetch(url,{...init,headers:{...starHeaders(init.user||null),...(init.headers||{})},signal:AbortSignal.timeout(init.timeout||18000)});if(!r.ok)throw Error("StarShort HTTP "+r.status);const t=await r.text();try{return JSON.parse(t)}catch{throw Error("StarShort invalid JSON")}}
async function starGuestSession(){if(starGuest&&starGuest.expires>Date.now()+60000)return starGuest.data;const data=await starJson(STAR_USER+"/user/guest/login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!data?.userToken)throw Error("StarShort guest login failed");starGuest={data,expires:Date.now()+15*60*1000};return data}

async function resolveGoodShortEpisodes(job:any){
  const sourceKey=String(job.source_key),sourceId=String(job.source_content_id);
  const {data:obs,error}=await db.from("dramafren_source_observations").select("*").eq("source_key",sourceKey).eq("source_content_id",sourceId).maybeSingle();
  if(error)throw error;if(!obs)throw Error("Provider observation missing");
  const detail=await fetchPage(obs.source_url,18000),meta=parseMeta(detail.html,detail.url);
  const firstMatch=detail.html.match(/https:\/\/www\.goodshort\.com\/episode\/[^"'\s<]+/i);
  if(!firstMatch)throw Error("GoodShort first episode URL missing");
  const firstUrl=String(firstMatch[0]).replace(/&amp;/g,"&");
  const episodePage=await fetchPage(firstUrl,18000);
  const state=goodShortState(episodePage.html);
  const list=Array.isArray(state?.chapterList)?state.chapterList:[];
  const book=state?.bookInfo||{};
  if(!list.length)throw Error("GoodShort chapterList missing");
  if(!meta.title)meta.title=cleanTitle(book.bookName||obs.source_title);
  if(!meta.description)meta.description=String(book.introduction||"").slice(0,8000);
  if(!meta.poster)meta.poster=String(book.cover||obs.metadata?.cover_url||"")||null;
  meta.genre=genreOf(meta.title,meta.description);meta.mood=moodsOf(meta.title,meta.description);
  const dramaId=await canonicalDrama(obs,meta);
  const {data:d}=await db.from("dramas").select("published,title,description,poster_url").eq("id",dramaId).single();
  const patch:any={updated_at:N()};
  if(!d?.published||!d?.title)patch.title=meta.title;
  if(!d?.description&&meta.description)patch.description=meta.description;
  if(meta.poster&&(!d?.poster_url||/default-book-cover|placeholder|\/assets\/brand\/mark\.svg/i.test(String(d.poster_url))))patch.poster_url=meta.poster;
  if(!d?.published){patch.genre=meta.genre;patch.mood=meta.mood}
  await db.from("dramas").update(patch).eq("id",dramaId);

  const {data:known,error:ke}=await db.from("episodes").select("id,episode_number,video_key,video_url,published").eq("drama_id",dramaId);if(ke)throw ke;
  const em=new Map((known||[]).map((x:any)=>[Number(x.episode_number),x])),up:any[]=[];
  const parsed:any[]=[];
  const bookPath=String(book.bookResourceUrl||"").replace(/^\/+|\/+$/g,"");
  for(const ch of list){
    const n=Number(ch.chapterName)||Number(ch.index)+1;if(!n)continue;
    const old:any=em.get(n);
    const chapterPath=String(ch.chapterResourceUrl||"").replace(/^\/+|\/+$/g,"");
    const watchUrl=bookPath&&chapterPath?("https://www.goodshort.com/episode/"+bookPath+"/"+chapterPath):firstUrl;
    const mediaUrl=String(ch.m3u8Path||"").replace(/\\u002[fF]/g,"/").replace(/\\\//g,"/").trim();
    parsed.push({episode_number:n,chapter_id:String(ch.id||chapterPath||n),watch_url:watchUrl,media_url:mediaUrl,locked:!mediaUrl,play_time:Number(ch.playTime||0)});
    up.push({drama_id:dramaId,episode_number:n,title:old?.title||"",video_key:old?.video_key||null,video_url:old?.video_url||null,published:!!old?.published,updated_at:N()});
  }
  const saved:any[]=[];
  for(let i=0;i<up.length;i+=300){
    const {data,error:ue}=await db.from("episodes").upsert(up.slice(i,i+300),{onConflict:"drama_id,episode_number"}).select("id,episode_number,video_key,published");
    if(ue)throw ue;saved.push(...(data||[]))
  }
  const byNum=new Map(saved.map((x:any)=>[Number(x.episode_number),x])),queue:any[]=[];
  for(const e of parsed){
    const ep:any=byNum.get(e.episode_number);if(!ep||ep.video_key||!e.media_url)continue;
    const exp=expiry(e.media_url)||"durable";
    const v=await sha(e.chapter_id+"|"+exp);
    queue.push({
      source_key:sourceKey,source_content_id:sourceId,job_type:"provider_resolve_media",
      idempotency_key:"bingebox:"+sourceKey+":"+sourceId+":goodshort_media:v1:"+e.episode_number+":"+v.slice(0,16),
      payload:{provider:"GoodShort",drama_id:dramaId,episode_id:ep.id,episode_number:e.episode_number,watch_url:e.watch_url,media_url:e.media_url,chapter_id:e.chapter_id},
      priority:58,status:"pending",updated_at:N()
    })
  }
  await enqueueMany(queue);
  const publicCount=parsed.filter((x:any)=>!!x.media_url).length;
  await db.from("dramafren_source_observations").update({source_title:meta.title,last_seen_at:N(),metadata:{...(obs.metadata||{}),provider:"GoodShort",description:meta.description,cover_url:meta.poster,episode_count:parsed.length,public_episode_count:publicCount,detail_last_resolved_at:N()}}).eq("id",obs.id);
  await db.from("content_source_map").update({last_seen_at:N(),metadata:{provider:"GoodShort",episode_count:parsed.length,public_episode_count:publicCount,detail_last_resolved_at:N()}}).eq("source_key",sourceKey).eq("source_content_id",sourceId);
  return{source_key:sourceKey,source_content_id:sourceId,drama_id:dramaId,title:meta.title,episodes:parsed.length,public_episodes:publicCount,media_jobs:queue.length};
}

async function resolveStarEpisodes(job:any){
  const sourceKey=String(job.source_key),sourceId=String(job.source_content_id);
  const {data:obs,error}=await db.from("dramafren_source_observations").select("*").eq("source_key",sourceKey).eq("source_content_id",sourceId).maybeSingle();
  if(error)throw error;if(!obs)throw Error("Provider observation missing");
  let fake=String(obs.metadata?.fake_id||"");
  if(!fake){try{fake=new URL(obs.source_url).searchParams.get("fakeId")||""}catch{}}
  if(!fake)throw Error("StarShort fakeId missing");
  const [info,list]=await Promise.all([
    starJson(STAR_BASE+"/content/compilations/v2/"+encodeURIComponent(fake)),
    starJson(STAR_BASE+"/content/state_res/episodic_movie/movies/"+encodeURIComponent(fake))
  ]);
  if(!Array.isArray(list)||!list.length)throw Error("StarShort episode list empty");
  const meta={title:cleanTitle(info?.title||obs.source_title),description:String(info?.introduce||"").slice(0,8000),poster:info?.coverImgUrl||obs.metadata?.cover_url||null,genre:genreOf(info?.title||obs.source_title,info?.introduce||""),mood:moodsOf(info?.title||obs.source_title,info?.introduce||"")};
  const dramaId=await canonicalDrama(obs,meta);
  const {data:d}=await db.from("dramas").select("published,title,description,poster_url").eq("id",dramaId).single();
  const patch:any={updated_at:N()};if(!d?.published||!d?.title)patch.title=meta.title;if(!d?.description&&meta.description)patch.description=meta.description;if(meta.poster&&(!d?.poster_url||/default-book-cover|placeholder|\/assets\/brand\/mark\.svg/i.test(String(d.poster_url))))patch.poster_url=meta.poster;if(!d?.published){patch.genre=meta.genre;patch.mood=meta.mood}
  await db.from("dramas").update(patch).eq("id",dramaId);
  const {data:known,error:ke}=await db.from("episodes").select("id,episode_number,video_key,video_url,published").eq("drama_id",dramaId);if(ke)throw ke;
  const em=new Map((known||[]).map((x:any)=>[Number(x.episode_number),x])),up:any[]=[];
  for(const e of list){const n=Number(e.sequence)+1;if(!n)continue;const old:any=em.get(n);up.push({drama_id:dramaId,episode_number:n,title:old?.title||String(e.title||""),video_key:old?.video_key||null,video_url:old?.video_url||null,published:!!old?.published,updated_at:N()})}
  const saved:any[]=[];for(let i=0;i<up.length;i+=300){const {data,error:ue}=await db.from("episodes").upsert(up.slice(i,i+300),{onConflict:"drama_id,episode_number"}).select("id,episode_number,video_key,published");if(ue)throw ue;saved.push(...(data||[]))}
  const byNum=new Map(saved.map((x:any)=>[Number(x.episode_number),x])),queue:any[]=[];
  for(const e of list){const n=Number(e.sequence)+1,ep:any=byNum.get(n);if(!ep||ep.video_key)continue;queue.push({source_key:sourceKey,source_content_id:sourceId,job_type:"provider_resolve_media",idempotency_key:"bingebox:"+sourceKey+":"+sourceId+":starshort_media:v1:"+n+":"+String(e.videoFakeId||e.id),payload:{provider:"StarShort",drama_id:dramaId,episode_id:ep.id,episode_number:n,episodic_drama_id:e.id,compilations_id:e.compilationsId||info?.id,video_fake_id:e.videoFakeId,fake_id:fake},priority:55,status:"pending",updated_at:N()})}
  await enqueueMany(queue);
  await db.from("dramafren_source_observations").update({source_title:meta.title,last_seen_at:N(),metadata:{...(obs.metadata||{}),fake_id:fake,description:meta.description,cover_url:meta.poster,episode_count:list.length,detail_last_resolved_at:N()}}).eq("id",obs.id);
  return{source_key:sourceKey,source_content_id:sourceId,drama_id:dramaId,title:meta.title,episodes:list.length,media_jobs:queue.length};
}
async function resolveStarMedia(job:any){
  const p=job.payload||{},user=await starGuestSession();
  const x=await starJson(STAR_BASE+"/cdp/episodic_drama_video/play_info",{method:"POST",user,headers:{"Content-Type":"application/json"},body:JSON.stringify({episodicDramaId:p.episodic_drama_id,compilationsId:p.compilations_id,videoFakeId:p.video_fake_id})});
  if(x?.needUnLock||!x?.videoUrl)return{episode_id:p.episode_id,episode_number:p.episode_number,locked:true};
  const good=await verifyMedia(String(x.videoUrl));if(!good)throw Error("StarShort video URL failed verification");
  const {data:ep,error:ee}=await db.from("episodes").select("id,drama_id,episode_number,video_key").eq("id",p.episode_id).maybeSingle();if(ee)throw ee;if(!ep)throw Error("Episode missing");if(ep.video_key)return{episode_id:ep.id,preserved_r2:true};
  const provider="starshort_web",u=new URL(good.url),fp=await sha(u.hostname.toLowerCase()+u.pathname),exp=expiry(good.url);
  const {data:rows,error:se}=await db.from("episode_sources").select("*").eq("episode_id",ep.id).order("priority",{ascending:true});if(se)throw se;const list=rows||[];let row=list.find((x:any)=>x.provider===provider&&x.source_fingerprint===fp),sourceId:string;
  if(row){sourceId=row.id;const {error}=await db.from("episode_sources").update({server_label:"StarShort",source_type:good.type==="hls"?"hls":"direct",source_url:good.url,origin_source_url:good.url,active:true,source_stability:exp?"temporary":"unknown",expires_at:exp,health_status:"healthy",last_verified_at:N(),last_failed_at:null,updated_at:N()}).eq("id",row.id);if(error)throw error}
  else{const maxp=list.reduce((m:number,x:any)=>Math.max(m,Number(x.priority)||0),0);const {data:nr,error}=await db.from("episode_sources").insert({episode_id:ep.id,provider,server_label:"StarShort",source_type:good.type==="hls"?"hls":"direct",source_url:good.url,origin_source_url:good.url,source_fingerprint:fp,priority:maxp+1,active:true,source_stability:exp?"temporary":"unknown",expires_at:exp,health_status:"healthy",last_verified_at:N()}).select("id").single();if(error)throw error;sourceId=nr.id}
  await db.from("episodes").update({video_url:good.url,published:true,publish_at:null,updated_at:N()}).eq("id",ep.id);await db.from("dramas").update({published:true,publish_at:null,updated_at:N()}).eq("id",ep.drama_id);
  return{episode_id:ep.id,episode_number:ep.episode_number,provider,source_id:sourceId,media_host:u.hostname,type:good.type};
}

async function resolveEpisodes(job:any){const sourceKey=String(job.source_key),sourceId=String(job.source_content_id);if(sourceKey==="dramafren_starshort")return await resolveStarEpisodes(job);if(sourceKey==="dramafren_goodshort")return await resolveGoodShortEpisodes(job);const {data:obs,error}=await db.from("dramafren_source_observations").select("*").eq("source_key",sourceKey).eq("source_content_id",sourceId).maybeSingle();if(error)throw error;if(!obs)throw Error("Provider observation missing");const p=await fetchPage(obs.source_url,sourceKey==="dramafren_dramapops"?22000:16000),meta=parseMeta(p.html,p.url),eps=parseEpisodes(p.html,p.url);if(!eps.length)throw Error("No episode links found on provider detail page");if(!meta.title)meta.title=cleanTitle(obs.source_title);const dramaId=await canonicalDrama(obs,meta);const {data:d}=await db.from("dramas").select("published,title,description,poster_url").eq("id",dramaId).single();const patch:any={updated_at:N()};if(!d?.published||!d?.title)patch.title=meta.title;if(!d?.description&&meta.description)patch.description=meta.description;if(!d?.poster_url&&meta.poster)patch.poster_url=meta.poster;if(!d?.published){patch.genre=meta.genre;patch.mood=meta.mood}await db.from("dramas").update(patch).eq("id",dramaId);const {data:known,error:ke}=await db.from("episodes").select("id,episode_number,video_key,video_url,published").eq("drama_id",dramaId);if(ke)throw ke;const em=new Map((known||[]).map((x:any)=>[Number(x.episode_number),x]));const up:any[]=[];for(const e of eps){const old:any=em.get(e.episode_number);up.push({drama_id:dramaId,episode_number:e.episode_number,title:old?.title||"",video_key:old?.video_key||null,video_url:old?.video_url||null,published:!!old?.published,updated_at:N()})}const saved:any[]=[];for(let i=0;i<up.length;i+=300){const {data,error:ue}=await db.from("episodes").upsert(up.slice(i,i+300),{onConflict:"drama_id,episode_number"}).select("id,episode_number,video_key,published");if(ue)throw ue;saved.push(...(data||[]))}const byNum=new Map(saved.map((x:any)=>[Number(x.episode_number),x])),queue:any[]=[];for(const e of eps){const ep:any=byNum.get(e.episode_number);if(!ep||ep.video_key)continue;const v=await sha(e.watch_url);queue.push({source_key:sourceKey,source_content_id:sourceId,job_type:"provider_resolve_media",idempotency_key:"bingebox:"+sourceKey+":"+sourceId+":provider_media:v2:"+e.episode_number+":"+v.slice(0,16),payload:{provider:obs.metadata?.provider||sourceKey.replace("dramafren_",""),drama_id:dramaId,episode_id:ep.id,episode_number:e.episode_number,watch_url:e.watch_url},priority:60,status:"pending",updated_at:N()})}await enqueueMany(queue);await db.from("dramafren_source_observations").update({source_title:meta.title,last_seen_at:N(),metadata:{...(obs.metadata||{}),provider:obs.metadata?.provider||null,description:meta.description,cover_url:meta.poster,episode_count:eps.length,detail_last_resolved_at:N()}}).eq("id",obs.id);await db.from("content_source_map").update({last_seen_at:N(),metadata:{provider:obs.metadata?.provider||null,episode_count:eps.length,detail_last_resolved_at:N()}}).eq("source_key",sourceKey).eq("source_content_id",sourceId);return{source_key:sourceKey,source_content_id:sourceId,drama_id:dramaId,title:meta.title,episodes:eps.length,media_jobs:queue.length}}
async function resolveMedia(job:any){if(String(job.source_key)==="dramafren_starshort")return await resolveStarMedia(job);const p=job.payload||{},watch=String(p.watch_url||""),directMedia=String(p.media_url||"");let good:any=null;if(directMedia){good=await verifyMedia(directMedia);if(!good)throw Error("Provider media URL failed verification")}else{if(!watch)throw Error("Missing watch URL");const page=await fetchPage(watch,18000),cs=candidates(page.html,page.url);if(!cs.length)throw Error("No reusable media candidates exposed by watch page");for(const c of cs){const v=await verifyMedia(c);if(v){good=v;break}}if(!good)throw Error("Media candidates found, but none verified as reusable video")}const {data:ep,error:ee}=await db.from("episodes").select("id,drama_id,episode_number,video_key").eq("id",p.episode_id).maybeSingle();if(ee)throw ee;if(!ep)throw Error("Episode missing");if(ep.video_key)return{episode_id:ep.id,preserved_r2:true};const provider=(String(p.provider||job.source_key).toLowerCase().replace(/[^a-z0-9]+/g,"_")+"_web").replace(/^dramafren_/,""),fp=await sha(new URL(good.url).hostname.toLowerCase()+new URL(good.url).pathname),exp=expiry(good.url);const {data:rows,error:se}=await db.from("episode_sources").select("*").eq("episode_id",ep.id).order("priority",{ascending:true});if(se)throw se;const list=rows||[];let row=list.find((x:any)=>x.provider===provider&&x.source_fingerprint===fp),sourceId:string;if(row){sourceId=row.id;const {error}=await db.from("episode_sources").update({server_label:String(p.provider||"Provider"),source_type:good.type==="hls"?"hls":"direct",source_url:good.url,origin_source_url:good.url,active:true,source_stability:exp?"temporary":"unknown",expires_at:exp,health_status:"healthy",last_verified_at:N(),last_failed_at:null,updated_at:N()}).eq("id",row.id);if(error)throw error}else{const maxp=list.reduce((m:number,x:any)=>Math.max(m,Number(x.priority)||0),0);const {data:nr,error}=await db.from("episode_sources").insert({episode_id:ep.id,provider,server_label:String(p.provider||"Provider"),source_type:good.type==="hls"?"hls":"direct",source_url:good.url,origin_source_url:good.url,source_fingerprint:fp,priority:maxp+1,active:true,source_stability:exp?"temporary":"unknown",expires_at:exp,health_status:"healthy",last_verified_at:N()}).select("id").single();if(error)throw error;sourceId=nr.id}await db.from("episodes").update({video_url:good.url,published:true,publish_at:null,updated_at:N()}).eq("id",ep.id);await db.from("dramas").update({published:true,publish_at:null,updated_at:N()}).eq("id",ep.drama_id);return{episode_id:ep.id,episode_number:ep.episode_number,provider,source_id:sourceId,media_host:new URL(good.url).hostname,type:good.type}}
async function complete(job:any,result:any){await db.from("sync_queue").update({status:"completed",payload:{...job.payload,result,_completed:true},heartbeat_at:N(),lease_expires_at:null,completed_at:N(),updated_at:N(),last_error:null}).eq("id",job.id)}
async function fail(job:any,e:any){const msg=String(e?.message||e).slice(0,1500),a=Number(job.attempt_count||1);if(a>=6){await db.from("sync_queue").update({status:"failed",last_error:msg,heartbeat_at:N(),lease_expires_at:null,updated_at:N()}).eq("id",job.id);return{failed:true,error:msg}}const mins=Math.min(180,Math.pow(2,Math.min(a,7)));await db.from("sync_queue").update({status:"retry_wait",last_error:msg,next_retry_at:new Date(Date.now()+mins*60000).toISOString(),heartbeat_at:N(),lease_expires_at:null,updated_at:N()}).eq("id",job.id);return{retry:true,error:msg,retry_minutes:mins}}
async function workOne(types:string[],sourceKey:string|null=null){const worker=crypto.randomUUID();const claim=sourceKey?await db.rpc("claim_sync_queue_job_for_source",{p_worker:worker,p_job_types:types,p_source_key:sourceKey,p_lease_seconds:120}):await db.rpc("claim_sync_queue_job_filtered",{p_worker:worker,p_job_types:types,p_lease_seconds:120});const {data,error}=claim;if(error)return{ok:false,error:"claim: "+error.message};const job=data?.[0];if(!job)return{ok:true,idle:true};try{const result=job.job_type==="provider_resolve_episodes"?await resolveEpisodes(job):await resolveMedia(job);await complete(job,result);await db.from("sync_events").insert({source_key:job.source_key,event_type:"provider_job_completed",source_content_id:job.source_content_id,details:{job_id:job.id,job_type:job.job_type,result}});return{ok:true,job_id:job.id,job_type:job.job_type,result}}catch(e){const r=await fail(job,e);await db.from("sync_events").insert({source_key:job.source_key,event_type:r.failed?"provider_job_failed":"provider_job_retry",source_content_id:job.source_content_id,details:{job_id:job.id,job_type:job.job_type,error:e?.message||String(e)}});return{ok:false,job_id:job.id,job_type:job.job_type,...r}}}
Deno.serve(async(req:Request)=>{if(!(await authorized(req)))return J({error:"Unauthorized"},401);if(req.method==="GET")return J({ok:true,service:"dramafren-provider-worker"});if(req.method!=="POST")return J({error:"Method not allowed"},405);const u=new URL(req.url),lane=u.searchParams.get("lane")||"episodes",source=u.searchParams.get("source")||null,types=lane==="media"?["provider_resolve_media"]:["provider_resolve_episodes"],limit=source==="dramafren_dramapops"?1:(lane==="media"?4:2),results:any[]=[];for(let i=0;i<limit;i++){const r=await workOne(types,source);results.push(r);if(r.idle)break}return J({ok:results.every((x:any)=>x.ok!==false||x.retry),lane,source,processed:results.filter((x:any)=>!x.idle).length,results})});