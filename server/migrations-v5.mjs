import {backup,DatabaseSync} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Additive only: existing accounts, reviews, trips and files are never removed.
export async function migrateFeatures(db,dir){
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='features_schema'").get()){if(db.prepare('SELECT MAX(version) version FROM features_schema').get().version!==5)throw Error('Unsupported feature schema');return;}
 const folder=join(dir,'migration-backups');await mkdir(folder,{recursive:true,mode:0o700});
 const path=join(folder,'before-features-v5-'+randomUUID()+'.sqlite');await backup(db,path);await chmod(path,0o600);
 const copy=new DatabaseSync(path,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Feature backup integrity failed')}finally{copy.close()}
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`
 CREATE TABLE ride_series(id TEXT PRIMARY KEY,driver_id TEXT NOT NULL REFERENCES users(id),start_date TEXT NOT NULL,end_date TEXT NOT NULL,weekdays_json TEXT NOT NULL,time TEXT NOT NULL,time_zone TEXT NOT NULL,template_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,client_key TEXT NOT NULL,UNIQUE(driver_id,client_key),CHECK(julianday(end_date)-julianday(start_date) BETWEEN 0 AND 6));
 CREATE TABLE ride_series_exceptions(series_id TEXT NOT NULL REFERENCES ride_series(id),service_date TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(series_id,service_date));
 CREATE TABLE ride_series_revisions(id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES ride_series(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,action TEXT NOT NULL,details_json TEXT NOT NULL);
 ALTER TABLE rides ADD COLUMN series_id TEXT REFERENCES ride_series(id);
 ALTER TABLE rides ADD COLUMN service_date TEXT;
 CREATE UNIQUE INDEX ix_series_occurrence ON rides(series_id,service_date) WHERE series_id IS NOT NULL;
 CREATE INDEX ix_rides_departure ON rides(departure_at) WHERE cancelled=0 AND moderation_blocked=0;
 CREATE INDEX ix_rides_driver_date ON rides(driver_id,date,time);
 CREATE INDEX ix_search_date_time ON rides(date,time,id) WHERE cancelled=0 AND moderation_blocked=0;
 CREATE INDEX ix_request_capacity ON requests(ride_id,status);
 CREATE INDEX ix_notification_unread ON notifications(recipient_id,read,created);
 CREATE INDEX ix_session_user ON sessions(user_id);
 CREATE TABLE lifecycle_due(ride_id TEXT PRIMARY KEY REFERENCES rides(id),next_run_at INTEGER NOT NULL);
 CREATE INDEX ix_lifecycle_due ON lifecycle_due(next_run_at);
 INSERT INTO lifecycle_due SELECT id,0 FROM rides;
 CREATE TRIGGER lifecycle_new_ride AFTER INSERT ON rides BEGIN INSERT OR REPLACE INTO lifecycle_due VALUES(NEW.id,0); END;
 CREATE TRIGGER lifecycle_changed_ride AFTER UPDATE ON rides BEGIN INSERT OR REPLACE INTO lifecycle_due VALUES(NEW.id,0); END;
 CREATE TABLE external_usage(provider TEXT NOT NULL,requested_at INTEGER NOT NULL);
 CREATE INDEX ix_external_usage ON external_usage(provider,requested_at);
 CREATE TABLE external_provider_state(provider TEXT PRIMARY KEY,last_attempt_at INTEGER,last_success_at INTEGER,last_status INTEGER,last_error TEXT NOT NULL DEFAULT '');
 CREATE TABLE bus_purchase_info(id TEXT PRIMARY KEY,thread_uid TEXT NOT NULL,service_date TEXT NOT NULL,from_code TEXT NOT NULL,to_code TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',cashier TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL,verified_by TEXT NOT NULL REFERENCES users(id),verified_at INTEGER NOT NULL,valid_until INTEGER NOT NULL,UNIQUE(thread_uid,service_date,from_code,to_code));
 CREATE TABLE media_files(url TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),sha256 TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,sha256),UNIQUE(owner_id,url));
 CREATE TABLE privacy_consents(user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,version TEXT NOT NULL,granted INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,category));
 CREATE TABLE deletion_requests(user_id TEXT PRIMARY KEY REFERENCES users(id),requested_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
 CREATE TABLE admin_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret_enc TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_step INTEGER NOT NULL DEFAULT -1);
 CREATE TABLE session_mfa(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,verified_at INTEGER NOT NULL);
 CREATE TABLE features_schema(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,backup_path TEXT NOT NULL);
 `);
 for(const table of ['requests','ride_confirmations','pair_reviews','reports']){
  for(const op of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER due_${table}_${op.toLowerCase()} AFTER ${op} ON ${table} BEGIN INSERT OR REPLACE INTO lifecycle_due VALUES(NEW.ride_id,0); END;`);
 }
 db.prepare('INSERT INTO features_schema VALUES(5,?,?)').run(Date.now(),path);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}
