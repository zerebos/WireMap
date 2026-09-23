import { error } from '@sveltejs/kit';
import { planFile } from '$lib/server/plans';

export const GET = async ({ params }) => {
	const plan = planFile(params.file);
	if (!plan || !(await plan.file.exists())) error(404, 'Not found');
	// File names change on every upload, so they can be cached for good.
	return new Response(plan.file, {
		headers: {
			'content-type': plan.type,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
