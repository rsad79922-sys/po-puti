import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Never touch a production DB. Exercise a temporary WAL-mode database only.
const tmp=mkdtempSync(join(tmpdir(),'poputi-backup-test-'));
try {
  const source=join(tmp,'real.sqlite'), target=join(tmp,'snapshot.sqlite');
  const db=new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE rides(id TEXT PRIMARY KEY, name TEXT);');
  db.prepare('INSERT INTO rides VALUES(?,?)').run('r1','По пути');
  const script=new URL('../deploy/backup-sqlite.mjs',import.meta.url).pathname;
  const run=(src,dst)=>spawnSync(process.execPath,[script,src,dst],{encoding:'utf8'});
  const output=run(source,target);
  assert.equal(output.status,0,output.stderr);
  assert.match(output.stdout,/BACKUP_OK/);
  const verify=new DatabaseSync(target,{readOnly:true});
  assert.deepEqual({...verify.prepare('SELECT * FROM rides').get()},{id:'r1',name:'По пути'});
  assert.equal(verify.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  verify.close();
  // Re-running cannot replace a working backup.
  const before=readFileSync(target);
  const rerun=run(source,target);
  assert.notEqual(rerun.status,0);
  assert.deepEqual(readFileSync(target),before);
  // Original DB remains writable; backup is owner-only readable.
  db.prepare('INSERT INTO rides VALUES(?,?)').run('r2','Вторая поездка');
  assert.equal(db.prepare('SELECT count(*) AS n FROM rides').get().n,2);
  assert.equal(statSync(target).mode & 0o777,0o600);
  db.close();
  console.log('SQLite WAL online backup + restore integrity + no-overwrite: PASS');
} finally {rmSync(tmp,{recursive:true,force:true});}
