#!/usr/bin/env node
/** Private, on-VPS migration rehearsal. Source is opened read-only, never exported. */
import {DatabaseSync,backup} from 'node:sqlite';import {resolve,join} from 'node:path';import {mkdir,chmod,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {migrateLifecycle,lifecycle} from '../server/lifecycle.mjs';
process.umask(0o077);
const [sourceArg,targetArg]=process.argv.slice(2);if(!sourceArg||!targetArg||!sourceArg.startsWith('/')||!targetArg.startsWith('/'))throw Error('Usage: node scripts/validate-lifecycle-copy.mjs /absolute/live.sqlite /absolute/new-private-directory');
const sourcePath=await realpath(sourceArg),dir=resolve(targetArg);if(dir===sourcePath||sourcePath.startsWith(dir+'/'))throw Error('Copy directory must not contain the source database');
await mkdir(dir,{mode:0o700});const target=join(dir,'po-puti.sqlite');
const source=new DatabaseSync(sourcePath,{readOnly:true});try{await backup(source,target)}finally{source.close()}await chmod(target,0o600);
const db=new DatabaseSync(target);db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL');
try{
 const names=['users','rides','requests','messages','reviews','reports','notifications'];
 const before=new Map();for(const name of names){const columns=db.prepare('PRAGMA table_info('+name+')').all().map(c=>c.name);const records=db.prepare('SELECT * FROM '+name).all();before.set(name,{columns,records:new Map(records.map(r=>[r.id,createHash('sha256').update(JSON.stringify(r)).digest('hex')]))})}
 await migrateLifecycle(db,dir);
 for(const [name,state] of before){for(const [id,digest] of state.records){const row=db.prepare('SELECT '+state.columns.map(c=>'"'+c+'"').join(',')+' FROM '+name+' WHERE id=?').get(id);if(!row||createHash('sha256').update(JSON.stringify(row)).digest('hex')!==digest)throw Error('Existing data changed in migration rehearsal: '+name)}}
 lifecycle(db).tick();
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Copy integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Copy has foreign-key violations');
 const duplicates=db.prepare('SELECT ride_id,author_id,target_user_id,COUNT(*) n FROM pair_reviews GROUP BY ride_id,author_id,target_user_id HAVING COUNT(*)>1').all();if(duplicates.length)throw Error('Duplicate pair reviews');
 console.log('COPY_VALIDATION_OK: source opened read-only; all pre-migration records preserved; integrity, foreign keys and review uniqueness passed; no push delivery attempted');
}catch(error){console.error('COPY_VALIDATION_FAILED:',error.message);process.exitCode=1}finally{db.close()}
