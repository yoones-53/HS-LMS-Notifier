export function isTrustedSender(actualId: number, expectedId: number, isMainFrame: boolean, url: string, expectedUrl: string): boolean {
  return actualId === expectedId && isMainFrame && url.split('#')[0] === expectedUrl;
}
