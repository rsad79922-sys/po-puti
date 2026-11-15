#!/usr/bin/env node
import {existsSync} from 'node:fs';
// Local server command only. Never accepts a public password or creates users.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
process.umask(0o077);
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const id=args.includes('--user-id')?value('--user-id'):'',reason=args.includes('--reason')?value('--reason'):'';
if(!id||id.length>100||!reason?.trim()||reason.length>1000)throw Error('Usage: DATA_DIR=/var/lib/po-puti node scripts/admin-user.mjs --user-id EXISTING_ID --reason "Owner verified" [--revoke]');
const dir=resolve(process.env.DATA_DIR||'server-data');const path=join(dir,'po-puti.sqlite');if(!existsSync(path))throw Error('Existing database not found');const db=new DatabaseSync(path);
try{
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='lifecycle_schema'").get())throw Error('Apply lifecycle migration before assigning an administrator');
 const user=db.prepare('SELECT id,role FROM users WHERE id=?').get(id);if(!user)throw Error('Account does not exist; register it first');
 const role=args.includes('--revoke')?'user':'admin';
 if(user.role===role){console.log('ROLE_UNCHANGED',id,role)}else{
  if(role==='user'&&db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND blocked_at IS NULL").get().n<2)throw Error('Cannot revoke the last administrator');
  const snapshots=join(dir,'migration-backups');await mkdir(snapshots,{recursive:true,mode:0o700});const file=join(snapshots,'before-admin-'+randomUUID()+'.sqlite');await backup(db,file);await chmod(file,0o600);
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id);
   db.prepare('INSERT INTO admin_audit_log VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),null,Date.now(),'user',id,'server_role_command',JSON.stringify({role:user.role}),JSON.stringify({role}),reason.trim());
   db.exec('COMMIT');console.log('ROLE_UPDATED',id,role);
  }catch(e){db.exec('ROLLBACK');throw e}
 }
}finally{db.close()}
