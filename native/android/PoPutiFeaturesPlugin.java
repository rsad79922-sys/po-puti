package ru.poputi.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.banner.BannerAdView;
import com.yandex.mobile.ads.banner.BannerAdSize;
import com.yandex.mobile.ads.banner.BannerAdEventListener;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Native search and official inline advertisements; all eligibility remains on the shared API. */
@CapacitorPlugin(name="PoPutiFeatures")
public class PoPutiFeaturesPlugin extends Plugin {
 private LinearLayout root,results,topAd;
 private EditText from,to,date;
 private String filter="all";
 private final Map<String,LinearLayout> containers=new HashMap<>();
 private final Map<String,BannerAdView> banners=new HashMap<>();
 private boolean adsReady=false,adsStarting=false,paused=false;
 private JSObject lastPayload;
 private final String alias="po-puti-session-v5";
 private javax.crypto.SecretKey key() throws Exception {
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias(alias)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();}
  return (javax.crypto.SecretKey)store.getKey(alias,null);
 }
 @PluginMethod public void setToken(PluginCall call){try{String token=call.getString("token","");if(token.length()>256)throw new IllegalArgumentException();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());String value=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);if(!getContext().getSharedPreferences(alias,Context.MODE_PRIVATE).edit().putString("value",value).commit())throw new IllegalStateException();call.resolve();}catch(Exception e){call.reject("Secure session storage unavailable");}}
 @PluginMethod public void getToken(PluginCall call){try{String value=getContext().getSharedPreferences(alias,Context.MODE_PRIVATE).getString("value","");JSObject out=new JSObject();if(!value.isEmpty()){String[] parts=value.split(":");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));out.put("token",new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));}call.resolve(out);}catch(Exception e){getContext().getSharedPreferences(alias,Context.MODE_PRIVATE).edit().remove("value").apply();call.reject("Session must be renewed");}}
 @PluginMethod public void removeToken(PluginCall call){getContext().getSharedPreferences(alias,Context.MODE_PRIVATE).edit().clear().apply();call.resolve();}
 private int dp(int n){return Math.round(n*getContext().getResources().getDisplayMetrics().density);}
 private LinearLayout column(){LinearLayout box=new LinearLayout(getContext());box.setOrientation(LinearLayout.VERTICAL);return box;}
 private TextView label(String text,int size){TextView v=new TextView(getContext());v.setText(text);v.setTextSize(size);v.setTextColor(Color.rgb(26,36,70));v.setPadding(0,dp(6),0,dp(6));return v;}
 private Button button(String text,Runnable action){Button b=new Button(getContext());b.setText(text);b.setAllCaps(false);b.setOnClickListener(v->action.run());return b;}
 private EditText input(String hint){EditText v=new EditText(getContext());v.setSingleLine(true);v.setHint(hint);v.setTextSize(16);return v;}
 private void emit(String name,JSObject data){notifyListeners(name,data);}
 private void search(){try{LocalDate.parse(date.getText().toString().trim());if(from.getText().toString().trim().isEmpty()||to.getText().toString().trim().isEmpty())throw new IllegalArgumentException();}catch(Exception error){Toast.makeText(getContext(),"Укажите маршрут и дату в формате ГГГГ-ММ-ДД",Toast.LENGTH_SHORT).show();return;}JSObject q=new JSObject();q.put("from",from.getText().toString().trim());q.put("to",to.getText().toString().trim());q.put("date",date.getText().toString().trim());q.put("filter",filter);emit("search",q);}
 private void attach(ViewGroup parent,View view){if(view.getParent()!=null)((ViewGroup)view.getParent()).removeView(view);parent.addView(view);}
 private void createRoot(){
  root=column();root.setTag("po-puti-native-search");root.setFitsSystemWindows(true);root.setBackgroundColor(Color.rgb(246,248,252));root.setPadding(dp(16),dp(16),dp(16),dp(12));
  root.addView(label("По пути · Поиск",23));from=input("Откуда");to=input("Куда");date=input("Дата: ГГГГ-ММ-ДД");
  root.addView(from);root.addView(to);root.addView(date);root.addView(button("Найти поездку",this::search));
  topAd=column();root.addView(topAd);
  LinearLayout filters=new LinearLayout(getContext());String[] values={"all","private","bus"},titles={"Все","Попутчики","Автобусы"};
  for(int i=0;i<3;i++){final String value=values[i];Button b=button(titles[i],()->{filter=value;emit("filter",new JSObject().put("filter",filter));});filters.addView(b,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));}root.addView(filters);
  ScrollView scroll=new ScrollView(getContext());results=column();scroll.addView(results);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  root.addView(button("Предложить поездку",()->{close();emit("publish",new JSObject());}));
  LinearLayout tabs=new LinearLayout(getContext());String[] routes={"trips","notifications","profile"},names={"Поездки","Уведомления","Профиль"};for(int i=0;i<3;i++){final String route=routes[i];tabs.addView(button(names[i],()->{close();emit("navigate",new JSObject().put("route",route));}),new LinearLayout.LayoutParams(0,-2,1));}root.addView(tabs);
  getActivity().addContentView(root,new ViewGroup.LayoutParams(-1,-1));
 }
 @PluginMethod public void showSearch(PluginCall call){lastPayload=call.getData();getActivity().runOnUiThread(()->{if(getActivity().isFinishing()||getActivity().isDestroyed()){call.resolve();return;}try{render(lastPayload);call.resolve();}catch(Exception error){close();call.reject("Native search unavailable");}});}
 private void render(JSObject data){
  if(root==null)createRoot();JSONObject query=data.optJSONObject("query");if(query!=null&&!from.hasFocus()&&!to.hasFocus()&&!date.hasFocus()){from.setText(query.optString("from"));to.setText(query.optString("to"));date.setText(query.optString("date"));}
  root.setVisibility(paused?View.GONE:View.VISIBLE);filter=data.optString("filter","all");results.removeAllViews();topAd.removeAllViews();String status=data.optString("status");if(!status.isEmpty())results.addView(label(status,15));
  JSONObject choices=data.optJSONObject("choices");if(choices!=null)for(String side:new String[]{"from","to"}){JSONArray options=choices.optJSONArray(side);if(options!=null&&options.length()>0){Spinner spinner=new Spinner(getContext());List<String> labels=new ArrayList<>();labels.add("Уточните "+(side.equals("from")?"отправление":"назначение"));for(int i=0;i<options.length();i++){JSONObject o=options.optJSONObject(i);labels.add(o.optString("title")+" · "+o.optString("region"));}spinner.setAdapter(new ArrayAdapter<>(getContext(),android.R.layout.simple_spinner_dropdown_item,labels));spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,View v,int i,long id){if(i>0)emit("place",new JSObject().put("side",side).put("code",options.optJSONObject(i-1).optString("code")));}});results.addView(spinner);}}
  JSONArray items=data.optJSONArray("items");int count=items==null?0:items.length();for(int i=0;i<count;i++){JSONObject item=items.optJSONObject(i);if(item==null)continue;LinearLayout card=column();card.setPadding(dp(12),dp(12),dp(12),dp(12));card.setBackgroundColor(Color.WHITE);boolean bus=item.optString("type").equals("bus_service");card.addView(label(bus?"Автобус":"Попутчики",14));card.addView(label(item.optString("from")+" → "+item.optString("to"),19));
   if(bus){card.addView(label(time(item.optString("departureAt"),item.optString("departureTimeZone"))+" → "+time(item.optString("arrivalAt"),item.optString("destinationTimeZone")),17));String carrier=item.optString("carrier");if(!carrier.isEmpty())card.addView(label("Перевозчик: "+carrier,15));card.addView(label("Где купить билет",16));JSONObject purchase=item.optJSONObject("purchase");String url=purchase==null?"":purchase.optString("url"),cashier=purchase==null?"":purchase.optString("cashier");if(!url.isEmpty())card.addView(button("Перейти к покупке этого рейса",()->openUrl(url)));else card.addView(label(cashier.isEmpty()?"Информация о покупке билета отсутствует":cashier,15));card.addView(button("Данные предоставлены сервисом Яндекс.Расписания",()->openUrl("https://rasp.yandex.ru/")));card.addView(label("Справочное расписание. Время местное для каждой остановки.",14));}
   else{card.addView(label(item.optString("date")+" · "+item.optString("time"),17));card.addView(label(item.optString("driver")+" · "+item.optString("car"),15));card.addView(label("Свободных мест: "+item.optInt("available"),15));card.addView(label(item.isNull("price")?"По договорённости":item.optInt("price")+" ₽ за место",16));card.addView(button("Посмотреть поездку",()->{close();emit("openRide",new JSObject().put("id",item.optString("id")));}));}
   results.addView(card);if(i==4)addAd(results,"results",data);
  }
  if(count==0)results.addView(label("Подходящих поездок пока нет",18));if(count<5)addAd(results,"results",data);addAd(topAd,"search",data);
  if(data.optBoolean("hasMorePrivate"))results.addView(button("Ещё частные поездки",()->emit("morePrivate",new JSObject())));
  if(data.optBoolean("hasMore"))results.addView(button("Ещё автобусные рейсы",()->emit("more",new JSObject())));
  JSONObject ads=data.optJSONObject("ads");if(ads!=null&&ads.optBoolean("enabled")){boolean consent=data.optBoolean("consent");results.addView(button(consent?"Отключить рекламу":"Разрешить рекламу Яндекса",()->emit("adConsent",new JSObject().put("granted",!consent))));}
 }
 private String time(String at,String zone){try{return DateTimeFormatter.ofPattern("dd.MM HH:mm").format(Instant.parse(at).atZone(ZoneId.of(zone)));}catch(Exception e){return "Время не указано";}}
 private void addAd(LinearLayout parent,String name,JSObject data){
  JSONObject cfg=data.optJSONObject("ads");if(cfg==null||!cfg.optBoolean("enabled")||!data.optBoolean("consent")){if(adsReady||adsStarting)YandexAds.setUserConsent(false);destroyAds();return;}
  YandexAds.setUserConsent(true);
  String id="";JSONArray slots=cfg.optJSONArray("android");if(slots!=null)for(int i=0;i<slots.length();i++){JSONObject slot=slots.optJSONObject(i);if(name.equals(slot.optString("name")))id=slot.optString("id");}
  if(cfg.optBoolean("test",true))id="demo-banner-yandex";if(id.isEmpty())return;
  if(!adsReady){if(!adsStarting){adsStarting=true;YandexAds.setUserConsent(true);YandexAds.setLocationTracking(false);YandexAds.setAppAdAnalyticsReporting(false);YandexAds.initialize(getContext(),()->getActivity().runOnUiThread(()->{adsReady=true;adsStarting=false;if(root!=null&&lastPayload!=null){try{render(lastPayload);}catch(Exception error){close();emit("nativeSearchError",new JSObject());}}}));}return;}
  LinearLayout box=containers.get(name);if(box==null){box=column();box.setVisibility(View.GONE);box.addView(label("Реклама",12));BannerAdView ad=new BannerAdView(getContext());int width=Math.max(200,Math.round(getContext().getResources().getDisplayMetrics().widthPixels/getContext().getResources().getDisplayMetrics().density)-32);ad.setAdSize(BannerAdSize.inline(getContext(),width,160));box.addView(ad);final LinearLayout target=box;ad.setBannerAdEventListener(new BannerAdEventListener(){public void onAdLoaded(){if(root!=null&&!getActivity().isDestroyed()&&banners.get(name)==ad)target.setVisibility(View.VISIBLE);else ad.destroy();}public void onAdFailedToLoad(AdRequestError error){target.setVisibility(View.GONE);}public void onAdClicked(){}public void onImpression(ImpressionData impression){}});containers.put(name,box);banners.put(name,ad);ad.loadAd(new AdRequest.Builder(id).build());}attach(parent,box);
 }
 private void destroyAds(){for(BannerAdView ad:banners.values())ad.destroy();banners.clear();for(LinearLayout box:containers.values())if(box.getParent()!=null)((ViewGroup)box.getParent()).removeView(box);containers.clear();}
 private void openUrl(String value){try{Uri uri=Uri.parse(value);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException();getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(Exception e){Toast.makeText(getContext(),"Не удалось открыть ссылку",Toast.LENGTH_SHORT).show();}}
 @PluginMethod public void openExternal(PluginCall call){getActivity().runOnUiThread(()->{openUrl(call.getString("url",""));call.resolve();});}
 private void close(){lastPayload=null;destroyAds();if(root!=null){if(root.getParent()!=null)((ViewGroup)root.getParent()).removeView(root);root=null;}}
 public boolean handleNativeBack(){if(root==null)return false;close();emit("closeSearch",new JSObject());return true;}
 @PluginMethod public void closeSearch(PluginCall call){getActivity().runOnUiThread(()->{close();call.resolve();});}
 @Override protected void handleOnPause(){paused=true;if(root!=null)root.setVisibility(View.GONE);}
 @Override protected void handleOnResume(){paused=false;if(root!=null){long expires=lastPayload==null?0:lastPayload.optLong("expiresAt");if(expires>0&&expires<=System.currentTimeMillis()){root.setVisibility(View.GONE);emit("refreshSearch",new JSObject());}else root.setVisibility(View.VISIBLE);}}
 @Override protected void handleOnDestroy(){close();}
}
