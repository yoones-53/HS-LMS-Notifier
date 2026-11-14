import { LmsStore } from '../src/database/store.js';
import { discordTransport } from '../src/notification/discord.js';
import { notifyChanges } from '../src/notification/changes.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
import { resolveRuntimePaths } from '../src/runtime/paths.js';
import { loadDiscordSecret } from '../src/auth/credentials.js';
await runCli(async () => {
  loadEnvironment();
  const transport = discordTransport(await loadDiscordSecret(process.env.DISCORD_WEBHOOK_URL));
  const store = new LmsStore(resolveRuntimePaths().database);
  try {
    const result = await notifyChanges(store, transport);
    console.log(`변경 알림: 전송=${result.sent}, 보류=${result.deferred}, 확인불가=${result.uncertain}`);
    if (result.deferred || result.uncertain) throw new UserFacingError('DISCORD_DELIVERY_PENDING: 전송하지 못했거나 확인이 필요한 알림이 있습니다.');
  } finally { store.close(); }
});
