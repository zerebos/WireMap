// Form actions without a server. Each route can have an `actions.ts` next to its page that
// exports `actions`, written like SvelteKit form actions (return `fail(...)`, throw
// `redirect(...)`), and this module runs them in the browser. `enhance` is a drop-in for the
// one from $app/forms, so pages keep using <form method="POST" action="?/name" use:enhance>.
import { applyAction } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';
import { isActionFailure, isRedirect, type ActionResult, type SubmitFunction } from '@sveltejs/kit';

export type LocalActionEvent = { data: FormData; params: Record<string, string>; url: URL };
export type LocalAction = (event: LocalActionEvent) => unknown;

const modules = import.meta.glob<{ actions: Record<string, LocalAction> }>('/src/routes/**/actions.ts');
const byRoute = new Map(
	Object.entries(modules).map(([path, load]) => [
		path.slice('/src/routes'.length, -'/actions.ts'.length) || '/',
		load
	])
);

/** The action named in a form's action URL, e.g. "?b=1&/updateDevice" names updateDevice. */
function actionName(url: URL) {
	const key = [...url.searchParams.keys()].find((k) => k.startsWith('/'));
	return key ? key.slice(1) : 'default';
}

/** Runs one of the current page's actions and reports the outcome the way SvelteKit would. */
export async function runAction(name: string, data: FormData): Promise<ActionResult> {
	const load = byRoute.get(page.route.id ?? '');
	const action = load && (await load()).actions[name];
	if (!action) return { type: 'error', error: new Error(`No action "${name}" on this page`) };
	try {
		const out = await action({ data, params: page.params as Record<string, string>, url: page.url });
		if (isActionFailure(out)) {
			return { type: 'failure', status: out.status, data: out.data as unknown as Record<string, unknown> };
		}
		return { type: 'success', status: 200, data: (out ?? undefined) as Record<string, unknown> | undefined };
	} catch (e) {
		if (isRedirect(e)) return { type: 'redirect', status: e.status, location: e.location };
		console.error(e);
		return { type: 'error', error: e };
	}
}

export function enhance(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
		const action = new URL(submitter?.hasAttribute('formaction') ? submitter.formAction : form.action);
		const formData = new FormData(form, submitter);
		const controller = new AbortController();
		let cancelled = false;
		const callback =
			(await submit({
				action,
				formData,
				formElement: form,
				controller,
				submitter,
				cancel: () => (cancelled = true)
			})) ?? undefined;
		if (cancelled) return;

		const result = await runAction(actionName(action), formData);

		// Same steps as SvelteKit's default: reset and refresh on success, then apply.
		const update = async ({ reset = true, invalidateAll: refresh = true } = {}) => {
			if (result.type === 'success') {
				if (reset) form.reset();
				if (refresh) await invalidateAll();
			}
			await applyAction(result);
		};
		if (callback) await callback({ action, formData, formElement: form, update, result, controller } as never);
		else await update();
	}
	form.addEventListener('submit', onsubmit);
	return { destroy: () => form.removeEventListener('submit', onsubmit) };
}

