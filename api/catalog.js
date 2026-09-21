const SUPABASE_URL='https://shffgnuprnycqblpwkrp.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
const LIMIT=160;
let memoryItems=null;
let memoryAt=0;

function response(body,status=200,source='live'){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':status===200?'public, max-age=30, s-maxage=300, stale-while-revalidate=86400':'no-store',
      'x-bingebox-catalog-source':source
    }
  });
}

async function fetchCatalog(){
  const params=new URLSearchParams({
    published:'eq.true',
    select:'id,slug,title,genre,mood,description,poster_url,featured,sort_order,created_at,updated_at,is_complete,publish_at,is_r18',
    limit:String(LIMIT)
  });
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/dramas?${params}`,{
      signal:controller.signal,
      headers:{apikey:PUBLISHABLE_KEY,Accept:'application/json'},
      cache:'no-store'
    });
    if(!res.ok)throw new Error(`supabase_${res.status}`);
    const rows=await res.json();
    if(!Array.isArray(rows)||!rows.length)throw new Error('empty_catalog');
    memoryItems=rows;
    memoryAt=Date.now();
    return rows;
  }finally{
    clearTimeout(timer);
  }
}

export async function GET(){
  try{
    const items=await fetchCatalog();
    return response({items,generatedAt:new Date().toISOString()},200,'live');
  }catch(error){
    if(Array.isArray(memoryItems)&&memoryItems.length){
      return response({items:memoryItems,generatedAt:new Date(memoryAt).toISOString(),stale:true},200,'memory');
    }
    return response({error:'catalog_temporarily_unavailable'},503,'unavailable');
  }
}
