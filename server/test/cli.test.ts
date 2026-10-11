import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli.js';

describe('parseCliArgs', () => {
  it('parses the serve command', () => {
    expect(parseCliArgs(['serve'])).toEqual({ command: 'serve', flags: [], options: {} });
  });

  it('parses the reembed command with flags', () => {
    expect(parseCliArgs(['reembed', '--yes', '--backup'])).toEqual({
      command: 'reembed',
      flags: ['--yes', '--backup'],
      options: {},
    });
  });

  it('treats --version and -v as the version command', () => {
    expect(parseCliArgs(['--version']).command).toBe('version');
    expect(parseCliArgs(['-v']).command).toBe('version');
  });

  it('falls back to help for unknown commands', () => {
    expect(parseCliArgs(['frobnicate']).command).toBe('help');
    expect(parseCliArgs([]).command).toBe('help');
  });

  it('parses the migrate-storage command', () => {
    expect(parseCliArgs(['migrate-storage'])).toEqual({
      command: 'migrate-storage',
      flags: [],
      options: {},
    });
  });

  it('extracts --from as a named option', () => {
    expect(parseCliArgs(['migrate-storage', '--from', 'D:\\legacy\\index', '--yes'])).toEqual({
      command: 'migrate-storage',
      flags: ['--from', '--yes'],
      options: { from: 'D:\\legacy\\index' },
    });
  });

  it('ignores --from at the end without a value', () => {
    expect(parseCliArgs(['migrate-storage', '--yes', '--from'])).toEqual({
      command: 'migrate-storage',
      flags: ['--yes', '--from'],
      options: {},
    });
  });

  it('ignores --from when the next token is another flag', () => {
    expect(parseCliArgs(['migrate-storage', '--from', '--yes'])).toEqual({
      command: 'migrate-storage',
      flags: ['--from', '--yes'],
      options: {},
    });
  });
});
