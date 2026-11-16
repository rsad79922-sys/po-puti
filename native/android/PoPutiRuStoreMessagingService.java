package ru.poputi.app;

import java.util.List;
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage;
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService;
import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException;

/** The backend sends data only; SDK automatic notifications must stay disabled. */
public class PoPutiRuStoreMessagingService extends RuStoreMessagingService {
 @Override public void onNewToken(String token){PoPutiRuStoreState.syncToken(this,token);}
 @Override public void onMessageReceived(RemoteMessage message){if(message.getNotification()!=null)return;PoPutiRuStoreState.display(this,message.getData());}
 @Override public void onDeletedMessages(){} // The authenticated notification center remains authoritative.
 @Override public void onError(List<? extends RuStorePushClientException> errors){} // Never log tokens/provider internals.
}
