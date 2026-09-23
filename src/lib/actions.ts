import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';

export type ActionOutcome = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string };

/**
 * Calls a form action on the current page from script (for drag-and-drop and other edits that
 * aren't a plain form), then refreshes the page data.
 */
export async function callAction(
	name: string,
	values: Record<string, string | number | null | undefined>
): Promise<ActionOutcome> {
	const body = new FormData();
	for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) body.set(k, String(v));
	let result;
	try {
		const res = await fetch(`?/${name}`, {
			method: 'POST',
			body,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		result = deserialize(await res.text());
	} catch {
		return { ok: false, error: "Couldn't reach the server." };
	}
	if (result.type === 'failure') {
		return { ok: false, error: String(result.data?.error ?? 'Something went wrong.') };
	}
	if (result.type === 'error') return { ok: false, error: 'Something went wrong.' };
	await invalidateAll();
	return { ok: true, data: result.type === 'success' ? result.data : undefined };
}
