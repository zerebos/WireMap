import { redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { panels } from '$lib/server/db/schema';

export const load = () => {
	const first = db.select({ id: panels.id }).from(panels).orderBy(asc(panels.id)).limit(1).get();
	redirect(307, first ? `/panels/${first.id}` : '/panels/new');
};
