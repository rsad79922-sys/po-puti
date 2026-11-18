package ru.poputi.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.AdaptiveIconDrawable;

/** Inspect the icon actually resolved by Android, including adaptive resources.
 * This runs before any account is created and does not read user files. */
public final class LauncherIconAssertions {
    public static void assertOwnerBrand(Context context) throws Exception {
        Drawable icon=context.getPackageManager().getApplicationIcon(context.getPackageName());
        if(android.os.Build.VERSION.SDK_INT>=26)assertTrue("Launcher must resolve the adaptive brand icon",icon instanceof AdaptiveIconDrawable);
        Bitmap bitmap=Bitmap.createBitmap(192,192,Bitmap.Config.ARGB_8888);
        icon.setBounds(0,0,192,192);icon.draw(new Canvas(bitmap));
        int navy=0,turquoise=0,white=0;
        for(int y=0;y<192;y++)for(int x=0;x<192;x++){
            int p=bitmap.getPixel(x,y),r=Color.red(p),g=Color.green(p),b=Color.blue(p);
            if(Color.alpha(p)<200)continue;
            if(r<70&&g<60&&b<130)navy++;
            if(r<90&&g>160&&b>130)turquoise++;
            if(r>215&&g>215&&b>215)white++;
        }
        bitmap.recycle();
        assertTrue("Owner navy background must replace the stock icon",navy>192*192/5);
        assertTrue("Owner turquoise road/pins must be present",turquoise>192*192/100);
        assertTrue("Owner white pin/car must be present",white>192*192/50);
    }
    private LauncherIconAssertions(){}
}
