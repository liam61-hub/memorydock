// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { renderMarkdown, sanitizeMermaidSvg } from '../admin/src/markdown';

describe('renderMarkdown', () => {
  test('renders fenced code with highlight token spans for a known language', () => {
    const html = renderMarkdown('```js\nconst answer = 42;\n```');

    expect(html).toContain('class="hljs language-js"');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  test('leaves unknown languages unhighlighted', () => {
    const html = renderMarkdown('```brainfuck\n++++[>++<-]\n```');

    expect(html).toContain('class="hljs language-brainfuck"');
    expect(html).not.toContain('hljs-keyword');
  });

  test('preserves table column alignment attributes', () => {
    const html = renderMarkdown('| Feature | Notes |\n|:--------|------:|\n| GFM | right |');

    expect(html).toContain('align="left"');
    expect(html).toContain('align="right"');
  });

  test('emits mermaid fences as language-mermaid code blocks', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');

    expect(html).toContain('language-mermaid');
    expect(html).toContain('A--&gt;B');
  });

  test('renders GFM task list checkboxes with checked state', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});

describe('sanitizeMermaidSvg', () => {
  test('keeps svg structure and text labels', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g class="node"><rect width="50"/><text x="10" y="10">User</text></g></svg>';

    const html = sanitizeMermaidSvg(svg);

    expect(html).toContain('<svg');
    expect(html).toContain('class="node"');
    expect(html).toContain('>User<');
  });

  test('strips HTML embedded inside SVG', () => {
    const svg = '<svg viewBox="0 0 10 10"><foreignObject><div>User</div></foreignObject></svg>';

    expect(sanitizeMermaidSvg(svg)).not.toContain('foreignObject');
  });
});
