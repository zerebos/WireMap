import type { SubmitFunction } from '@sveltejs/kit';

/** `use:enhance` callback for edit forms: refresh data but keep what's typed in the form. */
export const keepValues: SubmitFunction = () => async ({ update }) => update({ reset: false });
