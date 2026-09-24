import { invalidateAll } from '$app/navigation';
import { runAction } from './enhance';

export type ActionOutcome = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string };

/**
 * Calls one of the current page's actions from script (for drag-and-drop and other edits that
 * aren't a plain form), then refreshes the page data.
 */
export async function callAction(
	name: string,
	values: Record<string, string | number | null | undefined>
): Promise<ActionOutcome> {
	const body = new FormData();
	for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) body.set(k, String(v));
	const result = await runAction(name, body);
	if (result.type === 'failure') {
		return { ok: false, error: String(result.data?.error ?? 'Something went wrong.') };
	}
	if (result.type !== 'success') return { ok: false, error: 'Something went wrong.' };
	await invalidateAll();
	return { ok: true, data: result.data };
}
