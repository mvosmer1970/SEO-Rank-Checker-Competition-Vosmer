// The color theme, chosen with the switcher at the top right and remembered in the browser storage of the app.
// "system" follows the light/dark setting of Windows (styles.css: no data-theme on <html>). The window title bar
// (drawn by the app, with the buttons of Windows over it) gets the colors of the theme.
import { api } from './api';

export type Theme = 'system' | 'light' | 'dark' | 'streo';

export const THEMES: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['streo', 'Streo (dark orange)'],
];

const KEY = 'theme';

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return THEMES.some(([t]) => t === value) ? (value as Theme) : 'system';
  } catch {
    return 'system';
  }
}

/** Gives the buttons of Windows in the title bar the colors of the title bar of the theme. */
function syncTitleBar(): void {
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue('--titlebar-bg').trim();
  const symbolColor = style.getPropertyValue('--titlebar-text').trim();
  if (color && symbolColor) api.setTitleBarColors(color, symbolColor).catch(() => undefined);
}

let watchingSystem = false;

export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  syncTitleBar();
  // With "system", a change of the Windows setting changes the colors too.
  if (!watchingSystem) {
    watchingSystem = true;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTitleBar);
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered without storage.
  }
}
