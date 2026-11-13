#!/usr/bin/env node
/**
 * Manual, non-destructive SQLite backup for Po Puti.
 * Does not deploy code, restart services or modify the source database.
 * Requires Node >= 22.16.0 for node:sqlite backup().
 * Usage: node deploy/backup-sqlite.mjs /absolute/source.sqlite /absolute/backup.sqlite
 * Destination must be a NEW file in an existing directory (never overwritten).
 */
import { backup, DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(s => !s.startsWith('/'))) {
  console.error('Usage: node backup-sqlite.mjs /absolute/source.sqlite /absolute/new-backup.sqlite');
  process.exitCode = 2;
} else {
  const source = resolve(args[0]);
  const target = resolve(args[1]);
  let sourceDb;
  let created = false;
  try {
    if (source === target) throw Error('Source and backup must be different files');
    if (!statSync(source).isFile()) throw Error('Source is not a regular file');
    // Exclusive creation prevents accidental overwrites. Backups are private.
    closeSync(openSync(target, 'wx', 0o600));
    created = true;
    sourceDb = new DatabaseSync(source, { readOnly: true });
    await backup(sourceDb, target);
    sourceDb.close();
    sourceDb = null;
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
        throw Error('SQLite integrity_check failed');
      }
      if (!statSync(target).size) throw Error('Backup file is empty');
    } finally { check.close(); }
    console.log('BACKUP_OK: SQLite backup created and verified (source untouched)');
  } catch (err) {
    if (sourceDb) sourceDb.close();
    if (created) { try { unlinkSync(target); } catch {} }
    console.error('BACKUP_FAILED:', err.message);
    process.exitCode = 1;
  }
}
