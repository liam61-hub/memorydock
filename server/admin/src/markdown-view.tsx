import { useEffect, useRef } from 'react';
import { sanitizeMermaidSvg } from './markdown';
import type { Theme } from './theme';

type MermaidModule = typeof import('mermaid');

let mermaidModule: MermaidModule | null = null;
let diagramCounter = 0;
let renderQueue: Promise<void> = Promise.resolve();

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid');
  }
  return mermaidModule;
}

/**
 * Replace ```mermaid fenced blocks inside a rendered container with
 * sanitised SVG diagrams. Mermaid is lazy-loaded and only when at least one
 * mermaid block exists; render failures keep the original code block.
 */
async function renderMermaidBlocks(root: HTMLElement, cancelled: () => boolean, theme: Theme): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  if (blocks.length === 0) return;
  try {
    const { default: mermaid } = await loadMermaid();
    if (cancelled()) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', htmlLabels: false });
    for (const code of blocks) {
      if (cancelled()) return;
      const pre = code.closest('pre');
      if (!pre || !pre.parentNode) continue;
      try {
        const { svg } = await mermaid.render(`memorydock-mmd-${++diagramCounter}`, code.textContent || '');
        const sanitized = sanitizeMermaidSvg(svg);
        if (!sanitized.trim()) throw new Error('sanitisation removed the whole diagram');
        const container = document.createElement('div');
        container.className = 'mermaid-diagram';
        container.innerHTML = sanitized;
        pre.replaceWith(container);
      } catch (reason) {
        console.warn('Mermaid render failed, keeping the original code block.', reason);
      }
    }
  } catch (reason) {
    console.warn('Mermaid module failed to load, keeping the original code block.', reason);
  }
}

type MarkdownViewProps = { html: string; preview?: boolean; theme: Theme };

/**
 * Safe container for rendered Markdown HTML. Adds lazy mermaid rendering on
 * top of the sanitised `renderMarkdown` output. The `html` prop is always
 * DOMPurify-sanitised Markdown (or plain text) from `renderNoteContent`, so
 * the innerHTML assignment below carries no unsanitised input.
 */
export function MarkdownView({ html, preview = false, theme }: MarkdownViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    // Debounce so the editor preview does not re-render diagrams per keystroke.
    const timer = setTimeout(() => {
      renderQueue = renderQueue.then(() => renderMermaidBlocks(root, () => cancelled, theme));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html, theme]);

  // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml — content is DOMPurify-sanitised in renderMarkdown.
  return <div key={theme} ref={ref} className={preview ? 'markdown-body preview' : 'markdown-body'} dangerouslySetInnerHTML={{ __html: html }} />;
}
