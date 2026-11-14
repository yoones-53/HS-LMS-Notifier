import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { closeProfile, openProfile } from '../src/browser/profile.js';
import { PROFILE_DIR, PROJECT_ROOT } from '../src/utils/config.js';

test('dedicated profile persists session cookies across a Chromium restart', { timeout: 60_000 }, async () => {
  const temporaryRoot = join(PROJECT_ROOT, 'work', 'profile-tests');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'profile-'));
  assert.notEqual(directory, PROFILE_DIR);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/start') {
      response.setHeader('Set-Cookie', 'test_session=synthetic-only; HttpOnly; SameSite=Lax; Path=/');
      response.end('<p>Test session initialized</p>');
    } else {
      const recognized = request.headers.cookie?.includes('test_session=synthetic-only');
      response.end(recognized ? '<p>session-present</p>' : '<p>session-absent</p>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  let context: Awaited<ReturnType<typeof openProfile>> | undefined;
  try {
    context = await openProfile(directory, true);
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${base}/start`);
    await closeProfile(context);
    context = undefined;

    const preferences = JSON.parse(await readFile(join(directory, 'Default', 'Preferences'), 'utf8'));
    assert.equal(preferences.credentials_enable_service, false);
    assert.equal(preferences.credentials_enable_autosignin, false);

    context = await openProfile(directory, true);
    const reopened = context.pages()[0] ?? await context.newPage();
    await reopened.goto(`${base}/check`);
    assert.equal(await reopened.locator('p').textContent(), 'session-present');
  } finally {
    if (context) await closeProfile(context);
    // Chromium can leave an idle/preconnected socket after shutdown on Windows.
    // This server belongs only to this synthetic test; never wait indefinitely for it.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // Only remove the temporary test directory created above, never the LMS profile.
    assert.ok(resolve(directory).startsWith(resolve(temporaryRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
