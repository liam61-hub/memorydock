import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.use({ breaks: true, gfm: true });

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
