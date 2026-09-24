// Applies the SQL migrations in /drizzle, bundled into the app. It keeps the same
// __drizzle_migrations bookkeeping as Drizzle's own migrator, so a backup file can also be
// opened by drizzle-kit or a server build of the app.
import { sql } from 'drizzle-orm';
import journal from '../../../drizzle/meta/_journal.json';
import type { DB } from './index';

const files = import.meta.glob<string>('/drizzle/*.sql', { query: '?raw', import: 'default', eager: true });

const migrations = journal.entries.map((entry) => {
	const text = files[`/drizzle/${entry.tag}.sql`];
	if (text === undefined) throw new Error(`Missing migration ${entry.tag}`);
	return {
		text,
		when: entry.when,
		statements: text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
	};
});

async function sha256(text: string) {
	// Only for Drizzle's records; crypto.subtle is missing on plain-http pages.
	if (!crypto.subtle) return '';
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Runs any migrations the database hasn't had yet. `fresh` means it had none at all. */
export async function migrate(db: DB): Promise<{ fresh: boolean }> {
	const [[tables]] = await db.values<[number]>(
		sql`select count(*) from sqlite_master where type = 'table' and name = '__drizzle_migrations'`
	);
	const fresh = !tables;
	await db.run(sql`create table if not exists __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
	const [last] = await db.values<[number]>(
		sql`select created_at from __drizzle_migrations order by created_at desc limit 1`
	);
	const lastWhen = last ? Number(last[0]) : -Infinity;

	const queries = [];
	for (const m of migrations.filter((m) => m.when > lastWhen)) {
		for (const s of m.statements) queries.push(db.run(sql.raw(s)));
		queries.push(
			db.run(sql`insert into __drizzle_migrations (hash, created_at) values (${await sha256(m.text)}, ${m.when})`)
		);
	}
	// A batch runs as one transaction: a failed migration leaves the database as it was.
	if (queries.length) await db.batch(queries as [(typeof queries)[number], ...typeof queries]);
	return { fresh };
}
