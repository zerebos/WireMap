/// <reference lib="webworker" />
// Owns the SQLite database. It runs in a worker because the OPFS "SAH pool" storage it uses
// needs synchronous file handles, which browsers only hand out off the main thread. That mode
// also works without the COOP/COEP headers that static hosts like GitHub Pages can't send.
import sqlite3InitModule, {
	type BindingSpec,
	type Database,
	type SAHPoolUtil,
	type Sqlite3Static
} from '@sqlite.org/sqlite-wasm';
import type { Request, Response, Statement } from './protocol';

const FILE = '/breaker-box.sqlite3';

let sqlite3: Sqlite3Static;
let pool: SAHPoolUtil | null = null;
let db: Database;

async function open(): Promise<{ persistent: boolean }> {
	sqlite3 = await sqlite3InitModule();
	try {
		pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'breaker-box' });
	} catch (e) {
		// No OPFS (old browser, some private windows) or another tab holds the files.
		console.warn('Falling back to an in-memory database:', e);
		pool = null;
	}
	connect();
	return { persistent: pool !== null };
}

function connect() {
	db = pool ? new pool.OpfsSAHPoolDb(FILE) : new sqlite3.oo1.DB(':memory:');
	db.exec('PRAGMA foreign_keys = ON;');
}

function execute({ sql, params, method }: Statement): unknown[] {
	const rows = db.exec({
		sql,
		bind: params.length ? (params as BindingSpec) : undefined,
		rowMode: 'array',
		returnValue: 'resultRows'
	});
	// Drizzle's proxy driver wants a single row (or undefined) for `get`.
	if (method === 'get') return rows[0] as unknown[];
	return method === 'run' ? [] : rows;
}

async function handle(req: Request): Promise<unknown> {
	switch (req.type) {
		case 'open':
			return open();
		case 'query':
			return execute(req.statement);
		case 'batch': {
			// All or nothing, like a transaction.
			db.exec('BEGIN');
			try {
				const out = req.statements.map(execute);
				db.exec('COMMIT');
				return out;
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
		}
		case 'export':
			return sqlite3.capi.sqlite3_js_db_export(db);
		case 'import':
			db.close();
			if (pool) {
				try {
					await pool.importDb(FILE, req.bytes);
				} finally {
					connect();
				}
			} else {
				// In-memory fallback: copy the bytes into a fresh memory database.
				connect();
				const p = sqlite3.wasm.allocFromTypedArray(req.bytes);
				const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
				const n = req.bytes.byteLength;
				const rc = sqlite3.capi.sqlite3_deserialize(db, 'main', p, n, n, flags);
				if (rc) throw new Error(`Couldn't load that file (SQLite error ${rc}).`);
				db.exec('PRAGMA foreign_keys = ON;');
			}
			return null;
		case 'wipe':
			db.close();
			if (pool) pool.unlink(FILE);
			connect();
			return null;
	}
}

// One request at a time, in order, so an import can't interleave with queries.
let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<Request>) => {
	queue = queue.then(async () => {
		const { id } = e.data;
		let res: Response;
		try {
			res = { id, ok: true, value: await handle(e.data) };
		} catch (err) {
			res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		self.postMessage(res);
	});
};
