import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROFILE_DIR = join(PROJECT_ROOT, 'browser-data', 'hs-lms');
export const LMS_URL = 'https://lms.hs.ac.kr';

// Observed with Playwright MCP on 2026-10-06; do not invent LMS routes/selectors.
export const MY_LECTURES_URL =
  'https://lms.hs.ac.kr/lms/myLecture/doListView.dunet?mnid=201008840728';
export const LOGOUT_SELECTOR = 'a[href="javascript:lmsLogout();"]';
