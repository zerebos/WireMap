// Messages between the app and the database worker.

export type Method = 'run' | 'all' | 'values' | 'get';
export type Statement = { sql: string; params: unknown[]; method: Method };

export type Request = { id: number } & (
	| { type: 'open' }
	| { type: 'query'; statement: Statement }
	| { type: 'batch'; statements: Statement[] }
	| { type: 'export' }
	| { type: 'import'; bytes: Uint8Array }
	| { type: 'wipe' }
);

export type Response = { id: number } & ({ ok: true; value: unknown } | { ok: false; error: string });
