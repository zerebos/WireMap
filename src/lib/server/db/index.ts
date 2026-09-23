import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const url = env.DATABASE_URL || 'data/breaker-box.db';
mkdirSync(dirname(url), { recursive: true });

const client = new Database(url, { create: true });
client.exec('PRAGMA journal_mode = WAL;');
client.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(client, { schema });

migrate(db, { migrationsFolder: env.MIGRATIONS_DIR || 'drizzle' });
