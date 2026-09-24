// The app's database: SQLite running in the browser (see worker.ts), queried through Drizzle.
// Nothing here runs until the first query, so importing this module is safe during the build.
import { drizzle, type AsyncBatchRemoteCallback, type AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { migrate } from './migrate';
import { seed } from './seed';
import type { Request, Response, Statement } from './protocol';

type Payload = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function call<T>(req: Payload): Promise<T> {
	if (!worker) {
		worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<Response>) => {
			const p = pending.get(e.data.id);
			pending.delete(e.data.id);
			if (e.data.ok) p?.resolve(e.data.value);
			else p?.reject(new Error(e.data.error));
		};
	}
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		worker!.postMessage({ ...req, id });
	});
}

const query: AsyncRemoteCallback = async (sql, params, method) => ({
	rows: await call<unknown[]>({ type: 'query', statement: { sql, params, method } })
});
const batch: AsyncBatchRemoteCallback = async (statements) =>
	(await call<unknown[][]>({ type: 'batch', statements: statements as Statement[] })).map((rows) => ({ rows }));

/** Used while starting up, before `ready()` resolves. */
const raw = drizzle(query, batch, { schema });
export type DB = typeof raw;

/** Thrown when another tab already has the database open. */
export class OtherTabError extends Error {
	constructor() {
		super('Breakerbook is already open in another tab. Close it there to use it here.');
	}
}

export type DbStatus = {
	/** False when the browser can't store data, so changes last only until the tab closes. */
	persistent: boolean;
};

const LOCK = 'breaker-box-db';

/** Holds a lock for as long as this tab is open, since only one tab can use the files at a time. */
function lockThisTab(): Promise<boolean> {
	if (!navigator.locks) return Promise.resolve(true);
	return new Promise((resolve) => {
		navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
			resolve(lock !== null);
			return lock ? new Promise(() => {}) : undefined;
		});
	});
}

let starting: Promise<DbStatus> | null = null;

/** Opens the database once: migrations run, and a brand-new database gets the example house. */
export function ready(): Promise<DbStatus> {
	starting ??= (async () => {
		if (!(await lockThisTab())) throw new OtherTabError();
		const status = await call<DbStatus>({ type: 'open' });
		const { fresh } = await migrate(raw);
		if (fresh) await seed(raw);
		return status;
	})();
	// Let a later call try again (e.g. after the other tab closes).
	starting.catch(() => (starting = null));
	return starting;
}

export const db = drizzle(
	async (sql, params, method) => (await ready(), query(sql, params, method)),
	async (statements) => (await ready(), batch(statements)),
	{ schema }
);

// ---- Backups

const SQLITE_HEADER = 'SQLite format 3\0';

/** The whole database (data and floor plan images) as a standard SQLite file. */
export async function exportDatabase(): Promise<Uint8Array> {
	await ready();
	return call<Uint8Array>({ type: 'export' });
}

/** Replaces everything with a backup file. If the file isn't a usable backup, nothing changes. */
export async function importDatabase(bytes: Uint8Array): Promise<void> {
	await ready();
	if (new TextDecoder().decode(bytes.subarray(0, 16)) !== SQLITE_HEADER) {
		throw new Error("That file isn't a Breakerbook backup.");
	}
	const previous = await call<Uint8Array>({ type: 'export' });
	try {
		await call({ type: 'import', bytes });
		// Older backups are brought up to date. Any other SQLite file is turned away.
		const { fresh } = await migrate(raw);
		if (fresh) throw new Error('Not one of ours');
		await raw.run(sql`select id from panels limit 1`);
	} catch {
		await call({ type: 'import', bytes: previous });
		throw new Error("That file isn't a Breakerbook backup.");
	}
}

/** Deletes everything. With `example`, the example house is added back. */
export async function resetDatabase({ example }: { example: boolean }): Promise<void> {
	await ready();
	await call({ type: 'wipe' });
	await migrate(raw);
	if (example) await seed(raw);
}
