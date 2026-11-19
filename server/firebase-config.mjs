import {readFileSync} from 'node:fs';

// Client identifiers may be sent to an authenticated device. Never return the
// service account or arbitrary fields from either protected configuration file.
export function firebaseClientConfig(value,expectedProject){
 if(!value)return null;
 try{
  const input=typeof value==='object'?value:JSON.parse(value.trim().startsWith('{')?value:readFileSync(value,'utf8'));
  const info=input.project_info,client=input.client?.find(c=>c.client_info?.android_client_info?.package_name==='ru.poputi.app');
  const projectId=info?.project_id,senderId=info?.project_number,applicationId=client?.client_info?.mobilesdk_app_id,apiKey=client?.api_key?.[0]?.current_key;
  if(projectId!==expectedProject||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId||'')||!/^\d{5,30}$/.test(senderId||'')||!/^1:\d+:android:[a-fA-F0-9]+$/.test(applicationId||'')||!/^AIza[A-Za-z0-9_-]{20,100}$/.test(apiKey||''))throw Error();
  if(applicationId.split(':')[1]!==String(senderId))throw Error();
  return {projectId,senderId:String(senderId),applicationId,apiKey};
 }catch{throw Error('Invalid Firebase Android client configuration (expected ru.poputi.app and matching project)')}
}

export function fcmDataMessage(token,payload){
 return {message:{token,data:{path:payload.path,notificationId:payload.notificationId,recipientId:payload.recipientId},android:{priority:'high',ttl:'86400s'}}};
}
