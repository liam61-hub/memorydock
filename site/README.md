# MemoryDock site

This is a static English and Chinese product site for MemoryDock. It has no build step, framework, webfonts, analytics, or third-party scripts. Its installation links point to [the GitHub repository](https://github.com/liam61-hub/memorydock).

## Files

- `index.html`: overview and source installation.
- `quickstart.html`: setup and MCP configuration.
- `faq.html`: privacy, compatibility, and project questions.
- `js/i18n.js`: Chinese translations. English is in the HTML markup and works without JavaScript.
- `css/main.css`: shared styles.

The language selector uses `?lang=en` or `?lang=zh`; it remembers the choice in local storage. Keep English markup and Chinese dictionary entries in sync when editing copy.

## Test locally

```sh
python -m http.server 8080 --directory site
```

Open <http://localhost:8080/>. With Python Playwright and Chromium installed, run `python site/.smoke-test.py` while that server is running. The smoke test covers page loading, translations, responsive widths, copy buttons, keyboard navigation, and absence of third-party requests.

The source can be deployed as static assets, but publishing the site is separate from publishing this GitHub repository. Update canonical URLs in `robots.txt`, `sitemap.xml`, and page metadata when choosing a production domain.
