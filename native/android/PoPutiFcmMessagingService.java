package ru.poputi.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Data-only delivery also checks the current account when the UI is closed. */
public class PoPutiFcmMessagingService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){if("fcm".equals(PoPutiRuStoreState.provider(this)))PoPutiRuStoreState.syncToken(this,token,"fcm");}
 @Override public void onMessageReceived(RemoteMessage message){if(message.getNotification()==null&&"fcm".equals(PoPutiRuStoreState.provider(this)))PoPutiRuStoreState.display(this,message.getData(),"fcm");}
}
