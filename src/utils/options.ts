import { UserFacingError } from './cli.js';
export function readHeadless(value = process.env.HEADLESS): boolean {
  if (value === undefined || value === '' || value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new UserFacingError('HEADLESS 설정은 true 또는 false여야 합니다.');
}
