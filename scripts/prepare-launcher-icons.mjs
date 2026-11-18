// Package the owner's original logo; no generated/redrawn replacement artwork.
import sharp from 'sharp';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export const launcherSource=new URL('../native/branding/launcher-source.jpg',import.meta.url);
export async function prepareLauncherIcons(resources){
 const source=await readFile(launcherSource),meta=await sharp(source).metadata();
 if(meta.width!==meta.height||meta.width<512)throw Error('Launcher source must be a square high-resolution brand image');
 for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
  const folder=join(resources,'mipmap-'+density);await mkdir(folder,{recursive:true});
  const icon=join(folder,'ic_launcher.png');await sharp(source).rotate().resize(size,size).png().toFile(icon);await sharp(source).rotate().resize(size,size).composite([{input:Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`),blend:'dest-in'}]).png().toFile(join(folder,'ic_launcher_round.png'));
 }
 const drawable=join(resources,'drawable-nodpi');await mkdir(drawable,{recursive:true});
 // Adaptive layers use a 108dp viewport; the central 72dp keeps the whole pin
 // within circular and rounded launcher masks rather than clipping its tip.
 await sharp(source).rotate().resize(288,288).extend({top:72,bottom:72,left:72,right:72,background:{r:0,g:0,b:0,alpha:0}}).png().toFile(join(drawable,'poputi_launcher_foreground.png'));
 const adaptive=join(resources,'mipmap-anydpi-v26');await mkdir(adaptive,{recursive:true});
 const xml='<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/poputi_launcher_background"/><foreground android:drawable="@drawable/poputi_launcher_foreground"/></adaptive-icon>\n';
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(join(adaptive,name+'.xml'),xml);
 const values=join(resources,'values');await mkdir(values,{recursive:true});await writeFile(join(values,'poputi_launcher.xml'),'<?xml version="1.0" encoding="utf-8"?><resources><color name="poputi_launcher_background">#0e0139</color></resources>\n');
 const draw=join(resources,'drawable');await mkdir(draw,{recursive:true});await writeFile(join(draw,'poputi_splash.xml'),'<?xml version="1.0" encoding="utf-8"?><layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/poputi_launcher_background"/><item android:width="144dp" android:height="144dp" android:gravity="center" android:drawable="@drawable/poputi_launcher_foreground"/></layer-list>\n');
 const styles=join(values,'styles.xml');let text=await readFile(styles,'utf8');
 if(!/<style name="AppTheme.NoActionBarLaunch"/.test(text))throw Error('Expected Capacitor launch theme is missing; refusing a stock-icon fallback');
 text=text.replace(/<style name="AppTheme.NoActionBarLaunch"[\s\S]*?<\/style>/,`<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/poputi_splash</item>
        <item name="windowSplashScreenBackground">@color/poputi_launcher_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/poputi_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`);await writeFile(styles,text);
}
