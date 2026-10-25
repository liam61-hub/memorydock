// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { excerptNoteContent, extractFrontmatter, renderNoteContent } from '../admin/src/markdown.js';

describe('admin note rendering', () => {
  it('keeps legacy plain text and Windows paths literal', () => {
    const content = String.raw`已在 D:\WORK\FlowNote\.public-release\github-install-20261017 完成工作。
下一步查看 https://example.com/status。`;
    expect(renderNoteContent(content)).toEqual({ format: 'plain', text: content });
    expect(renderNoteContent('ordinary <img src=x onerror=alert(1)> text')).toEqual({
      format: 'plain', text: 'ordinary <img src=x onerror=alert(1)> text',
    });
  });

  it('renders explicit block and inline Markdown', () => {
    const content = '# 标题\n\n- 第一项\n- 第二项\n\n**重点**与[链接](https://example.com)';
    const rendered = renderNoteContent(content);
    expect(rendered.format).toBe('markdown');
    if (rendered.format !== 'markdown') return;
    const body = document.createElement('div');
    body.innerHTML = rendered.html;
    expect(body.querySelector('h1')?.textContent).toBe('标题');
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelector('strong')?.textContent).toBe('重点');
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(renderNoteContent('`code`').format).toBe('markdown');
    expect(renderNoteContent('A | B\n--- | ---\n1 | 2').format).toBe('markdown');
    expect(excerptNoteContent('# 标题\n\n- 第一项\n- 第二项')).toBe('标题 第一项 第二项');
  });

  it('extracts a leading YAML frontmatter block only', () => {
    expect(extractFrontmatter('---\ntitle: 笔记\n---\n\n正文')).toBe('title: 笔记');
    expect(extractFrontmatter('---\r\ntags: [a, b]\r\n---\r\n# Body')).toBe('tags: [a, b]');
    expect(extractFrontmatter('没有前言\n---\n不是前言')).toBeNull();
    expect(extractFrontmatter('')).toBeNull();
  });

  it('keeps card excerpts compact without changing source text', () => {
    const content = String.raw`D:\WORK\FlowNote\.public-release
next line`;
    expect(excerptNoteContent(content)).toBe(String.raw`D:\WORK\FlowNote\.public-release next line`);
    expect(excerptNoteContent('abcdef', 4)).toBe('abcd…');
  });

  it('removes unsafe HTML and URL schemes from Markdown', () => {
    const rendered = renderNoteContent('# Safe\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))');
    expect(rendered.format).toBe('markdown');
    if (rendered.format !== 'markdown') return;
    const body = document.createElement('div');
    body.innerHTML = rendered.html;
    expect(body.querySelector('[onerror]')).toBeNull();
    expect(body.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
