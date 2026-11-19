// Called only on the VPS by the root setup helper. Never print provider errors.
import {readFileSync,writeFileSync} from 'node:fs';
import {GoogleAuth,JWT} from 'google-auth-library';
import {firebaseClientConfig} from '../server/firebase-config.mjs';
try{
 const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const account=typeof input.serviceAccount==='string'?JSON.parse(input.serviceAccount):input.serviceAccount;
 const android=typeof input.android==='string'?JSON.parse(input.android):input.android;
 if(account?.type!=='service_account'||!String(account.client_email).endsWith('.gserviceaccount.com')||!String(account.private_key).includes('BEGIN PRIVATE KEY'))throw Error();
 const options=firebaseClientConfig(android,account.project_id);if(!options)throw Error();
 const auth=new GoogleAuth({authClient:new JWT({email:account.client_email,key:account.private_key,scopes:['https://www.googleapis.com/auth/firebase.messaging']})});
 const client=await auth.getClient();
 // FCM validates permission/project without sending a message to any device.
 await client.request({url:'https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.project_id)+'/messages:send',method:'POST',timeout:15000,data:{validate_only:true,message:{topic:'poputi-configuration-validation',data:{setup:'validation-only'}}}});
 const directory=process.argv[3];
 writeFileSync(directory+'/service-account.json',JSON.stringify(account),{mode:0o600,flag:'wx'});
 writeFileSync(directory+'/android-client.json',JSON.stringify(android),{mode:0o600,flag:'wx'});
 writeFileSync(directory+'/firebase.env','FCM_PROJECT_ID='+options.projectId+'\nFCM_SERVICE_ACCOUNT_JSON=/etc/po-puti/firebase-push/service-account.json\nFCM_ANDROID_CONFIG_JSON=/etc/po-puti/firebase-push/android-client.json\n',{mode:0o600,flag:'wx'});
 console.log('FIREBASE_VALIDATED: matching Android package/project; OAuth and FCM dry run accepted; no messages sent');
}catch{console.error('FIREBASE_SETUP_FAILED: check protected JSON files, matching ru.poputi.app project, FCM API permissions and server connectivity. No credentials were printed.');process.exitCode=1}
