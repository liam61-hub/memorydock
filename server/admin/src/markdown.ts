import DOMPurify from 'dompurify';
import { marked } from 'marked';
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
 * configured with `flowchart.htmlLabels: false` so diagrams carry only
 * plain SVG text labels — no HTML inside SVG ever reaches the DOM.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg);
}
