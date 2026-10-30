"""Frontend-only Internal Browser test with Vite already running.
python3 tests/browser_smoke.py [http://127.0.0.1:1420]
Fresh isolated profile; no user website is contacted.
"""
import sys
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost")
KEY = "hyden.browser.v1"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 1080})
    page.set_default_timeout(10000)
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.on("request", lambda request: external.append(request.url) if request.url.startswith(("http:", "https:")) and urlsplit(request.url).netloc != urlsplit(BASE).netloc else None)
    response = page.goto(f"{BASE}/#browser", wait_until="networkidle")
    assert "frame-src 'self'" in response.headers["content-security-policy"]
    frame_element = page.get_by_title("Sandboxed browser page", exact=True)
    expect(frame_element).to_have_attribute("sandbox", "")
    expect(frame_element).to_have_attribute("referrerpolicy", "no-referrer")
    frame = page.frame_locator('iframe[title="Sandboxed browser page"]')
    expect(frame.get_by_role("heading", level=1)).to_be_visible()
    isolation = frame.locator("body").evaluate("""() => {
      const denied = fn => { try { fn(); return false; } catch(error) { return error.name === 'SecurityError'; } };
      return { origin:self.origin, scripts:document.scripts.length,
        ownStorage:denied(() => localStorage.getItem('any')),
        parentStorage:denied(() => parent.localStorage.getItem('any')) };
    }""")
    assert isolation == {"origin": "null", "scripts": 0, "ownStorage": True, "parentStorage": True}, isolation
    private = page.get_by_role("checkbox", name="Private session mode", exact=True)
    expect(private).to_be_checked()
    assert page.evaluate("key => localStorage.getItem(key)", KEY) is None
    page.get_by_role("button", name="Reading demo", exact=True).click()
    expect(frame.get_by_role("heading", level=1)).to_contain_text("attention")
    page.get_by_role("button", name="Privacy guide", exact=True).click()
    page.get_by_role("button", name="Browser back", exact=True).click()
    expect(page.get_by_role("textbox", name="Browser address")).to_have_value("hyden://reading")
    page.get_by_role("button", name="Browser forward", exact=True).click()
    expect(page.get_by_role("textbox", name="Browser address")).to_have_value("hyden://privacy")
    frame_element.evaluate("element => { window.oldBrowserFrame = element; }")
    page.get_by_role("button", name="Reload browser page", exact=True).click()
    assert page.evaluate("() => !window.oldBrowserFrame.isConnected")
    address = page.get_by_role("textbox", name="Browser address", exact=True)
    address.fill("example.com/private?test=one")
    page.get_by_role("button", name="Go", exact=True).click()
    expect(address).to_have_value("https://example.com/private?test=one")
    expect(frame_element).to_have_attribute("src", "/browser-preview/offline.html")
    expect(page.get_by_text("Remote browsing unavailable in preview", exact=True)).to_be_visible()
    assert page.evaluate("key => localStorage.getItem(key)", KEY) is None
    page.get_by_role("button", name="New browser tab", exact=True).click()
    expect(page.get_by_role("tab")).to_have_count(2)
    page.get_by_role("tab", name="Select tab example.com", exact=True).click()
    expect(address).to_have_value("https://example.com/private?test=one")
    page.get_by_role("button", name="Close tab New tab", exact=True).click()
    expect(page.get_by_role("tab")).to_have_count(1)
    page.get_by_role("checkbox", name="Simulate tracker blocking", exact=True).uncheck()
    page.get_by_role("checkbox", name="Simulate ad blocking", exact=True).uncheck()
    private.uncheck()
    expect(address).to_have_value("hyden://start")
    address.fill("https://normal.example/remembered")
    page.get_by_role("button", name="Go", exact=True).click()
    normal = page.evaluate("key => localStorage.getItem(key)", KEY)
    assert "normal.example" in normal and "example.com/private" not in normal
    private.check()
    expect(address).to_have_value("https://example.com/private?test=one")
    assert page.evaluate("key => localStorage.getItem(key)", KEY) == normal
    page.reload(wait_until="networkidle")
    expect(private).to_be_checked()
    expect(address).to_have_value("hyden://start")
    private.uncheck()
    expect(address).to_have_value("https://normal.example/remembered")
    page.evaluate("""() => {
      localStorage.setItem('hyden.workspace.v1', 'workspace-sentinel');
      localStorage.setItem('hyden.copilot.v1', 'copilot-sentinel');
      document.cookie='browser_test=keep; SameSite=Lax; path=/';
    }""")
    cookie = page.evaluate("() => document.cookie")
    page.get_by_role("button", name="Purge Session & Cookies", exact=True).click()
    expect(private).to_be_checked()
    expect(address).to_have_value("hyden://start")
    expect(page.get_by_role("status").filter(has_text="No external cookies")).to_be_visible()
    assert page.evaluate("key => localStorage.getItem(key)", KEY) is None
    assert page.evaluate("() => localStorage.getItem('hyden.workspace.v1')") == "workspace-sentinel"
    assert page.evaluate("() => localStorage.getItem('hyden.copilot.v1')") == "copilot-sentinel"
    assert page.evaluate("() => document.cookie") == cookie
    page.evaluate("key => localStorage.setItem(key, '{broken')", KEY)
    private.click()  # A rejected mode change must leave the controlled checkbox checked.
    expect(page.get_by_role("alert")).to_contain_text("saved navigation")
    expect(private).to_be_checked()
    assert page.evaluate("key => localStorage.getItem(key)", KEY) == "{broken"
    page.get_by_role("button", name="Purge Session & Cookies", exact=True).click()
    private.uncheck()
    address.fill("https://retained.example/")
    page.get_by_role("button", name="Go", exact=True).click()
    retained = page.evaluate("key => localStorage.getItem(key)", KEY)
    page.evaluate("""() => {
      window.removeBeforeTest = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(key) {
        if(key === 'hyden.browser.v1') throw new DOMException('Denied','SecurityError');
        return window.removeBeforeTest.call(this,key);
      };
    }""")
    page.get_by_role("button", name="Purge Session & Cookies", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("could not be removed")
    expect(private).to_be_checked()
    assert page.evaluate("key => localStorage.getItem(key)", KEY) == retained
    page.evaluate("() => { Storage.prototype.removeItem = window.removeBeforeTest; }")
    page.get_by_role("button", name="Purge Session & Cookies", exact=True).click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Reading demo", exact=True).click()
    expect(frame.get_by_role("heading", level=1)).to_be_visible()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    assert not external, external
    assert not errors, errors
    print("PASS: sandbox opacity/parent isolation, local-only pages, navigation/tabs/reload, privacy toggles,")
    print("private-vs-normal persistence, scoped purge and partial failures, retained other-module data/cookies, mobile layout.")
    print("No remote requests or page/console errors. External cookies were intentionally not cleared.")
    browser.close()
