import { runLogin } from '../src/auth/login.js';
import { runCli } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
await runCli(async () => { loadEnvironment(); await runLogin(true); });
