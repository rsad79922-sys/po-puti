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
    @Test public void launchesPackagedUiAndNativeBridge() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            long until = System.currentTimeMillis() + 45000;
            String value = "";
            while (System.currentTimeMillis() < until) {
                CountDownLatch done = new CountDownLatch(1);
                AtomicReference<String> result = new AtomicReference<>("");
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "JSON.stringify({ready:!!document.getElementById('reg-username'),platform:window.Capacitor&&Capacitor.getPlatform(),push:!!(window.Capacitor&&Capacitor.isPluginAvailable('PushNotifications')),title:document.title})",
                    answer -> { result.set(answer); done.countDown(); }
                ));
                assertTrue("WebView callback must complete", done.await(5, TimeUnit.SECONDS));
                value = result.get().replace("\\\"", "\"");
                if (value.contains("\"ready\":true")) break;
                Thread.sleep(250);
            }
            assertTrue("Packaged login UI must render: " + value, value.contains("\"ready\":true"));
            assertTrue("Real Capacitor bridge must report Android: " + value, value.contains("\"platform\":\"android\""));
            assertTrue("Native push plugin must be registered: " + value, value.contains("\"push\":true"));
            // No Firebase project is configured in the default APK; logout cleanup must still finish.
            CountDownLatch cleanup = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "unsubscribeLocalPush().then(()=>window.nativeCleanupDone=true)", answer -> cleanup.countDown()
            ));
            assertTrue("Cleanup invocation must complete", cleanup.await(5, TimeUnit.SECONDS));
            AtomicReference<String> cleanupResult = new AtomicReference<>("");
            CountDownLatch finished = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "window.nativeCleanupDone===true", answer -> { cleanupResult.set(answer); finished.countDown(); }
            ));
            assertTrue(finished.await(5, TimeUnit.SECONDS));
            assertEquals("Logout cleanup must not require Firebase credentials", "true", cleanupResult.get());
            // Exercise the real native plugin without registering users or calling the production API.
            CountDownLatch nativeDone = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "(async()=>{const p=Capacitor.Plugins.PoPutiFeatures;await p.setToken({token:'isolated-native-test-token'});const t=await p.getToken();window.nativeSecureOk=t.token==='isolated-native-test-token';await p.removeToken();await p.showSearch({query:{from:'Нефтекамск',to:'Уфа',date:'2030-05-10'},filter:'bus',ads:{enabled:false},items:[{type:'bus_service',id:'fixture',from:'Нефтекамск',to:'Уфа',departureAt:'2030-05-10T04:00:00Z',arrivalAt:'2030-05-10T06:00:00Z',departureTimeZone:'Asia/Yekaterinburg',destinationTimeZone:'Asia/Yekaterinburg',carrier:'Тестовый перевозчик',purchase:{url:'',cashier:''}}]});window.nativeSearchReady=true})()",
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
            scenario.onActivity(activity -> {
                android.view.View feed=activity.findViewById(android.R.id.content).findViewWithTag("po-puti-native-search");
                String texts=allText(feed);
                assertTrue(texts.contains("Информация о покупке билета отсутствует"));
                assertTrue(texts.contains("Тестовый перевозчик"));
                assertFalse(texts.contains("Свободных мест"));
                assertFalse(texts.contains("Отправить заявку"));
                assertFalse(texts.contains("Позвонить"));
                assertTrue(activity.getSharedPreferences("po-puti-session-v5",android.content.Context.MODE_PRIVATE).getAll().isEmpty());
            });
        }
    }
    private static String allText(android.view.View view){
        StringBuilder out=new StringBuilder();
        if(view instanceof android.widget.TextView)out.append(((android.widget.TextView)view).getText()).append('\n');
        if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)out.append(allText(group.getChildAt(i)));}
        return out.toString();
    }
}
