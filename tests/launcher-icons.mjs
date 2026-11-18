import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {prepareLauncherIcons,launcherSource} from '../scripts/prepare-launcher-icons.mjs';
const root=await mkdtemp(join(tmpdir(),'poputi-brand-'));
try{
 const resources=join(root,'app/src/main/res');await mkdir(join(resources,'values'),{recursive:true});await mkdir(join(resources,'mipmap-mdpi'),{recursive:true});
 await writeFile(join(resources,'values/styles.xml'),'<resources><style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen"><item name="android:background">@drawable/splash</item></style></resources>');
 await sharp({create:{width:48,height:48,channels:3,background:'#0099ff'}}).png().toFile(join(resources,'mipmap-mdpi/ic_launcher.png'));
 const source=await readFile(launcherSource);assert.equal(createHash('sha256').update(source).digest('hex'),'2470bdf52a712ac5422aeafae7efa8e61b1d2a118a380d5de6ffe403e024ac80','must package the exact owner-provided logo');
 const stock=await readFile(join(resources,'mipmap-mdpi/ic_launcher.png'));await prepareLauncherIcons(resources);
 for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
  const ordinary=await readFile(join(resources,'mipmap-'+density,'ic_launcher.png')),round=await readFile(join(resources,'mipmap-'+density,'ic_launcher_round.png'));const corner=await sharp(round).ensureAlpha().raw().toBuffer();assert.equal(corner[3],0,'legacy round icon must have transparent corners');const m=await sharp(ordinary).metadata();assert.equal(m.width,size);assert.equal(m.height,size);assert.notDeepEqual(ordinary,stock);
 }
 for(const name of ['ic_launcher','ic_launcher_round']){const xml=await readFile(join(resources,'mipmap-anydpi-v26',name+'.xml'),'utf8');assert(xml.includes('@drawable/poputi_launcher_foreground'));assert(!xml.includes('@mipmap/ic_launcher_foreground'))}
 const fg=join(resources,'drawable-nodpi/poputi_launcher_foreground.png'),meta=await sharp(fg).metadata();assert.equal(meta.width,432);assert.equal(meta.height,432);const pixel=await sharp(fg).ensureAlpha().raw().toBuffer();assert.equal(pixel[3],0,'safe-area padding must be transparent');assert.equal(pixel[(216*432+216)*4+3],255);
 const styles=await readFile(join(resources,'values/styles.xml'),'utf8');assert(styles.includes('@drawable/poputi_splash'));assert(styles.includes('windowSplashScreenAnimatedIcon'));
 const before=await readFile(fg);await prepareLauncherIcons(resources);assert.deepEqual(await readFile(fg),before,'repeated prepare must be deterministic');
 console.log('PASS: exact owner logo replaces stock launcher resources at all five densities, round/adaptive resources, safe zone and branded splash; deterministic regeneration');
}finally{await rm(root,{recursive:true,force:true})}
