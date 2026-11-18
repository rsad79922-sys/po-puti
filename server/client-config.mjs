export function androidDownloadUrl(value=''){
 const text=String(value).trim();
 if(!text||text.length>2048||/[\u0000-\u0020\u007f\\]/.test(text))return '';
 try{const url=new URL(text);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}
}

export function clientConfig(env=process.env){
 const enabled=env.ADS_ENABLED==='true'&&env.ADS_TERMS_CONFIRMED==='true'&&env.PRIVACY_POLICY_APPROVED==='true'&&!!env.PRIVACY_OPERATOR?.trim()&&!!env.PRIVACY_CONTACT?.trim();
 const slots=platform=>['SEARCH','RESULTS'].map(name=>({name:name.toLowerCase(),id:enabled?String(env['ADS_'+platform+'_'+name+'_ID']||''):''}));
 return {version:5,androidDownloadUrl:androidDownloadUrl(env.ANDROID_DOWNLOAD_URL),ads:{enabled,test:env.ADS_TEST_MODE!=='false',web:slots('WEB'),android:slots('ANDROID')},privacy:{policyVersion:'2026-11-v6',operator:env.PRIVACY_OPERATOR||'',contact:env.PRIVACY_CONTACT||'',deletionEnabled:true,deletionRequestsEnabled:true}};
}
