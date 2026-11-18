package ru.poputi.app;

import static org.junit.Assert.*;
import android.content.pm.ApplicationInfo;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Installs/runs the actual signed release. Only a new test-owned account is
 * created, then self-erased with its own password/token. Never touches an
 * existing account or publishes fake rides. Credentials never enter JS source,
 * adb arguments, assertions, reports, screenshots or console output. */
@RunWith(AndroidJUnit4.class)
public class SignedReleaseFlowTest {
    private static final String API="https://vputipoputka.ru/api";
    public static final class TestCredentials {
        private final String username,password;
        TestCredentials(String username,String password){this.username=username;this.password=password;}
        @JavascriptInterface public String username(){return username;}
        @JavascriptInterface public String password(){return password;}
    }
    private static JSONObject request(String path,JSONObject body,String token) throws Exception {
        HttpsURLConnection connection=(HttpsURLConnection)new URL(API+path).openConnection();
        connection.setConnectTimeout(20000);connection.setReadTimeout(30000);connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type","application/json");
        if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
        connection.setDoOutput(true);
        try{
            try(java.io.OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            int code=connection.getResponseCode();
            if(code!=200)throw new AssertionError("Test-owned account API operation failed: "+path+" HTTP "+code);
            try(java.io.InputStream input=connection.getInputStream()){
                java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
                while((count=input.read(buffer))!=-1){if(bytes.size()+count>1048576)throw new AssertionError("Unexpected API response size");bytes.write(buffer,0,count);}
                return new JSONObject(bytes.toString("UTF-8"));
            }
        }finally{connection.disconnect();}
    }
    private static String evaluate(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>("null");
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        assertTrue("WebView evaluation must finish",done.await(10,TimeUnit.SECONDS));return value.get();
    }
    private static void await(ActivityScenario<MainActivity> scenario,String expression,String message) throws Exception {
        long until=System.currentTimeMillis()+60000;
        while(System.currentTimeMillis()<until){if("true".equals(evaluate(scenario,expression)))return;Thread.sleep(150);}
        fail(message);
    }
    private static EditText input(View view,String hint){
        if(view instanceof EditText&&hint.equals(String.valueOf(((EditText)view).getHint())))return (EditText)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){EditText result=input(((ViewGroup)view).getChildAt(i),hint);if(result!=null)return result;}
        return null;
    }
    private static Button button(View view,String text){
        if(view instanceof Button&&text.contentEquals(((Button)view).getText()))return (Button)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){Button result=button(((ViewGroup)view).getChildAt(i),text);if(result!=null)return result;}
        return null;
    }
    @Test public void signedReleaseInstallsLaunchesLogsInAndSearchesProduction() throws Exception {
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("ru.poputi.app",context.getPackageName());
        LauncherIconAssertions.assertOwnerBrand(context);
        assertEquals("Release must not be debuggable",0,context.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE);
        int expected=Integer.parseInt(InstrumentationRegistry.getArguments().getString("expectedVersionCode","4"));
        assertEquals(expected,context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode);
        String username="qa_android_"+UUID.randomUUID().toString().replace("-","").substring(0,16),password=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");
        String cleanupToken=null;
        ActivityScenario<MainActivity> scenario=null;
        try{
            // Establish a healthy Activity before creating a production QA account.
            scenario=ActivityScenario.launch(MainActivity.class);
            JSONObject registration=request("/register",new JSONObject().put("username",username).put("password",password).put("clientVersion",5).put("termsAccepted",true),null);
            cleanupToken=registration.getString("token");String testUserId=registration.getJSONObject("user").getString("id");
            final TestCredentials credentials=new TestCredentials(username,password);
            scenario.onActivity(activity->{WebView web=activity.getBridge().getWebView();web.addJavascriptInterface(credentials,"__PoPutiReleaseTestCredentials");web.reload();});
            await(scenario,"!!document.getElementById('reg-username')&&typeof window.__PoPutiReleaseTestCredentials==='object'","Signed release login screen must load");
            assertEquals("true",evaluate(scenario,"SERVER_BASE==='https://vputipoputka.ru'&&nativePlatform()&&!androidBrowserDownloadEligible()&&!document.querySelector('.android-download-banner')"));
            evaluate(scenario,"(()=>{const c=window.__PoPutiReleaseTestCredentials;document.getElementById('reg-username').value=c.username();document.getElementById('reg-password').value=c.password();document.getElementById('login-form').requestSubmit();return true})()");
            await(scenario,"!!db.currentUserId&&db.currentUserId==="+JSONObject.quote(testUserId),"Actual production login must succeed");
            scenario.onActivity(activity->activity.getBridge().getWebView().removeJavascriptInterface("__PoPutiReleaseTestCredentials"));
            await(scenario,"typeof nativeSearchVisible!=='undefined'&&nativeSearchVisible===true","Native Android search must open after login");
            evaluate(scenario,"(()=>{window.__releaseSearchSucceeded=false;const original=window.fetch;window.fetch=async function(input,options){const response=await original.call(this,input,options);const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname==='/api/search'&&u.searchParams.get('type')==='private'&&u.searchParams.get('from')==='Москва'&&u.searchParams.get('to')==='Тверь'){const data=await response.clone().json();window.__releaseSearchSucceeded=response.ok&&Array.isArray(data.private?.items);}return response};return true})()");
            String date=LocalDate.now().plusDays(2).toString();
            scenario.onActivity(activity->{
                View root=activity.findViewById(android.R.id.content).findViewWithTag("po-puti-native-search");
                assertNotNull("Native search layout must be present",root);
                EditText from=input(root,"Откуда"),to=input(root,"Куда"),when=input(root,"Дата: ГГГГ-ММ-ДД");Button find=button(root,"Найти поездку");
                assertNotNull(from);assertNotNull(to);assertNotNull(when);assertNotNull(find);
                from.setText("Москва");to.setText("Тверь");when.setText(date);assertTrue(find.performClick());
            });
            await(scenario,"window.__releaseSearchSucceeded===true&&db.search.from==='Москва'&&db.search.to==='Тверь'&&Array.isArray(featureState.private)","Native search must receive real authenticated private-ride results");
            assertEquals("true",evaluate(scenario,"!serverError&&!!accessToken&&nativeSearchVisible===true"));
        }finally{
            try{
                if(cleanupToken!=null){JSONObject erased=request("/account/delete",new JSONObject().put("confirmation","DELETE_MY_ACCOUNT").put("password",password),cleanupToken);assertEquals("Only the test-owned account must be anonymized","anonymized",erased.getString("status"));}
            }finally{
                if(scenario!=null){try{evaluate(scenario,"(()=>{clearRemoteSession();navigate('/login');return true})()");}finally{scenario.close();}}
            }
        }
    }
}
