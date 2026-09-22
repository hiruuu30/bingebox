const PAGE='https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/vidnest-clean/movie/238?1=1';
const CHUNK='https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/vidnest-clean/_next/static/chunks/47fb01a2314683e3.js';

export async function GET(){
  const [p,c]=await Promise.all([
    fetch(PAGE,{headers:{'user-agent':'Mozilla/5.0'}}),
    fetch(CHUNK,{headers:{'user-agent':'Mozilla/5.0'}})
  ]);
  const [pt,ct]=await Promise.all([p.text(),c.text()]);
  return new Response(JSON.stringify({
    page:{
      status:p.status,
      length:pt.length,
      hasProxyBase:pt.includes('/functions/v1/vidnest-clean/'),
      hasWindowOpen:pt.includes('window.open'),
      hasHai8g:pt.includes('hai8g.com'),
      hasAdWorker:pt.includes('fetch.streaming-1.workers.dev')
    },
    chunk:{
      status:c.status,
      length:ct.length,
      contentType:c.headers.get('content-type'),
      hasWindowOpen:ct.includes('window.open'),
      hasHai8g:ct.includes('hai8g.com'),
      hasAdWorker:ct.includes('fetch.streaming-1.workers.dev'),
      sample:(()=>{const i=ct.indexOf('67248'); return i>=0?ct.slice(i,i+1600):ct.slice(0,1000)})()
    }
  }),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
