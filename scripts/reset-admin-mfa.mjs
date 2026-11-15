import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {mkdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
process.umask(0o077);
const args=process.argv.slice(2),id=args[args.indexOf('--user-id')+1],reason=args[args.indexOf('--reason')+1],dir=process.env.DATA_DIR;
if(!dir||!args.includes('--user-id')||!args.includes('--reason')||!id||!reason?.trim()||reason.length>1000||!existsSync(join(dir,'po-puti.sqlite')))throw Error('Explicit DATA_DIR, --user-id and --reason are required for owner recovery');
const db=new DatabaseSync(join(dir,'po-puti.sqlite'));try{
 if(db.prepare('SELECT role FROM users WHERE id=?').get(id)?.role!=='admin')throw Error('Target must be an existing administrator');
 const folder=join(dir,'migration-backups');await mkdir(folder,{recursive:true,mode:0o700});const path=join(folder,'before-mfa-recovery-'+randomUUID()+'.sqlite');await backup(db,path);await chmod(path,0o600);
 db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');try{
  db.prepare('DELETE FROM admin_mfa WHERE user_id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('INSERT INTO admin_audit_log VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),null,Date.now(),'user',id,'owner_mfa_recovery','{}','{}',reason.trim());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 console.log('MFA_RECOVERY_OK: enrolled secret cleared, administrator sessions revoked, backup and audit preserved');
}finally{db.close()}
