import { ensureDatabase } from '../src/db/migrate.js';
import { resetDatabase } from '../src/db/reset.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/buildline_test';

export default async function setup() {
  await ensureDatabase(TEST_DATABASE_URL);
  await resetDatabase(TEST_DATABASE_URL);
}
