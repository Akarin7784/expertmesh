export function isAppUrl(raw: string, origin: string) {
  try {
    const url = new URL(raw);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function externalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    // Ignore malformed links and system protocols.
  }
}
