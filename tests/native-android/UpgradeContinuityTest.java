package ru.poputi.app;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Only a marker in this disposable emulator's test-owned preferences is touched. */
@RunWith(AndroidJUnit4.class)
public class UpgradeContinuityTest {
 @Test public void seedPreviousVersion(){
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertTrue(context.getSharedPreferences("qa-direct-upgrade",0).edit().putString("marker","retained-across-apk-update").commit());
 }
 @Test public void verifyUpdatedVersion() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals(Integer.parseInt(InstrumentationRegistry.getArguments().getString("expectedVersionCode")),context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode);
  android.content.SharedPreferences prefs=context.getSharedPreferences("qa-direct-upgrade",0);
  assertEquals("retained-across-apk-update",prefs.getString("marker",""));assertTrue(prefs.edit().clear().commit());
 }
}
