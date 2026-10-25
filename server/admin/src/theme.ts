export type Theme = 'light' | 'dark';

const storageKey = 'memorydock.admin.theme';
const themeColors: Record<Theme, string> = { light: '#f7f8f6', dark: '#111b20' };

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

export function readTheme(storage: Pick<Storage, 'getItem'> | null = browserStorage()): Theme {
  try { return storage?.getItem(storageKey) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  try { storage?.setItem(storageKey, theme); }
  catch { /* The current page still uses the selected theme. */ }
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
}
