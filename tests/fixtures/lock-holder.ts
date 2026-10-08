import { acquireRunLock } from '../../src/utils/run-lock.js';
const release = acquireRunLock(process.argv[2]!);
if (!release) process.exit(3);
process.send?.('locked');
setInterval(() => {}, 1_000);
