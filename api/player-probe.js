const TEST_URL = 'https://vidnest.fun/movie/238?1=1';
const TERMS = ['window.open','popup','doubleclick','disable sandbox'];

export async function GET() {
  const base = await fetch(TEST_URL, { redirect:'follow', headers:{'user-agent':'Mozilla/5.0','referer':'https://movie.bingebox.bond/'} });
  const html = await base.text();
  const srcs = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]).filter(Boolean);
  const results=[];
  for (const src of srcs.slice(0,30)) {
    try {
      const u=new URL(src,base.url).toString();
      const res=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','referer':base.url}});
      const text=await res.text();
      const lower=text.toLowerCase();
      const hits=[];
      for (const term of TERMS) {
        const i=lower.indexOf(term.toLowerCase());
        if(i>=0) hits.push({term,snippet:text.slice(Math.max(0,i-900),Math.min(text.length,i+2600))});
      }
      if(hits.length) results.push({url:u,status:res.status,length:text.length,hits});
    } catch(error){ results.push({url:src,error:String(error)}); }
  }
  return new Response(JSON.stringify({page:{status:base.status,length:html.length},results}),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
