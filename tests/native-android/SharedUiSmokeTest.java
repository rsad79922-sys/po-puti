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
        }
    }
}
