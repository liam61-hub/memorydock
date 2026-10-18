import { useEffect, useRef } from 'react';
import { sanitizeMermaidSvg } from './markdown';

type MermaidModule = typeof import('mermaid');

let mermaidModule: MermaidModule | null = null;
let diagramCounter = 0;

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid');
    mermaidModule.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      // v12+: root-level flag; diagram-scoped `flowchart.htmlLabels` is deprecated.
      htmlLabels: false,
    });
  }
  return mermaidModule;
}

/**
 * Replace ```mermaid fenced blocks inside a rendered container with
 * sanitised SVG diagrams. Mermaid is lazy-loaded and only when at least one
 * mermaid block exists; render failures keep the original code block.
 */
async function renderMermaidBlocks(root: HTMLElement, cancelled: () => boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  if (blocks.length === 0) return;
  try {
    const { default: mermaid } = await loadMermaid();
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

type MarkdownViewProps = { html: string; preview?: boolean };

/**
 * Safe container for rendered Markdown HTML. Adds lazy mermaid rendering on
 * top of the sanitised `renderMarkdown` output.
 */
export function MarkdownView({ html, preview = false }: MarkdownViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    // Debounce so the editor preview does not re-render diagrams per keystroke.
    const timer = setTimeout(() => {
      void renderMermaidBlocks(root, () => cancelled);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html]);

  return <div ref={ref} className={preview ? 'markdown-body preview' : 'markdown-body'} dangerouslySetInnerHTML={{ __html: html }} />;
}
