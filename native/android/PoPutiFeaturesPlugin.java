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
 private LinearLayout wantedActions,filterButtons;
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
 @PluginMethod public void removeToken(PluginCall call){synchronized(PoPutiRuStoreState.LOCK){PoPutiRuStoreState.disable(getContext(),true);getContext().getSharedPreferences(alias,Context.MODE_PRIVATE).edit().clear().commit();}call.resolve();}
 private static final int INK=0xff141b3b,TEAL=0xff47d9cb,TEAL_DARK=0xff087d77,PAPER=0xfff5f7fb,LINE=0xffe7eaf2,SLATE=0xff78819a;
 private ScrollView searchScroll;
 private LocalDate selectedDate=LocalDate.now().plusDays(1);
 private final java.util.Locale russian=new java.util.Locale("ru");
 private int dp(int n){return Math.round(n*getContext().getResources().getDisplayMetrics().density);}
 private android.graphics.drawable.GradientDrawable surface(int color,int border,int radius){android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));if(border!=0)d.setStroke(dp(1),border);return d;}
 private LinearLayout column(){LinearLayout box=new LinearLayout(getContext());box.setOrientation(LinearLayout.VERTICAL);return box;}
 private TextView label(String text,int size){TextView v=new TextView(getContext());v.setText(text);v.setTextSize(size);v.setTextColor(INK);v.setPadding(0,dp(5),0,dp(5));return v;}
 private void weight(TextView v){v.setTypeface(android.graphics.Typeface.create("sans-serif-medium",android.graphics.Typeface.NORMAL));}
 private Button button(String text,Runnable action){Button b=new Button(getContext());b.setText(text);b.setAllCaps(false);b.setTextSize(14);weight(b);b.setTextColor(TEAL_DARK);b.setMinWidth(0);b.setMinimumWidth(0);b.setMinHeight(dp(48));b.setMinimumHeight(dp(48));b.setPadding(dp(12),dp(10),dp(12),dp(10));b.setStateListAnimator(null);b.setBackgroundTintList(null);b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x18087d77),surface(Color.WHITE,LINE,16),surface(Color.WHITE,0,16)));b.setOnClickListener(v->action.run());return b;}
 private void primary(Button b){b.setTextColor(INK);b.setTextSize(16);b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x20087d77),surface(TEAL,0,18),surface(Color.WHITE,0,18)));}
 private EditText input(String hint){EditText v=new EditText(getContext());v.setId(View.generateViewId());v.setSingleLine(true);v.setHint(hint);v.setTextSize(16);v.setTextColor(INK);v.setHintTextColor(SLATE);v.setPadding(dp(16),dp(12),dp(16),dp(12));v.setMinHeight(dp(56));v.setBackground(surface(0xfff8f9fc,LINE,18));v.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS);v.setOnFocusChangeListener((view,focused)->v.setBackground(surface(0xfff8f9fc,focused?TEAL_DARK:LINE,18)));return v;}
 private void field(LinearLayout parent,String title,EditText input){TextView caption=label(title,12);caption.setTextColor(SLATE);weight(caption);caption.setLabelFor(input.getId());parent.addView(caption);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(8);parent.addView(input,p);}
 private LinearLayout card(){LinearLayout box=column();box.setPadding(dp(18),dp(14),dp(18),dp(16));box.setBackground(surface(Color.WHITE,LINE,24));box.setElevation(dp(1));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(14);box.setLayoutParams(p);return box;}
 private void emit(String name,JSObject data){notifyListeners(name,data);}
 private LocalDate readDate(){String value=date.getText().toString().trim();if(value.matches("\\d{4}-\\d{2}-\\d{2}"))selectedDate=LocalDate.parse(value);return selectedDate;}
 private void showDate(){date.setText(PoPutiSearchDate.label(selectedDate));}
 private LocalDate nearestDate(int month,int day){return PoPutiSearchDate.next(LocalDate.now(),month,day);}

 private void chooseDate(){
  readDate();LinearLayout pickers=new LinearLayout(getContext());pickers.setGravity(android.view.Gravity.CENTER);pickers.setPadding(dp(16),dp(8),dp(16),dp(8));
  NumberPicker day=new NumberPicker(getContext()),month=new NumberPicker(getContext());day.setContentDescription("День");month.setContentDescription("Месяц");day.setDescendantFocusability(NumberPicker.FOCUS_BLOCK_DESCENDANTS);month.setDescendantFocusability(NumberPicker.FOCUS_BLOCK_DESCENDANTS);
  month.setMinValue(1);month.setMaxValue(12);month.setDisplayedValues(new String[]{"Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"});month.setValue(selectedDate.getMonthValue());day.setMinValue(1);day.setMaxValue(nearestDate(month.getValue(),selectedDate.getDayOfMonth()).lengthOfMonth());day.setValue(Math.min(selectedDate.getDayOfMonth(),day.getMaxValue()));
  month.setOnValueChangedListener((picker,old,value)->day.setMaxValue(nearestDate(value,day.getValue()).lengthOfMonth()));pickers.addView(day,new LinearLayout.LayoutParams(0,-2,1));pickers.addView(month,new LinearLayout.LayoutParams(0,-2,2));
  android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(getActivity()).setTitle("Выберите день и месяц").setView(pickers).setNegativeButton("Отмена",null).setPositiveButton("Выбрать",(d,w)->{selectedDate=nearestDate(month.getValue(),day.getValue());showDate();}).create();dialog.setOnShowListener(d->{dialog.getButton(-1).setTextColor(TEAL_DARK);dialog.getButton(-2).setTextColor(SLATE);});dialog.show();
 }
 private JSObject query(){return new JSObject().put("from",from.getText().toString().trim()).put("to",to.getText().toString().trim()).put("date",readDate().toString()).put("filter",filter);}
 private void search(){try{if(from.getText().toString().trim().isEmpty()||to.getText().toString().trim().isEmpty())throw new IllegalArgumentException();JSObject data=query();showDate();root.clearFocus();((android.view.inputmethod.InputMethodManager)getContext().getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(),0);emit("search",data);}catch(Exception error){Toast.makeText(getContext(),"Укажите маршрут и выберите дату",Toast.LENGTH_SHORT).show();}}
 private void attach(ViewGroup parent,View view){if(view.getParent()!=null)((ViewGroup)view.getParent()).removeView(view);parent.addView(view);}
 private void createRoot(){
  root=column();root.setTag("po-puti-native-search");root.setBackgroundColor(PAPER);root.setFocusableInTouchMode(true);
  LinearLayout header=new LinearLayout(getContext());header.setGravity(android.view.Gravity.CENTER_VERTICAL);header.setPadding(dp(16),dp(10),dp(16),dp(10));ImageView logo=new ImageView(getContext());logo.setImageResource(R.mipmap.ic_launcher);logo.setContentDescription("По пути");header.addView(logo,new LinearLayout.LayoutParams(dp(32),dp(32)));TextView brand=label("  По пути",21);weight(brand);header.addView(brand,new LinearLayout.LayoutParams(0,-2,1));Button publish=button("＋ Поездка",()->{close();emit("publish",new JSObject());});publish.setTextSize(12);header.addView(publish);root.addView(header);
  searchScroll=new ScrollView(getContext());searchScroll.setTag("po-puti-search-scroll");searchScroll.setFillViewport(true);searchScroll.setClipToPadding(false);searchScroll.setPadding(dp(16),dp(4),dp(16),dp(16));LinearLayout content=column();searchScroll.addView(content);root.addView(searchScroll,new LinearLayout.LayoutParams(-1,0,1));
  LinearLayout form=card();form.setTag("po-puti-search-card");TextView title=label("Куда едем?",26);weight(title);form.addView(title);TextView subtitle=label("НАЙТИ ПОПУТЧИКОВ",10);subtitle.setTextColor(TEAL_DARK);weight(subtitle);form.addView(subtitle);
  from=input("Откуда");to=input("Куда");date=input("Выберите дату");date.setKeyListener(null);date.setFocusable(false);date.setOnClickListener(v->chooseDate());date.setCompoundDrawablesWithIntrinsicBounds(null,null,new UiIcon("calendar",TEAL_DARK,dp(21)),null);
  field(form,"Откуда",from);field(form,"Куда",to);field(form,"Когда",date);from.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_NEXT);from.setNextFocusForwardId(to.getId());to.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);to.setOnEditorActionListener((v,action,event)->{if(action==android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH){search();return true;}return false;});
  Button find=button("Найти поездку",this::search);find.setTag("po-puti-search-submit");primary(find);find.setCompoundDrawablesWithIntrinsicBounds(new UiIcon("search",INK,dp(22)),null,null,null);form.addView(find,new LinearLayout.LayoutParams(-1,-2));content.addView(form);
  topAd=column();content.addView(topAd);filterButtons=new LinearLayout(getContext());filterButtons.setTag("po-puti-search-filters");filterButtons.setPadding(dp(4),dp(4),dp(4),dp(4));filterButtons.setBackground(surface(0xffedf1f7,0,16));String[] values={"all","private","bus"},titles={"Все","Попутка","Автобусы"};
  for(int i=0;i<values.length;i++){final String value=values[i];Button b=button(titles[i],()->{filter=value;emit("filter",query());});b.setTextSize(12);b.setSingleLine(true);b.setPadding(dp(2),dp(8),dp(2),dp(8));filterButtons.addView(b,new LinearLayout.LayoutParams(0,-2,1));}LinearLayout.LayoutParams filtersLayout=new LinearLayout.LayoutParams(-1,-2);filtersLayout.bottomMargin=dp(14);content.addView(filterButtons,filtersLayout);
  wantedActions=column();wantedActions.setTag("po-puti-native-wanted");Button wanted=button("Ищу попутку",()->{close();emit("wanted",new JSObject());});wanted.setBackground(surface(0xffeaf9f5,0xffbde5df,16));wantedActions.addView(wanted,new LinearLayout.LayoutParams(-1,-2));Button list=button("Заявки пассажиров",()->{close();emit("wantedList",new JSObject());});LinearLayout.LayoutParams listLayout=new LinearLayout.LayoutParams(-1,-2);listLayout.topMargin=dp(8);listLayout.bottomMargin=dp(14);wantedActions.addView(list,listLayout);
  results=column();content.addView(results);Button offer=button("Предложить поездку",()->{close();emit("publish",new JSObject());});primary(offer);content.addView(offer,new LinearLayout.LayoutParams(-1,-2));
  LinearLayout tabs=new LinearLayout(getContext());tabs.setTag("po-puti-search-nav");tabs.setPadding(dp(8),dp(6),dp(8),dp(6));tabs.setBackgroundColor(Color.WHITE);tabs.setElevation(dp(8));String[] routes={"search","trips","notifications","profile"},names={"Поиск","Мои поездки","Уведомления","Профиль"},icons={"search","car","bell","user"};
  for(int i=0;i<4;i++){final String route=routes[i];LinearLayout tab=column();tab.setGravity(android.view.Gravity.CENTER);tab.setPadding(dp(1),dp(6),dp(1),dp(6));tab.setMinimumHeight(dp(56));tab.setContentDescription(names[i]);tab.setClickable(true);if(i==0)tab.setBackground(surface(0xffeaf9f5,0,14));int color=i==0?TEAL_DARK:SLATE;ImageView icon=new ImageView(getContext());icon.setImageDrawable(new UiIcon(icons[i],color,dp(22)));tab.addView(icon,new LinearLayout.LayoutParams(dp(22),dp(22)));TextView caption=label(names[i],10);caption.setTextColor(color);weight(caption);caption.setSingleLine(true);caption.setEllipsize(android.text.TextUtils.TruncateAt.END);caption.setGravity(android.view.Gravity.CENTER);if(android.os.Build.VERSION.SDK_INT>=26)caption.setAutoSizeTextTypeUniformWithConfiguration(8,10,1,android.util.TypedValue.COMPLEX_UNIT_SP);tab.addView(caption,new LinearLayout.LayoutParams(-1,-2));tab.setOnClickListener(v->{if(route.equals("search"))searchScroll.smoothScrollTo(0,0);else{close();emit("navigate",new JSObject().put("route",route));}});tabs.addView(tab,new LinearLayout.LayoutParams(0,-2,1));}root.addView(tabs);
  androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});getActivity().addContentView(root,new ViewGroup.LayoutParams(-1,-1));androidx.core.view.ViewCompat.requestApplyInsets(root);
 }
 private void styleFilter(Button button,boolean selected){button.setSelected(selected);button.setTextColor(selected?INK:SLATE);button.setBackgroundTintList(null);button.setBackground(surface(selected?Color.WHITE:Color.TRANSPARENT,0,12));button.setElevation(selected?dp(2):0);}
 private static final class UiIcon extends android.graphics.drawable.Drawable {
  final String kind;final int color,size;UiIcon(String kind,int color,int size){this.kind=kind;this.color=color;this.size=size;}
  @Override public int getIntrinsicWidth(){return size;}@Override public int getIntrinsicHeight(){return size;}
  @Override public void draw(android.graphics.Canvas canvas){android.graphics.Paint p=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);p.setColor(color);p.setStyle(android.graphics.Paint.Style.STROKE);p.setStrokeWidth(1.8f);p.setStrokeCap(android.graphics.Paint.Cap.ROUND);p.setStrokeJoin(android.graphics.Paint.Join.ROUND);canvas.save();canvas.translate(getBounds().left,getBounds().top);canvas.scale(getBounds().width()/24f,getBounds().height()/24f);
   if(kind.equals("search")){canvas.drawCircle(10.5f,10.5f,6.5f,p);canvas.drawLine(15.5f,15.5f,21,21,p);}
   else if(kind.equals("user")){canvas.drawCircle(12,7,3.5f,p);android.graphics.Path a=new android.graphics.Path();a.moveTo(4,21);a.cubicTo(4,11,20,11,20,21);canvas.drawPath(a,p);}
   else if(kind.equals("bell")){android.graphics.Path a=new android.graphics.Path();a.moveTo(5,17);a.lineTo(7,14);a.lineTo(7,9);a.cubicTo(7,2,17,2,17,9);a.lineTo(17,14);a.lineTo(19,17);a.close();canvas.drawPath(a,p);canvas.drawArc(10,18,14,22,0,180,false,p);}
   else if(kind.equals("calendar")){canvas.drawRoundRect(3,5,21,21,3,3,p);canvas.drawLine(3,10,21,10,p);canvas.drawLine(8,3,8,7,p);canvas.drawLine(16,3,16,7,p);canvas.drawLine(8,15,10,15,p);canvas.drawLine(14,15,16,15,p);}
   else{android.graphics.Path a=new android.graphics.Path();a.moveTo(4,11);a.lineTo(7,5);a.lineTo(17,5);a.lineTo(20,11);a.lineTo(20,18);a.lineTo(4,18);a.close();canvas.drawPath(a,p);canvas.drawLine(4,11,20,11,p);canvas.drawLine(6,18,6,21,p);canvas.drawLine(18,18,18,21,p);canvas.drawCircle(7,14.5f,1,p);canvas.drawCircle(17,14.5f,1,p);}
   canvas.restore();
  }
  @Override public void setAlpha(int alpha){}@Override public void setColorFilter(android.graphics.ColorFilter filter){}@Override public int getOpacity(){return android.graphics.PixelFormat.TRANSLUCENT;}
 }
 @PluginMethod public void showSearch(PluginCall call){lastPayload=call.getData();getActivity().runOnUiThread(()->{if(getActivity().isFinishing()||getActivity().isDestroyed()){call.resolve();return;}try{render(lastPayload);call.resolve();}catch(Exception error){close();call.reject("Native search unavailable");}});}
 private void render(JSObject data){
  if(root==null)createRoot();JSONObject query=data.optJSONObject("query");if(query!=null&&!from.hasFocus()&&!to.hasFocus()&&!date.hasFocus()){from.setText(query.optString("from"));to.setText(query.optString("to"));try{selectedDate=LocalDate.parse(query.optString("date"));showDate();}catch(Exception ignored){}}
  root.setVisibility(paused?View.GONE:View.VISIBLE);filter=data.optString("filter","all");wantedActions.setVisibility(data.optBoolean("wantedEnabled")?View.VISIBLE:View.GONE);for(int i=0;i<3;i++){Button b=(Button)filterButtons.getChildAt(i);boolean selected=new String[]{"all","private","bus"}[i].equals(filter);styleFilter(b,selected);}results.removeAllViews();attach(results,wantedActions);topAd.removeAllViews();String status=data.optString("status");if(!status.isEmpty())results.addView(label(status,15));
  JSONObject choices=data.optJSONObject("choices");if(choices!=null)for(String side:new String[]{"from","to"}){JSONArray options=choices.optJSONArray(side);if(options!=null&&options.length()>0){Spinner spinner=new Spinner(getContext());List<String> labels=new ArrayList<>();labels.add("Уточните "+(side.equals("from")?"отправление":"назначение"));for(int i=0;i<options.length();i++){JSONObject o=options.optJSONObject(i);labels.add(o.optString("title")+" · "+o.optString("region"));}spinner.setAdapter(new ArrayAdapter<>(getContext(),android.R.layout.simple_spinner_dropdown_item,labels));spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,View v,int i,long id){if(i>0)emit("place",new JSObject().put("side",side).put("code",options.optJSONObject(i-1).optString("code")));}});results.addView(spinner);}}
  JSONArray items=data.optJSONArray("items");int count=items==null?0:items.length();for(int i=0;i<count;i++){JSONObject item=items.optJSONObject(i);if(item==null)continue;LinearLayout card=card();boolean bus=item.optString("type").equals("bus_service");card.addView(label(bus?"Автобус":"Попутчики",14));TextView route=label(item.optString("from")+" → "+item.optString("to"),19);weight(route);card.addView(route);
   if(bus){card.addView(label(time(item.optString("departureAt"),item.optString("departureTimeZone"))+" → "+time(item.optString("arrivalAt"),item.optString("destinationTimeZone")),17));String carrier=item.optString("carrier");if(!carrier.isEmpty())card.addView(label("Перевозчик: "+carrier,15));card.addView(label("Где купить билет",16));JSONObject purchase=item.optJSONObject("purchase");String url=purchase==null?"":purchase.optString("url"),cashier=purchase==null?"":purchase.optString("cashier");if(!url.isEmpty())card.addView(button("Перейти к покупке этого рейса",()->openUrl(url)));else card.addView(label(cashier.isEmpty()?"Информация о покупке билета отсутствует":cashier,15));card.addView(button("Данные предоставлены сервисом Яндекс.Расписания",()->openUrl("https://rasp.yandex.ru/")));card.addView(label("Справочное расписание. Время местное для каждой остановки.",14));}
   else{String dayLabel=item.optString("date");try{dayLabel=PoPutiSearchDate.label(LocalDate.parse(dayLabel));}catch(Exception ignored){}card.addView(label(dayLabel+" · "+item.optString("time"),17));card.addView(label(item.optString("driver")+" · "+item.optString("car"),15));card.addView(label("Свободных мест: "+item.optInt("available"),15));card.addView(label(item.isNull("price")?"По договорённости":item.optInt("price")+" ₽ за место",16));card.addView(button("Посмотреть поездку",()->{close();emit("openRide",new JSObject().put("id",item.optString("id")));}));}
   results.addView(card);if(i==4)addAd(results,"results",data);
  }
  if(count==0){LinearLayout empty=card();empty.setTag("po-puti-search-empty");android.graphics.drawable.GradientDrawable bg=surface(Color.WHITE,0,22);bg.setStroke(dp(1),0xffccd3df,dp(5),dp(4));empty.setBackground(bg);TextView heading=label("Подходящих поездок пока нет",18);weight(heading);heading.setGravity(android.view.Gravity.CENTER);empty.addView(heading);TextView hint=label("Измените маршрут или дату — попробуем найти другие варианты.",13);hint.setTextColor(SLATE);hint.setGravity(android.view.Gravity.CENTER);empty.addView(hint);results.addView(empty);}if(count<5)addAd(results,"results",data);addAd(topAd,"search",data);
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
