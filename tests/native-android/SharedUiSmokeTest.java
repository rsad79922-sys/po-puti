package ru.poputi.app;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the actual generated Capacitor activity and packaged WebView, no production writes. */
@RunWith(AndroidJUnit4.class)
public class SharedUiSmokeTest {
    @Test public void genericNotificationIsBoundToOptedInAccountAndClearedOnLogout() throws Exception {
        android.content.Context context=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        if(android.os.Build.VERSION.SDK_INT>=33)try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("pm grant ru.poputi.app android.permission.POST_NOTIFICATIONS"))){byte[] buffer=new byte[256];while(input.read(buffer)!=-1){}}
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            long until=System.currentTimeMillis()+45000;
            while(!"isolated-notification-session".equals(PoPutiRuStoreState.session(context))&&System.currentTimeMillis()<until){
                CountDownLatch ready=new CountDownLatch(1);
                scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript("if(document.getElementById('reg-username')&&window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.PoPutiFeatures&&typeof restoreNativeSession==='function'&&!window.__notificationFixturePending){window.__notificationFixturePending=true;restoreNativeSession().then(()=>Capacitor.Plugins.PoPutiFeatures.setToken({token:'isolated-notification-session'}))}",ignored->ready.countDown()));
                assertTrue(ready.await(5,TimeUnit.SECONDS));Thread.sleep(100);
            }
            assertEquals("isolated-notification-session",PoPutiRuStoreState.session(context));
            PoPutiRuStoreState.activate(context,"fixture-account","fixture-device-1234","isolated-notification-session","fcm");
            FixtureFcmService service=new FixtureFcmService();service.attach(context);
            java.util.Map<String,String> data=new java.util.HashMap<>();data.put("notificationId","fixture-note");data.put("recipientId","fixture-account");data.put("path","https://attacker.invalid/");
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED); // UI is stopped: service must display without the WebView.
            service.onMessageReceived(fcmMessage(data));service.onMessageReceived(fcmMessage(data));
            android.app.NotificationManager manager=(android.app.NotificationManager)context.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            awaitNotificationCount(manager,1);
            android.app.Notification notice=manager.getActiveNotifications()[0].getNotification();
            assertEquals("Откройте приложение, чтобы посмотреть уведомление.",notice.extras.getString(android.app.Notification.EXTRA_TEXT));
            assertEquals(R.drawable.ic_poputi_notification,notice.getSmallIcon().getResId());
            data.put("notificationId","wrong-recipient");data.put("recipientId","another-account");service.onMessageReceived(fcmMessage(data));assertEquals(1,manager.getActiveNotifications().length);
            PoPutiRuStoreState.activate(context,"fixture-account","fixture-device-1234","isolated-notification-session","rustore");data.put("notificationId","inactive-fcm-provider");data.put("recipientId","fixture-account");service.onMessageReceived(fcmMessage(data));assertEquals("Inactive provider must not display",1,manager.getActiveNotifications().length);
            PoPutiRuStoreState.disable(context,false);awaitNotificationCount(manager,0);
            data.put("recipientId","fixture-account");service.onMessageReceived(fcmMessage(data));assertEquals(0,manager.getActiveNotifications().length);
        }finally{PoPutiRuStoreState.disable(context,false);context.getSharedPreferences(PoPutiRuStoreState.SESSION,android.content.Context.MODE_PRIVATE).edit().clear().commit();}
    }
    private static final class FixtureFcmService extends PoPutiFcmMessagingService {void attach(android.content.Context context){attachBaseContext(context);}}
    private static com.google.firebase.messaging.RemoteMessage fcmMessage(java.util.Map<String,String> data){return new com.google.firebase.messaging.RemoteMessage.Builder("isolated-fixture").setData(data).build();}
    private static void awaitNotificationCount(android.app.NotificationManager manager,int expected)throws Exception{long until=System.currentTimeMillis()+5000;while(manager.getActiveNotifications().length!=expected&&System.currentTimeMillis()<until)Thread.sleep(50);assertEquals(expected,manager.getActiveNotifications().length);}
    @Test public void launchesPackagedUiAndNativeBridge() throws Exception {
        LauncherIconAssertions.assertOwnerBrand(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            long until = System.currentTimeMillis() + 45000;
            String value = "";
            while (System.currentTimeMillis() < until) {
                CountDownLatch done = new CountDownLatch(1);
                AtomicReference<String> result = new AtomicReference<>("");
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "JSON.stringify({ready:!!document.getElementById('reg-username'),platform:window.Capacitor&&Capacitor.getPlatform(),push:!!(window.Capacitor&&Capacitor.isPluginAvailable('PushNotifications')),downloadBannerEligible:typeof androidBrowserDownloadEligible==='function'&&androidBrowserDownloadEligible(),title:document.title})",
                    answer -> { result.set(answer); done.countDown(); }
                ));
                assertTrue("WebView callback must complete", done.await(5, TimeUnit.SECONDS));
                value = result.get().replace("\\\"", "\"");
                if (value.contains("\"ready\":true")) break;
                Thread.sleep(250);
            }
            assertTrue("Packaged login UI must render: " + value, value.contains("\"ready\":true"));
            assertTrue("Real Capacitor bridge must report Android: " + value, value.contains("\"platform\":\"android\""));
            assertTrue("Installed APK must hide the browser download banner: " + value, value.contains("\"downloadBannerEligible\":false"));
            assertTrue("Native push plugin must be registered: " + value, value.contains("\"push\":true"));
            CountDownLatch rustoreCheck = new CountDownLatch(1);
            AtomicReference<String> rustoreValue = new AtomicReference<>("");
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript("Capacitor.isPluginAvailable('PoPutiRuStorePush')", answer->{rustoreValue.set(answer);rustoreCheck.countDown();}));
            assertTrue(rustoreCheck.await(5,TimeUnit.SECONDS));assertEquals("RuStore bridge must be available without Firebase", "true", rustoreValue.get());
            // No Firebase project is configured in the default APK; logout cleanup must still finish.
            CountDownLatch cleanup = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "unsubscribeLocalPush().then(()=>window.nativeCleanupDone=true)", answer -> cleanup.countDown()
            ));
            assertTrue("Cleanup invocation must complete", cleanup.await(5, TimeUnit.SECONDS));
            AtomicReference<String> cleanupResult = new AtomicReference<>("");
            long cleanupDeadline=System.currentTimeMillis()+10000;
            while(!"true".equals(cleanupResult.get())&&System.currentTimeMillis()<cleanupDeadline){
                CountDownLatch finished = new CountDownLatch(1);
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "window.nativeCleanupDone===true", answer -> { cleanupResult.set(answer); finished.countDown(); }
                ));
                assertTrue(finished.await(5,TimeUnit.SECONDS));if(!"true".equals(cleanupResult.get()))Thread.sleep(50);
            }
            assertEquals("Logout cleanup must not require Firebase credentials", "true", cleanupResult.get());
            // Exercise the real native plugin without registering users or calling the production API.
            CountDownLatch nativeDone = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "(async()=>{const p=Capacitor.Plugins.PoPutiFeatures;await p.setToken({token:'isolated-native-test-token'});const t=await p.getToken();window.nativeSecureOk=t.token==='isolated-native-test-token';await p.removeToken();await p.showSearch({query:{from:'Нефтекамск',to:'Уфа',date:'2030-05-10'},filter:'bus',wantedEnabled:true,ads:{enabled:false},items:[{type:'bus_service',id:'fixture',from:'Нефтекамск',to:'Уфа',departureAt:'2030-05-10T04:00:00Z',arrivalAt:'2030-05-10T06:00:00Z',departureTimeZone:'Asia/Yekaterinburg',destinationTimeZone:'Asia/Yekaterinburg',carrier:'Тестовый перевозчик',purchase:{url:'',cashier:''}}]});window.nativeSearchReady=true})()",
                answer -> nativeDone.countDown()
            ));
            assertTrue(nativeDone.await(5, TimeUnit.SECONDS));
            boolean rendered = false;
            for (int i=0;i<100&&!rendered;i++) {
                AtomicReference<Boolean> found = new AtomicReference<>(false);
                scenario.onActivity(activity -> found.set(activity.findViewById(android.R.id.content).findViewWithTag("po-puti-native-search")!=null));
                rendered=found.get();if(!rendered)Thread.sleep(100);
            }
            assertTrue("Native bus feed must render without an advertising response",rendered);
            AtomicReference<String> secureValue = new AtomicReference<>("");
            CountDownLatch secureCheck = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript("window.nativeSecureOk",answer->{secureValue.set(answer);secureCheck.countDown();}));
            assertTrue(secureCheck.await(5,TimeUnit.SECONDS));
            assertEquals("Keystore round-trip must preserve the session", "true", secureValue.get());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();Thread.sleep(300);screenshot("search-bus");
            scenario.onActivity(activity -> {
                android.view.View feed=activity.findViewById(android.R.id.content).findViewWithTag("po-puti-native-search");
                String texts=allText(feed);
                assertEquals(android.view.View.VISIBLE,feed.findViewWithTag("po-puti-native-wanted").getVisibility());
                assertTrue(texts.contains("Ищу попутку"));assertTrue(texts.contains("Заявки пассажиров"));
                assertTrue(texts.contains("Информация о покупке билета отсутствует"));
                assertTrue(texts.contains("Тестовый перевозчик"));
                assertTrue("Mixed category must appear",texts.contains("Все"));
                assertTrue(texts.contains("Попутка"));assertTrue(texts.contains("Автобусы"));
                assertFalse(texts.contains("Свободных мест"));
                assertFalse(texts.contains("Отправить заявку"));
                assertFalse(texts.contains("Позвонить"));
                assertTrue(activity.getSharedPreferences("po-puti-session-v5",android.content.Context.MODE_PRIVATE).getAll().isEmpty());
                android.widget.LinearLayout nav=feed.findViewWithTag("po-puti-search-nav");assertEquals(4,nav.getChildCount());
                for(int n=0;n<4;n++){android.widget.LinearLayout tab=(android.widget.LinearLayout)nav.getChildAt(n);android.widget.TextView title=(android.widget.TextView)tab.getChildAt(1);assertEquals(1,title.getLineCount());assertTrue(title.getWidth()>0);assertEquals("Navigation labels must be shown in full",0,title.getLayout().getEllipsisCount(0));}
                android.widget.EditText date=findDate(feed);assertNotNull(date);assertNull("No manual ISO date entry",date.getKeyListener());assertEquals("10 мая",date.getText().toString());
                assertTrue(feed.findViewWithTag("po-puti-search-scroll") instanceof android.widget.ScrollView);
                assertTrue(feed.findViewWithTag("po-puti-search-submit").getBackground() instanceof android.graphics.drawable.RippleDrawable);

            });
            scenario.onActivity(activity->((android.widget.ScrollView)activity.findViewById(android.R.id.content).findViewWithTag("po-puti-search-scroll")).fullScroll(android.view.View.FOCUS_DOWN));
            screenshot("search-results");
            scenario.onActivity(activity->((android.widget.ScrollView)activity.findViewById(android.R.id.content).findViewWithTag("po-puti-search-scroll")).fullScroll(android.view.View.FOCUS_UP));
            scenario.onActivity(activity -> findDate(activity.findViewById(android.R.id.content).findViewWithTag("po-puti-native-search")).performClick());
            screenshot("search-day-month");
            android.view.accessibility.AccessibilityNodeInfo window=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            assertNotNull(window);assertEquals("Only day and month, no year wheel",2,countPickers(window));
            shell("input keyevent 4");
            CountDownLatch emptyDone=new CountDownLatch(1);
            scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript("Capacitor.Plugins.PoPutiFeatures.showSearch({query:{from:'Уфа',to:'Казань',date:'2030-11-20'},filter:'all',wantedEnabled:true,ads:{enabled:false},items:[]})",answer->emptyDone.countDown()));
            assertTrue(emptyDone.await(5,TimeUnit.SECONDS));Thread.sleep(300);screenshot("search-empty");
        }
    }
    private static int countPickers(android.view.accessibility.AccessibilityNodeInfo node){int count="android.widget.NumberPicker".contentEquals(node.getClassName())?1:0;for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null)count+=countPickers(child);}return count;}
    private static android.widget.EditText findDate(android.view.View view){
        if(view instanceof android.widget.EditText&&"Выберите дату".contentEquals(((android.widget.EditText)view).getHint()))return (android.widget.EditText)view;
        if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++){android.widget.EditText found=findDate(group.getChildAt(i));if(found!=null)return found;}}return null;
    }
    private static void shell(String command)throws Exception{try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))){byte[] buffer=new byte[4096];while(input.read(buffer)!=-1){}}}
    private static void screenshot(String name)throws Exception{androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();Thread.sleep(400);shell("screencap -p /sdcard/Download/po-puti-"+name+".png");}
    private static String allText(android.view.View view){
        StringBuilder out=new StringBuilder();
        if(view instanceof android.widget.TextView)out.append(((android.widget.TextView)view).getText()).append('\n');
        if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)out.append(allText(group.getChildAt(i)));}
        return out.toString();
    }
}
