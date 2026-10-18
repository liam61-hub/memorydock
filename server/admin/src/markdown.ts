import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Token } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';

// Register a curated set of common languages to keep the admin bundle small.
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

const languages: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['python', python],
  ['java', java],
  ['go', go],
  ['rust', rust],
  ['sql', sql],
  ['bash', bash],
  ['json', json],
  ['yaml', yaml],
  ['xml', xml],
  ['css', css],
  ['markdown', markdown],
  ['diff', diff],
  ['plaintext', plaintext],
];
for (const [name, grammar] of languages) hljs.registerLanguage(name, grammar);

marked.use({ breaks: true, gfm: true });
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);

/**
 * Convert user-authored Markdown to safe HTML for the local console.
 * Memory content can originate from agents, so raw HTML must never reach the
 * DOM without sanitisation.
 */
export function renderMarkdown(markdown: string): string {
  const parsed = marked.parse(markdown || '', { async: false });
  return DOMPurify.sanitize(parsed, {
    USE_PROFILES: { html: true },
  });
}

/**
 * Sanitise a mermaid-rendered SVG before insertion. Uses the default
 * DOMPurify configuration (HTML + SVG allowlists) instead of the HTML-only
 * profile, which would strip the whole `<svg>` element. Mermaid is
 * configured with the root-level `htmlLabels: false` (v12) so diagrams carry
 * only plain SVG text labels — no HTML inside SVG ever reaches the DOM.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg);
}

export type RenderedNoteContent =
  | { format: 'plain'; text: string }
  | { format: 'markdown'; html: string };

/** Only explicit Markdown syntax switches a note away from literal text. */
function hasMarkdownSyntax(tokens: Token[]): boolean {
  for (const token of tokens) {
    switch (token.type) {
      case 'paragraph':
      case 'text':
        if (token.tokens && hasMarkdownSyntax(token.tokens)) return true;
        break;
      case 'link':
        // GFM turns bare URLs into links; that alone should not reinterpret a
        // plain note or its Windows paths as Markdown.
        if (!token.autolink) return true;
        break;
      case 'heading':
      case 'list':
      case 'blockquote':
      case 'code':
      case 'hr':
      case 'table':
      case 'def':
      case 'strong':
      case 'em':
      case 'codespan':
      case 'del':
      case 'image':
        return true;
      default:
        // Whitespace, line breaks, backslash escapes, and raw HTML do not
        // declare a note to be Markdown. React renders plain text safely.
        break;
    }
  }
  return false;
}

export function renderNoteContent(content: string): RenderedNoteContent {
  if (!hasMarkdownSyntax(marked.lexer(content))) return { format: 'plain', text: content };
  return { format: 'markdown', html: renderMarkdown(content) };
}

/** Plain, compact text for cards; never insert a note's HTML into the card. */
export function excerptNoteContent(content: string, limit = 150): string {
  const rendered = renderNoteContent(content);
  let text = rendered.format === 'plain' ? rendered.text : '';
  if (rendered.format === 'markdown') {
    const container = document.createElement('div');
    container.innerHTML = rendered.html;
    container.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr').forEach(element => element.append(' '));
    text = container.textContent || '';
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit).trimEnd()}…` : compact;
}
