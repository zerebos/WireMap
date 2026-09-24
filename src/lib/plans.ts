import { eq } from 'drizzle-orm';
import { db } from './db';
import { planImages } from './db/schema';

// Floor plan images are stored in the database (plan_images) and shown through object URLs.

export const PLAN_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export async function savePlan(floorId: number, file: File): Promise<string> {
	const name = `floor-${floorId}-${Date.now()}.${PLAN_TYPES[file.type]}`;
	const data = new Uint8Array(await file.arrayBuffer());
	await db.insert(planImages).values({ name, type: file.type, data });
	return name;
}

export async function deletePlan(name: string | null) {
	if (!name) return;
	await db.delete(planImages).where(eq(planImages.name, name));
	const url = await urls.get(name);
	urls.delete(name);
	if (url) URL.revokeObjectURL(url);
}

// A name always refers to the same image, so its URL is made once and reused.
const urls = new Map<string, Promise<string | null>>();

/** A URL the page can show the image at, or null if it's missing. */
export function planUrl(name: string): Promise<string | null> {
	let url = urls.get(name);
	if (!url) {
		url = db
			.select({ type: planImages.type, data: planImages.data })
			.from(planImages)
			.where(eq(planImages.name, name))
			.get()
			.then((row) => (row ? URL.createObjectURL(new Blob([row.data as BlobPart], { type: row.type })) : null));
		urls.set(name, url);
	}
	return url;
}
