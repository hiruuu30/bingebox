const SUPABASE_URL='https://shffgnuprnycqblpwkrp.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
const memory=new Map();

function json(body,status=200,source='live'){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':status===200?'public, max-age=10, s-maxage=60, stale-while-revalidate=300':'no-store',
      'x-bingebox-search-source':source
    }
  });
}

function boolParam(value){
  if(value===null||value==='')return null;
  if(value==='true'||value==='1')return true;
  if(value==='false'||value==='0')return false;
  return null;
}

export async function GET(request){
  const url=new URL(request.url);
  const q=String(url.searchParams.get('q')||'').trim().slice(0,100);
  const genre=String(url.searchParams.get('genre')||'').trim().slice(0,50)||null;
  const complete=boolParam(url.searchParams.get('complete'));
  const r18=boolParam(url.searchParams.get('r18'));
  const limit=Math.min(40,Math.max(1,Number.parseInt(url.searchParams.get('limit')||'30',10)||30));
  const key=JSON.stringify([q.toLowerCase(),genre?.toLowerCase()||'',complete,r18,limit]);
  const cached=memory.get(key);
  if(cached&&Date.now()-cached.at<60000)return json({items:cached.items,query:q,cached:true},200,'memory');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_bingebox_dramas`,{
      method:'POST',
      signal:controller.signal,
      headers:{apikey:PUBLISHABLE_KEY,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({p_query:q,p_limit:limit,p_genre:genre,p_complete:complete,p_r18:r18}),
      cache:'no-store'
    });
    if(!res.ok){
      const detail=(await res.text().catch(()=>'' )).slice(0,120);
      throw new Error(`supabase_${res.status}_${detail}`);
    }
    const rows=await res.json();
    if(!Array.isArray(rows))throw new Error('invalid_search_payload');
    const items=rows.map(d=>({
      id:d.id,slug:d.slug,title:d.title,genre:d.genre,mood:d.mood,poster_url:d.poster_url,
      featured:d.featured,is_complete:d.is_complete,is_r18:d.is_r18,
      score:d.score,match_reason:d.match_reason
    }));
    memory.set(key,{items,at:Date.now()});
    if(memory.size>100)memory.delete(memory.keys().next().value);
    return json({items,query:q},200,'live');
  }catch(error){
    if(cached)return json({items:cached.items,query:q,cached:true,stale:true},200,'stale-memory');
    return json({error:'search_temporarily_unavailable'},503,'unavailable');
  }finally{clearTimeout(timer)}
}
