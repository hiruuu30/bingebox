const SUPABASE_URL='https://shffgnuprnycqblpwkrp.supabase.co';
const KEY='sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
const headers={apikey:KEY,Accept:'application/json'};

async function timed(label,fn){
  const started=Date.now();
  try{return {label,ok:true,ms:Date.now()-started,value:await fn()}}
  catch(error){return {label,ok:false,ms:Date.now()-started,error:String(error?.message||error)}}
}

export async function GET(){
  const catalog=await timed('catalog_snapshot',async()=>{
    const r=await fetch('https://bingebox.bond/data/catalog.json',{cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const body=await r.json();
    const items=Array.isArray(body)?body:body?.items;
    const drama=(items||[]).find(x=>x.slug==='hero-husband-s-apocalypse-harem')||(items||[])[0];
    if(!drama?.id)throw new Error('no_drama');
    return {id:drama.id,slug:drama.slug,title:drama.title};
  });
  if(!catalog.ok)return Response.json({ok:false,steps:[catalog]},{status:503});

  const episodes=await timed('episode_lookup',async()=>{
    const q=new URL(SUPABASE_URL+'/rest/v1/episodes');
    q.searchParams.set('drama_id','eq.'+catalog.value.id);
    q.searchParams.set('published','eq.true');
    q.searchParams.set('select','id,episode_number,video_key,video_url');
    q.searchParams.set('order','episode_number.asc');
    q.searchParams.set('limit','5');
    const r=await fetch(q,{headers,cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json();
    if(!rows?.length)throw new Error('no_published_episodes');
    return {count:rows.length,first:rows[0]};
  });
  if(!episodes.ok)return Response.json({ok:false,steps:[catalog,episodes]},{status:503});

  const first=episodes.value.first;
  const media=await timed('media_probe',async()=>{
    if(!first.video_url)return {skipped:true,reason:'no_direct_url'};
    const r=await fetch(first.video_url,{method:'HEAD',cache:'no-store',redirect:'follow'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return {reachable:true,contentType:r.headers.get('content-type')||null};
  });

  const source=await timed('alternate_source_lookup',async()=>{
    const q=SUPABASE_URL+'/rest/v1/episode_sources?episode_id=eq.'+encodeURIComponent(first.id)+'&active=eq.true&select=provider,source_type,health_status,priority&order=priority.asc&limit=3';
    const r=await fetch(q,{headers,cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json();
    return {count:rows.length,providers:rows.map(x=>x.provider),health:rows.map(x=>x.health_status)};
  });

  const critical=[catalog,episodes,media];
  return Response.json({
    ok:critical.every(x=>x.ok),
    steps:[
      catalog,
      {...episodes,value:{count:episodes.value.count,first:{id:first.id,episode_number:first.episode_number,has_video_key:!!first.video_key,has_video_url:!!first.video_url}}},
      media,
      source
    ]
  },{status:critical.every(x=>x.ok)?200:503,headers:{'cache-control':'no-store'}});
}
