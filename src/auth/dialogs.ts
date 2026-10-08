import type { Page } from 'playwright';

const expired = new WeakSet<Page>();
export function monitorAuthDialogs(page: Page): void {
  page.on('dialog', dialog => {
    if (['로그인 후 이용하실 수 있습니다.', '다른 PC 에서 로그인 되었습니다.'].includes(dialog.message())) expired.add(page);
    void dialog.dismiss();
  });
}
export const hasAuthNotice = (page: Page): boolean => expired.has(page);
// Call only after a fresh authenticated page has actually been verified.
export const confirmAuthenticated = (page: Page): void => { expired.delete(page); };
