const SUPABASE_URL='https://shffgnuprnycqblpwkrp.supabase.co';
const KEY='sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
const headers={apikey:KEY,Accept:'application/json'};

async function timed(label,fn){
  const started=Date.now();
  try{
    const value=await fn();
    return {label,ok:true,ms:Date.now()-started,value};
  }catch(error){
    return {label,ok:false,ms:Date.now()-started,error:String(error?.message||error)};
  }
}

export async function GET(){
  const drama=await timed('drama_lookup',async()=>{
    const r=await fetch(SUPABASE_URL+'/rest/v1/dramas?published=eq.true&slug=eq.hero-husband-s-apocalypse-harem&select=id,slug,title&limit=1',{headers,cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json(); if(!rows?.[0])throw new Error('not_found'); return rows[0];
  });
  if(!drama.ok)return Response.json({ok:false,steps:[drama]},{status:503});

  const eps=await timed('playable_episode_rpc',async()=>{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/get_drama_playable_episodes',{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_drama_id:drama.value.id}),cache:'no-store'
    });
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json(); if(!rows?.length)throw new Error('no_playable_episodes'); return {count:rows.length,first:rows[0]};
  });
  if(!eps.ok)return Response.json({ok:false,steps:[drama,{...eps,value:undefined}]},{status:503});

  const first=eps.value.first;
  const src=await timed('source_lookup',async()=>{
    const q=SUPABASE_URL+'/rest/v1/episode_sources?episode_id=eq.'+encodeURIComponent(first.episode_id)+'&active=eq.true&select=provider,source_type,source_url,health_status,priority&order=priority.asc&limit=3';
    const r=await fetch(q,{headers,cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json();
    return {count:rows.length,providers:rows.map(x=>x.provider),healthy:rows.map(x=>x.health_status)};
  });

  const token=first.video_key?await timed('r2_token',async()=>{
    const r=await fetch('https://bingebox-upload.hero-tolentino.workers.dev/token?key='+encodeURIComponent(first.video_key),{headers:{Accept:'application/json'},cache:'no-store'});
    const body=await r.json().catch(()=>({}));
    if(!r.ok||!body.url)throw new Error('HTTP '+r.status);
    return {urlIssued:true};
  }):{label:'r2_token',ok:true,ms:0,value:{skipped:true}};

  const steps=[drama,{...eps,value:{count:eps.value.count,first:{episode_id:first.episode_id,episode_number:first.episode_number,has_video_key:!!first.video_key,has_video_url:!!first.video_url}}},src,token];
  return Response.json({ok:steps.every(x=>x.ok),steps},{headers:{'cache-control':'no-store'}});
}
