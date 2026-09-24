import { redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { db } from '$lib/db';
import { panels } from '$lib/db/schema';

export const load = async () => {
	const first = await db.select({ id: panels.id }).from(panels).orderBy(asc(panels.id)).limit(1).get();
	redirect(307, first ? resolve('/panels/[id]', { id: String(first.id) }) : resolve('/panels/new'));
};
