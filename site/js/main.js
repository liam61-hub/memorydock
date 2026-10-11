// MemoryDock site scripts — no dependencies, no third-party calls.
// Responsibilities: copy buttons and footer year.

// --- Copy-to-clipboard buttons (no-op-safe on file:// and older browsers) ---
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const code = btn.closest('.code-block')?.querySelector('pre code');
    if (!code) return;
    const text = code.textContent || '';
    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    };
    const markCopied = () => {
      const label = btn.textContent;
      const i18n = window.MEMORYDOCK_I18N;
      btn.textContent = i18n && i18n.t ? i18n.t('common.copied') : 'Copied';
      btn.dataset.copied = 'true';
      setTimeout(() => {
        btn.textContent = label;
        btn.dataset.copied = 'false';
      }, 1600);
    };
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy();
      markCopied();
    } catch {
      // Permissions can reject the async clipboard API even after a click.
      fallbackCopy();
      markCopied();
    }
  });
});

// --- Footer year ---
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
