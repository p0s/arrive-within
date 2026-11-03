type BrowserConnection = { version(): string; close(): Promise<void> };

export function connectVerifiedBrowser<T extends BrowserConnection>(chromium: {
  connectOverCDP(endpoint: string, options: { timeout: number }): Promise<T>;
}): Promise<T>;
