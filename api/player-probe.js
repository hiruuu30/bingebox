const TEST_URL = 'https://vidlink.pro/movie/238';
const TERMS = ['window.open','popunder','popads','popup','adsterra','monetag','propeller','aclib','acscdn','doubleclick','googlesyndication','target="_blank"','disable sandbox'];

export async function GET() {
  const base = await fetch(TEST_URL, {
    redirect:'follow',
    headers:{
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'referer':'https://movie.bingebox.bond/',
      'accept':'text/html,application/xhtml+xml'
    }
  });
  const html=await base.text();
  const srcs=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]).filter(Boolean);
  const results=[];
  for(const src of srcs.slice(0,40)){
    try{
      const u=new URL(src,base.url).toString();
      const res=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','referer':base.url}});
      const text=await res.text();
      const low=text.toLowerCase();
      const hits=TERMS.filter(t=>low.includes(t.toLowerCase()));
      if(hits.length) results.push({url:u,status:res.status,length:text.length,hits});
    }catch(error){results.push({url:src,error:String(error)})}
  }
  return new Response(JSON.stringify({
    page:{
      status:base.status,
      finalUrl:base.url,
      length:html.length,
      hits:TERMS.filter(t=>html.toLowerCase().includes(t.toLowerCase())),
      iframeCount:(html.match(/<iframe\b/gi)||[]).length,
      videoCount:(html.match(/<video\b/gi)||[]).length
    },
    suspiciousScripts:results
  }),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
