"""MemoryDock site smoke test — run via with_server.py against http.server."""
import pathlib
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080'
SITE_DIR = pathlib.Path(__file__).resolve().parent
FAILURES = []


def check(cond, msg):
    print(f"{'PASS' if cond else 'FAIL'}: {msg}")
    if not cond:
        FAILURES.append(msg)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)

    # 1. All pages load and expose the GitHub source link.
    # Python's http.server does not provide Cloudflare Pages clean-URL
    # rewrites, so use the actual .html files for local smoke testing.
    for path in ['/', '/quickstart.html', '/faq.html']:
        console_errors.clear()
        page.goto(BASE + path)
        page.wait_for_load_state('networkidle')
        check(page.locator('#github a[href="https://github.com/liam61-hub/memorydock"]').count() == 1,
              f'{path}: GitHub source link visible')
        check(len(console_errors) == 0, f'{path}: no console errors {console_errors[:2]}')

    # 2. Zero third-party requests on the static pages.
    reqs = []
    page.on('request', lambda r: reqs.append(r.url))
    for path in ['/', '/quickstart.html', '/faq.html']:
        page.goto(BASE + path)
        page.wait_for_load_state('networkidle')
    third = [u for u in reqs if not u.startswith(BASE)
             and not u.startswith('data:') and not u.startswith('about:')]
    check(len(third) == 0, f'zero third-party requests {third[:3]}')

    # 3. No horizontal overflow at 360 / 768 / 1280
    for w in [360, 768, 1280]:
        page.set_viewport_size({'width': w, 'height': 900})
        for path in ['/', '/quickstart.html', '/faq.html']:
            page.goto(BASE + path)
            page.wait_for_load_state('networkidle')
            delta = page.evaluate(
                'document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth')
            check(delta <= 0, f'width {w} {path}: no horizontal overflow (delta={delta})')

    # 4. Copy button feedback
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(BASE + '/quickstart.html')
    page.wait_for_load_state('networkidle')
    btn = page.locator('.copy-btn').first
    btn.click()
    page.wait_for_timeout(400)
    check('Copied' in btn.text_content(), 'copy button shows "Copied"')

    # 5. JS disabled: source link and navigation work.
    ctx2 = browser.new_context(java_script_enabled=False)
    p2 = ctx2.new_page()
    p2.goto(BASE + '/')
    check(p2.locator('#github a').is_visible(), 'no-JS: GitHub link visible')
    p2.locator('a[href="quickstart.html"]').first.click()
    p2.wait_for_load_state('load')
    check('Quickstart' in p2.title(), 'no-JS: navigation works')
    ctx2.close()

    # 6. file:// navigation
    ctx3 = browser.new_context()
    p3 = ctx3.new_page()
    p3.goto((SITE_DIR / 'index.html').as_uri())
    p3.wait_for_load_state('load')
    p3.locator('a[href="quickstart.html"]').first.click()
    p3.wait_for_load_state('load')
    check('Quickstart' in p3.title(), 'file://: navigation works')
    ctx3.close()

    # 7. Keyboard: first Tab hits the skip link
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    page.keyboard.press('Tab')
    focused = page.evaluate('document.activeElement ? document.activeElement.className : "none"')
    check('skip-link' in str(focused), f'keyboard: first Tab focuses skip link ({focused})')

    # 8. i18n: default EN, dropdown switch with URL change, persistence
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    check('Your memory' in page.locator('h1').inner_text(), 'i18n: default English')
    check(page.locator('.lang-select').input_value() == 'en', 'i18n: select shows en')
    page.locator('.lang-select').select_option('zh')
    page.wait_for_load_state('networkidle')
    check('lang=zh' in page.url, f'i18n: URL carries lang=zh ({page.url})')
    check('记忆' in page.locator('h1').inner_text(), 'i18n: switched to Chinese')
    check(page.evaluate('document.documentElement.lang') == 'zh-CN', 'i18n: html lang updated')
    check('记忆' in page.title(), 'i18n: title translated')
    page.reload()
    page.wait_for_load_state('networkidle')
    check('记忆' in page.locator('h1').inner_text(), 'i18n: persists across reload')
    page.locator('.lang-select').select_option('en')
    page.wait_for_load_state('networkidle')
    check('lang=en' in page.url, 'i18n: URL carries lang=en after switching back')
    check('Your memory' in page.locator('h1').inner_text(), 'i18n: back to English')
    check(page.evaluate('document.documentElement.lang') == 'en', 'i18n: lang restored')
    # storage-restored language is reflected into the URL without reload
    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    page.evaluate('localStorage.setItem("memorydock-lang", "zh")')
    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    check('lang=zh' in page.url, f'i18n: stored zh reflected into URL ({page.url})')
    # no missing-key warnings on any page in zh
    i18n_warnings = []
    page.on('console', lambda m: i18n_warnings.append(m.text) if '[i18n]' in m.text else None)
    for path in ['/?lang=zh', '/quickstart.html?lang=zh', '/faq.html?lang=zh', '/404.html?lang=zh']:
        page.goto(BASE + path)
        page.wait_for_load_state('networkidle')
    check(len(i18n_warnings) == 0, f'i18n: no missing translations {i18n_warnings[:3]}')
    page.evaluate('localStorage.removeItem("memorydock-lang")')

    # 9. FAQ details keyboard-toggleable
    page.goto(BASE + '/faq.html')
    page.wait_for_load_state('networkidle')
    summary = page.locator('summary').first
    summary.focus()
    page.keyboard.press('Enter')
    check(page.locator('details').first.get_attribute('open') is not None,
          'FAQ: Enter opens details')

    # 9. Screenshots for visual review
    for name in ['index', 'quickstart', 'faq']:
        page.goto(BASE + ('/' if name == 'index' else '/' + name + '.html'))
        page.wait_for_load_state('networkidle')
        page.screenshot(path=str(SITE_DIR / f'.smoke-{name}.png'), full_page=True)
        print(f'screenshot: .smoke-{name}.png')

    browser.close()

print()
if FAILURES:
    print(f'{len(FAILURES)} FAILURES')
    sys.exit(1)
print('ALL SMOKE CHECKS PASSED')
