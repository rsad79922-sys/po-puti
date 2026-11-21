package ru.poputi.app;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.view.accessibility.AccessibilityNodeInfo;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.List;

/** Synthetic public metadata, real native dialog, no downloads or user accounts. */
@RunWith(AndroidJUnit4.class)
public class UpdatePromptTest {
 private AccessibilityNodeInfo find(String text){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if(root==null)return null;List<AccessibilityNodeInfo> nodes=root.findAccessibilityNodeInfosByText(text);for(AccessibilityNodeInfo node:nodes)if(text.equalsIgnoreCase(node.getText()==null?"":node.getText().toString()))return node;return null;
 }
 private AccessibilityNodeInfo await(String text)throws Exception{
  long until=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<until){AccessibilityNodeInfo node=find(text);if(node!=null)return node;Thread.sleep(100);}throw new AssertionError("Expected update control: "+text);
 }
 @Test public void updateNeedsATapAndCanBeDeferredAndReopened()throws Exception{
  String cert=new String(new char[64]).replace('\0','a');
  JSONObject release=new JSONObject().put("package","ru.poputi.app").put("versionCode",900000001).put("versionName","1.3.0").put("certificateSHA256",cert).put("apkSHA256",cert).put("bytes",100).put("downloadUrl","https://vputipoputka.ru/downloads/po-puti-900000001.apk");
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  context.getSharedPreferences("po-puti-updates",0).edit().remove("defer-900000001").commit();
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   scenario.onActivity(activity->{PoPutiUpdatesPlugin plugin=(PoPutiUpdatesPlugin)activity.getBridge().getPlugin("PoPutiUpdates").getInstance();plugin.presentRelease(release,10,cert,false);});
   await("Доступно обновление");assertNotNull(await("Обновить"));assertTrue(await("Позже").performAction(AccessibilityNodeInfo.ACTION_CLICK));
   long until=System.currentTimeMillis()+5000;while(find("Доступно обновление")!=null&&System.currentTimeMillis()<until)Thread.sleep(100);
   assertNull(find("Доступно обновление"));assertTrue(context.getSharedPreferences("po-puti-updates",0).getLong("defer-900000001",0)>System.currentTimeMillis());
   scenario.onActivity(activity->{PoPutiUpdatesPlugin plugin=(PoPutiUpdatesPlugin)activity.getBridge().getPlugin("PoPutiUpdates").getInstance();plugin.presentRelease(release,10,cert,false);});
   InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertNull(find("Доступно обновление"));
   scenario.onActivity(activity->{PoPutiUpdatesPlugin plugin=(PoPutiUpdatesPlugin)activity.getBridge().getPlugin("PoPutiUpdates").getInstance();plugin.presentRelease(release,10,cert,true);});
   await("Доступно обновление");assertTrue(await("Позже").performAction(AccessibilityNodeInfo.ACTION_CLICK));
  }finally{context.getSharedPreferences("po-puti-updates",0).edit().remove("defer-900000001").commit();}
 }
}
