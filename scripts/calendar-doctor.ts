import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CALENDAR_TARGET, credentialsConfigured } from '../src/auth/credentials.js';
import { CalendarError, verifySavedGoogleCalendar } from '../src/calendar/auth.js';
import { loadSettings } from '../src/runtime/settings.js';
import { resolveRuntimePaths } from '../src/runtime/paths.js';
import { readJson } from '../src/runtime/json.js';
import { PROJECT_ROOT } from '../src/utils/config.js';

// Read-only audit: never create events or print account identifiers, credentials, tokens or API responses.
const readiness=join(PROJECT_ROOT,'dist/gui/login-readiness.json');
const release=existsSync(readiness)?readJson(readiness,z.object({version:z.literal(1),googleLoginConfigured:z.boolean()}).strict()):null;
const settings=loadSettings(resolveRuntimePaths());
const credentialPresent=await credentialsConfigured(CALENDAR_TARGET);
let verification:'PASSED'|'NOT_CONFIGURED'|'FAILED'='NOT_CONFIGURED';
let reason='NO_SAVED_GOOGLE_LOGIN';
if(credentialPresent){
  try{await verifySavedGoogleCalendar();verification='PASSED';reason='PRIMARY_CALENDAR_ACCESS_VERIFIED';}
  catch(error){verification='FAILED';reason=error instanceof CalendarError?error.message:'CALENDAR_CHECK_FAILED';}
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),appGoogleLoginConfigured:release?.googleLoginConfigured??false,
  savedGoogleLogin:credentialPresent,linkedInApp:!!settings.googleCalendar.connectedAt,calendarEnabled:settings.googleCalendar.enabled,verification,reason},null,2));
