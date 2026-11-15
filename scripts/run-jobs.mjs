#!/usr/bin/env node
import {existsSync} from 'node:fs';
// Optional one-shot worker, suitable for operator recovery. The API also ticks every minute.
import {DatabaseSync} from 'node:sqlite';import {join,resolve} from 'node:path';
import {lifecycle} from '../server/lifecycle.mjs';import {createPush,processPush} from '../server/push.mjs';
process.umask(0o077);const path=join(resolve(process.env.DATA_DIR||'server-data'),'po-puti.sqlite');if(!existsSync(path))throw Error('Existing database not found');const db=new DatabaseSync(path);
try{db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');if(!db.prepare("SELECT name FROM sqlite_master WHERE name='lifecycle_schema'").get())throw Error('Start upgraded API to migrate first');const transport=createPush();const l=lifecycle(db,{pushAvailable:transport.available});l.tick();await processPush(l,transport);console.log('JOBS_OK')}finally{db.close()}
