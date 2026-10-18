import { describe, expect, it } from 'vitest';
import { formatDate, readLanguage, saveLanguage, translate } from '../admin/src/i18n.js';

describe('admin language', () => {
  it('defaults to English and reads only a saved Chinese choice', () => {
    const storage = { getItem: () => null };
    expect(readLanguage(storage)).toBe('en');
    expect(readLanguage({ getItem: () => 'zh' })).toBe('zh');
    expect(readLanguage({ getItem: () => 'fr' })).toBe('en');
    expect(readLanguage({ getItem: () => { throw new Error('blocked'); } })).toBe('en');
  });

  it('saves the choice and translates navigation, actions, and dates', () => {
    let saved = '';
    saveLanguage('zh', { setItem: (_key, value) => { saved = value; } });
    expect(saved).toBe('zh');
    expect(translate('en', '审核收件箱')).toBe('Review inbox');
    expect(translate('zh', '审核收件箱')).toBe('审核收件箱');
    expect(translate('en', '已归档')).toBe('Archived');
    expect(formatDate('2026-10-17T15:43:00.000Z', 'en')).not.toBe(formatDate('2026-10-17T15:43:00.000Z', 'zh'));
  });
});
