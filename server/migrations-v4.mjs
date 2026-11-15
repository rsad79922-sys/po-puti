import {backup,DatabaseSync} from 'node:sqlite';import {mkdir,chmod} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
export async function migrateRouting(db,dir){
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='routing_schema'").get()){if(db.prepare('SELECT MAX(version) version FROM routing_schema').get().version!==4)throw Error('Unsupported routing schema');return;}if(db.prepare('SELECT MAX(version) version FROM lifecycle_schema').get().version!==3)throw Error('Unsupported pre-routing schema');
 const backups=join(dir,'migration-backups');await mkdir(backups,{recursive:true,mode:0o700});const path=join(backups,'before-routing-v4-'+randomUUID()+'.sqlite');await backup(db,path);await chmod(path,0o600);const check=new DatabaseSync(path,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Routing backup integrity failed')}finally{check.close()}
 db.exec('BEGIN IMMEDIATE');try{
  for(const [name,type] of [['route_distance_m','INTEGER'],['route_calculated_at','INTEGER'],['departure_timezone','TEXT'],['destination_timezone','TEXT'],['route_points_json',"TEXT NOT NULL DEFAULT '[]'"]])db.exec('ALTER TABLE rides ADD COLUMN '+name+' '+type);
  db.exec(`CREATE TABLE routing_schema(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,backup_path TEXT NOT NULL);
   CREATE TABLE routing_cache(cache_key TEXT PRIMARY KEY,value_json TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE route_quotes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,value_json TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
   CREATE INDEX ix_route_quote_expiry ON route_quotes(expires_at);
   CREATE TABLE ride_eta_history(id TEXT PRIMARY KEY,ride_id TEXT NOT NULL REFERENCES rides(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,old_value TEXT NOT NULL,new_value TEXT NOT NULL,reason TEXT NOT NULL);
   CREATE TRIGGER eta_history_no_update BEFORE UPDATE ON ride_eta_history BEGIN SELECT RAISE(ABORT,'ETA history is append-only'); END;
   CREATE TRIGGER eta_history_no_delete BEFORE DELETE ON ride_eta_history BEGIN SELECT RAISE(ABORT,'ETA history is append-only'); END;
   CREATE TABLE routing_provider_usage(id TEXT PRIMARY KEY,provider TEXT NOT NULL,requested_at INTEGER NOT NULL);
   CREATE INDEX ix_routing_usage_time ON routing_provider_usage(provider,requested_at);
   CREATE TABLE routing_diagnostics(provider TEXT PRIMARY KEY,last_attempt_at INTEGER,last_success_at INTEGER,failures INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '');`);
  db.prepare('INSERT INTO routing_schema VALUES(?,?,?)').run(4,Date.now(),path);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
