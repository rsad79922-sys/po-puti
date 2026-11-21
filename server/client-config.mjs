export function androidDownloadUrl(value=''){
 const text=String(value).trim();
 if(!text||text.length>2048||/[\u0000-\u0020\u007f\\]/.test(text))return '';
 try{const url=new URL(text);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}
}

export function clientConfig(env=process.env){
 const enabled=env.ADS_ENABLED==='true'&&env.ADS_TERMS_CONFIRMED==='true'&&env.PRIVACY_POLICY_APPROVED==='true'&&!!env.PRIVACY_OPERATOR?.trim()&&!!env.PRIVACY_CONTACT?.trim();
 const slots=platform=>['SEARCH','RESULTS'].map(name=>({name:name.toLowerCase(),id:enabled?String(env['ADS_'+platform+'_'+name+'_ID']||''):''}));
 return {version:5,androidDownloadUrl:androidDownloadUrl(env.ANDROID_DOWNLOAD_URL),ads:{enabled,test:env.ADS_TEST_MODE!=='false',web:slots('WEB'),android:slots('ANDROID')},privacy:{policyVersion:'2026-11-v7',operator:env.PRIVACY_OPERATOR||'',contact:env.PRIVACY_CONTACT||'',deletionEnabled:true,deletionRequestsEnabled:true}};
}

// The public policy must contain the operator even without JavaScript, including
// for store review. Escaping is mandatory: values are configuration, never HTML.
export function renderPrivacyDocument(template,env=process.env){
 const privacy=clientConfig(env).privacy;
 if(!privacy.operator.trim()||!privacy.contact.trim())return template;
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return template.replace(/(<p\s+id=["']privacy-owner["'][^>]*>)[\s\S]*?(<\/p>)/,(_,open,close)=>open+escape(privacy.operator)+'. Контакт: '+escape(privacy.contact)+close);
}
