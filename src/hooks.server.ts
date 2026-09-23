import { env } from '$env/dynamic/private';
import { seedIfEmpty } from '$lib/server/seed';

// Importing the seed module opens the database and runs migrations.
if (env.SEED_DEMO !== 'false') seedIfEmpty();
