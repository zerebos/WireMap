import { fail } from '@sveltejs/kit';

/** Small helpers for reading typed values out of form posts. */
export function reader(data: FormData) {
	const raw = (key: string) => {
		const v = data.get(key);
		return typeof v === 'string' ? v.trim() : '';
	};
	return {
		str: (key: string) => raw(key),
		optStr: (key: string) => raw(key) || null,
		int: (key: string) => {
			const n = Number.parseInt(raw(key), 10);
			return Number.isFinite(n) ? n : null;
		},
		num: (key: string) => {
			const s = raw(key);
			if (!s) return null;
			const n = Number(s);
			return Number.isFinite(n) ? n : null;
		},
		oneOf: <T extends string>(key: string, options: readonly T[], fallback: T): T => {
			const v = raw(key) as T;
			return options.includes(v) ? v : fallback;
		}
	};
}

export const invalid = (message: string) => fail(400, { error: message });
