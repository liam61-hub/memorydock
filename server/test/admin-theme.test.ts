// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, readTheme, saveTheme } from '../admin/src/theme.js';

describe('admin theme', () => {
  it('defaults to light and accepts only a saved dark choice', () => {
    expect(readTheme({ getItem: () => null })).toBe('light');
    expect(readTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readTheme({ getItem: () => 'invalid' })).toBe('light');
    expect(readTheme({ getItem: () => { throw new Error('blocked'); } })).toBe('light');
  });

  it('persists the choice and updates the document and browser color', () => {
    let saved = '';
    saveTheme('dark', { setItem: (key, value) => { expect(key).toBe('memorydock.admin.theme'); saved = value; } });
    expect(saved).toBe('dark');
    const doc = document.implementation.createHTMLDocument();
    const meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.append(meta);
    applyTheme('dark', doc);
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(meta.content).toBe('#111b20');
    applyTheme('light', doc);
    expect(meta.content).toBe('#f7f8f6');
  });
});
