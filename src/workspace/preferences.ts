import type { ViewMode } from '../domain/rton-codec';

export type ThemePreference = 'system' | 'light' | 'dark';
export type PreviewPreference = ViewMode | 'rton';

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const THEME_PREFERENCE_KEY = 'rton-editor-legacy-theme-preference';
const LINE_WRAPPING_PREFERENCE_KEY = 'rton-editor-legacy-line-wrapping';
const PREVIEW_PREFERENCE_KEY = 'rton-editor-legacy-preview-preference';

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(value: ThemePreference) {
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, value);
  } catch {
    // Ignore unavailable localStorage in restricted browsing contexts.
  }
}

export function readLineWrappingPreference() {
  try {
    return localStorage.getItem(LINE_WRAPPING_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveLineWrappingPreference(value: boolean) {
  try {
    localStorage.setItem(LINE_WRAPPING_PREFERENCE_KEY, String(value));
  } catch {
    // Ignore unavailable localStorage in restricted browsing contexts.
  }
}

export function readPreviewPreference(): PreviewPreference {
  try {
    const value = localStorage.getItem(PREVIEW_PREFERENCE_KEY);
    return isPreviewPreference(value) ? value : 'rton';
  } catch {
    return 'rton';
  }
}

export function savePreviewPreference(value: PreviewPreference) {
  try {
    localStorage.setItem(PREVIEW_PREFERENCE_KEY, value);
  } catch {
    // Ignore unavailable localStorage in restricted browsing contexts.
  }
}

export function previewPreferenceTextMode(value: PreviewPreference): ViewMode {
  return value === 'rton' ? 'json' : value;
}

export function applyThemePreference(value: ThemePreference) {
  const resolved = value === 'system' ? (window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = value;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isPreviewPreference(value: unknown): value is PreviewPreference {
  return value === 'rton' || value === 'json' || value === 'yaml' || value === 'toml';
}
