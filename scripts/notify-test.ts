import { LmsStore } from '../src/database/store.js';
import { discordTransport } from '../src/notification/discord.js';
import { sendOnce } from '../src/notification/delivery.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
import { resolveRuntimePaths } from '../src/runtime/paths.js';
import { loadDiscordSecret } from '../src/auth/credentials.js';
await runCli(async () => {
  loadEnvironment();
  const transport = discordTransport(await loadDiscordSecret(process.env.DISCORD_WEBHOOK_URL));
  const store = new LmsStore(resolveRuntimePaths().database);
  try {
    const status = await sendOnce(store, 'system:webhook-test:v1', {
      allowed_mentions: { parse: [] }, embeds: [{ title: '✅ HS-LMS-Notifier 연결 테스트',
        description: 'Discord 알림 연결을 확인하는 테스트입니다. 기존 공지·과제를 일괄 전송하지 않습니다.' }],
    }, transport);
    console.log(`Discord 테스트: ${status}`);
    if (status !== 'SENT' && status !== 'SKIPPED') throw new UserFacingError('DISCORD_TEST_UNCONFIRMED: 전송 결과를 확인하지 못했습니다. 중복 방지를 위해 불명확한 전송은 자동 재전송하지 않습니다.');
  } finally { store.close(); }
});
