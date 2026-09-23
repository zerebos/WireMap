import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

// Floor plan images are stored as files under <data dir>/plans and served by /plans/[file].
export const plansDir = join(dataDir, 'plans');
mkdirSync(plansDir, { recursive: true });

export const PLAN_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

const CONTENT_TYPES = Object.fromEntries(Object.entries(PLAN_TYPES).map(([type, ext]) => [ext, type]));

/** Only names we generated are served or deleted. */
const NAME = /^floor-\d+-\d+\.(png|jpg|webp|gif)$/;

export async function savePlan(floorId: number, file: File): Promise<string> {
	const name = `floor-${floorId}-${Date.now()}.${PLAN_TYPES[file.type]}`;
	await Bun.write(join(plansDir, name), file);
	return name;
}

export function deletePlan(name: string | null) {
	if (name && NAME.test(name)) rmSync(join(plansDir, name), { force: true });
}

export function planFile(name: string) {
	if (!NAME.test(name)) return null;
	const file = Bun.file(join(plansDir, name));
	return { file, type: CONTENT_TYPES[name.split('.').pop()!] };
}
