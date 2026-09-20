(() => {
  const config=window.BINGEBOX_CONFIG||{};
  const PAYMONGO_URL='https://paymongo.page/l/support-bingebox';
  const PAYPAL_HOSTED_BUTTON_ID='92TYEF53NT5JJ';
  const FALLBACK_LABEL='Support BingeBox';
  let settings={url:PAYMONGO_URL,label:FALLBACK_LABEL},loaded=false,promise=null;
  const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:''}catch{return ''}};

  function applyLinks(){
    document.querySelectorAll('[data-donate-label]').forEach(el=>el.textContent=settings.label||FALLBACK_LABEL);
    document.querySelectorAll('[data-donate-open]').forEach(el=>{
      if(el.tagName==='A') el.href=settings.url||PAYMONGO_URL;
      el.setAttribute('aria-label',settings.label||FALLBACK_LABEL);
    });
  }

  function ensureDialog(){
    let dlg=document.querySelector('#donateDialog'); if(dlg)return dlg;
    dlg=document.createElement('dialog');dlg.id='donateDialog';dlg.className='donate-dialog';
    dlg.innerHTML=`<section class="donate-card" aria-labelledby="donateTitle">
      <button class="donate-close" type="button" aria-label="Close">×</button>
      <p class="donate-kicker">SUPPORT BINGEBOX</p>
      <h2 id="donateTitle">Keep the binge going.</h2>
      <p class="donate-intro">Support BingeBox and help us improve the platform, expand our licensed drama catalog, and keep the viewing experience free and accessible.</p>
      <div class="donate-options">
        <section class="donate-provider donate-provider-paypal">
          <div class="donate-provider-head"><div><span>INTERNATIONAL</span><strong>PayPal</strong></div><small>USD · opens in a new tab</small></div>
          <form class="paypal-direct-form" action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_blank">
            <input type="hidden" name="cmd" value="_s-xclick">
            <input type="hidden" name="hosted_button_id" value="${PAYPAL_HOSTED_BUTTON_ID}">
            <button class="donate-action donate-paypal" type="submit"><span>Continue with PayPal</span><span>↗</span></button>
          </form>
        </section>
        <div class="donate-divider"><span>or</span></div>
        <section class="donate-provider">
          <div class="donate-provider-head"><div><span>PHILIPPINES</span><strong>PayMongo</strong></div><small>Secure hosted payment page</small></div>
          <a class="donate-action donate-paymongo" id="donateAction" href="${PAYMONGO_URL}" target="_blank" rel="noopener noreferrer"><span>Continue with PayMongo</span><span>↗</span></a>
        </section>
      </div>
      <p class="donate-status" id="donateStatus">BingeBox does not collect or store your card, PayPal, or wallet details.</p>
    </section>`;
    document.body.appendChild(dlg);
    dlg.querySelector('.donate-close').addEventListener('click',()=>dlg.close());
    dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
    return dlg;
  }

  async function load(){
    if(loaded)return settings;if(promise)return promise;
    promise=(async()=>{try{
      const base=(config.supabaseUrl||'').replace(/\/$/,'');
      if(!base||!config.supabasePublishableKey)throw new Error('Not configured');
      const res=await fetch(`${base}/rest/v1/site_settings?key=in.(donate_url,donate_label)&select=key,value`,{headers:{apikey:config.supabasePublishableKey,Accept:'application/json'},cache:'no-store'});
      if(!res.ok)throw new Error('Unavailable');
      const rows=await res.json();
      for(const row of rows||[]){
        if(row.key==='donate_url'){const u=safeUrl(row.value||'');if(u)settings.url=u}
        if(row.key==='donate_label'&&String(row.value||'').trim())settings.label=String(row.value).trim().slice(0,28)
      }
    }catch(err){console.warn('BingeBox donation settings fallback active.',err)}
    finally{loaded=true;promise=null;applyLinks()}
    return settings;})();
    return promise;
  }


  async function open(){
    const dlg=ensureDialog(),action=dlg.querySelector('#donateAction');
    action.href=settings.url||PAYMONGO_URL;
    if(!dlg.open)dlg.showModal();
    const s=await load();
    action.href=s.url||PAYMONGO_URL;
    window.BBUser?.track?.('donate_open').catch?.(()=>{});
  }

  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-donate-open]');if(!t)return;
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button===1)return;
    e.preventDefault();open();
  });
  window.BBDonate={open,load,get settings(){return {...settings}}};
  applyLinks();load();
})();
