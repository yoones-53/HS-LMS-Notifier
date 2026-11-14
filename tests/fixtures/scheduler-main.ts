// Copied into a disposable installation by scheduler.test.ts. No LMS, .env,
// credentials, SQLite user data or Discord; only exercises the real PS wrapper.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('logs');
mkdirSync(directory, { recursive: true });
const result = {
  status: 'SUCCESS', code: 'SUCCESS', title: 'Synthetic check', reason: 'Synthetic only',
  action: 'None', recoverable: true, exitCode: 0, occurredAt: new Date().toISOString(),
  errors: [], warnings: [], affectedScopes: [], collectionStatus: 'SUCCESS',
  databaseStatus: 'SUCCESS', notificationStatus: 'SUCCESS',
};
if (process.env.HEADLESS !== 'true' || process.argv[2] !== '--check') process.exitCode = 1;
else writeFileSync(resolve(directory, 'latest-scheduler-run.json'), JSON.stringify({ invocationId: process.env.HS_LMS_RUN_TOKEN, result }));
