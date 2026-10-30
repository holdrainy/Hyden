"""Frontend-only Copilot check. Vite must already be running.
Run: python3 tests/copilot_smoke.py [http://127.0.0.1:1420]
Uses a fresh profile and mock responses; no runner or external HTTP request is used.
"""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost")
KEY = "hyden.copilot.v1"


def stored(page):
    return page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", KEY)


def complete(page):
    expect(page.get_by_role("button", name="Send message", exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role("status").filter(has_text="Saved locally")).to_be_visible()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1080}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) and (urlsplit(request.url).hostname not in ("127.0.0.1", "localhost") or urlsplit(request.url).port != urlsplit(BASE).port) else None)
    page.goto(f"{BASE}/#copilot", wait_until="networkidle")
    expect(page.get_by_text("Demo streaming · no local model is running in this preview", exact=True)).to_be_visible()
    model = page.get_by_role("combobox", name="Local model", exact=True)
    expect(model).to_have_value("demo-small:local")
    page.get_by_role("button", name="Copilot settings", exact=True).click()
    page.get_by_role("textbox", name="System prompt", exact=True).fill("Be a concise local coding assistant.")
    temperature = page.get_by_role("slider", name="Temperature", exact=True)
    temperature.press("Home")
    for _ in range(4):
        temperature.press("ArrowRight")
    window = page.get_by_role("slider", name="Context window", exact=True)
    window.press("Home")
    for _ in range(15):
        window.press("ArrowRight")
    page.get_by_role("button", name="Apply settings & check", exact=True).click()
    expect(page.get_by_role("status").filter(has_text="Demo engine")).to_be_visible()
    assert stored(page)["settings"]["temperature"] == 0.4
    assert stored(page)["settings"]["contextWindow"] == 8192
    page.get_by_role("button", name="Close Copilot settings", exact=True).click()

    composer = page.get_by_role("textbox", name="Message Copilot", exact=True)
    prompt = 'Write a Python example. <script>window.injected = true</script>'
    composer.fill(prompt)
    page.get_by_role("button", name="Send message", exact=True).click()
    expect(page.get_by_role("button", name="Stop response", exact=True)).to_be_visible()
    page.wait_for_function("""() => {
      const sessions = JSON.parse(localStorage.getItem('hyden.copilot.v1')).sessions;
      return sessions.some(s => s.messages.some(m => m.role === 'assistant' && m.status === 'streaming' && m.content.length > 0));
    }""")
    complete(page)
    response = page.get_by_role("article", name="Copilot response", exact=True)
    expect(response.locator("pre")).to_contain_text("def summarize")
    expect(response.locator(".ai-token-keyword").first).to_be_visible()
    assert page.evaluate("() => window.injected === undefined")
    first = stored(page)["sessions"][0]
    assert first["messages"][-1]["status"] == "complete"
    assert "```python" in first["messages"][-1]["content"]
    page.get_by_role("button", name="Copy code", exact=True).click()
    assert "def summarize" in page.evaluate("() => navigator.clipboard.readText()")
    with page.expect_download() as captured:
        page.get_by_role("button", name="Export chat", exact=True).click()
    exported = Path(captured.value.path()).read_text()
    assert "def summarize" in exported and prompt in exported
    page.screenshot(path="/tmp/hyden-copilot.png", full_page=True)

    page.get_by_role("button", name="New chat", exact=True).click()
    model.select_option("__custom")
    page.get_by_role("textbox", name="Custom model name", exact=True).fill("my-local-model")
    composer.fill("Help me plan a small project")
    page.get_by_role("button", name="Send message", exact=True).click()
    expect(page.get_by_role("article", name="Copilot response")).to_contain_text("starting point")
    page.get_by_role("button", name="Stop response", exact=True).click()
    complete(page)
    second = stored(page)["sessions"][0]
    assert second["model"] == "my-local-model"
    assert second["messages"][-1]["status"] == "cancelled"
    assert second["messages"][-1]["content"]

    # Cancel in the same JS turn as submission, before an HTTP/mock stream can start.
    composer.fill("A message cancelled during preflight")
    page.evaluate("""() => {
      document.querySelector('.ai-composer').requestSubmit();
      document.querySelector('[aria-label="New chat"]').click();
    }""")
    expect(page.get_by_role("article", name="Your message")).to_have_count(0)
    expect(page.get_by_role("button", name="Send message", exact=True)).to_be_visible()
    expect(page.locator(".ai-session")).to_have_count(3)

    offline = page.get_by_role("checkbox", name="Simulate offline engine", exact=True)
    offline.check()
    instructions = page.get_by_role("region", name="Local engine connection instructions")
    expect(instructions).to_contain_text("ollama serve")
    expect(page.get_by_role("button", name="Send message", exact=True)).to_be_disabled()
    page.get_by_role("navigation").get_by_role("button", name="Overview", exact=True).click()
    page.get_by_role("navigation").get_by_role("button", name="AI copilot", exact=True).click()
    expect(offline).to_be_checked()
    page.get_by_role("button", name="Copilot settings", exact=True).click()
    page.get_by_role("combobox", name="Local runner", exact=True).select_option("llamacpp")
    page.get_by_role("button", name="Apply settings & check", exact=True).click()
    expect(instructions).to_contain_text("llama-server")
    expect(page.locator(".ai-context-note")).to_contain_text("--ctx-size")
    offline.uncheck()
    expect(page.get_by_role("status").filter(has_text="Demo engine")).to_be_visible()
    model.select_option("demo-code:local")
    endpoint = page.get_by_role("textbox", name="Local endpoint", exact=True)
    endpoint.fill("https://example.com")
    page.get_by_role("button", name="Apply settings & check", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("local HTTP")
    endpoint.fill("http://localhost:8080")
    page.get_by_role("button", name="Apply settings & check", exact=True).click()
    expect(page.get_by_role("status").filter(has_text="Demo engine")).to_be_visible()
    assert stored(page)["settings"]["baseUrl"] == "http://127.0.0.1:8080"
    page.get_by_role("button", name="Close Copilot settings", exact=True).click()
    page.reload(wait_until="networkidle")
    expect(page.locator(".ai-session")).to_have_count(3)
    assert stored(page)["settings"]["systemPrompt"] == "Be a concise local coding assistant."
    page.get_by_role("button", name=f"Open chat {first['title']}", exact=True).click()
    expect(page.get_by_role("article", name="Copilot response").locator("pre")).to_contain_text("def summarize")
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name=f"Delete chat {second['title']}", exact=True).click()
    expect(page.locator(".ai-session")).to_have_count(2)

    composer.fill("Write a JavaScript function with an explanation")
    page.get_by_role("button", name="Send message", exact=True).click()
    expect(page.get_by_role("article", name="Copilot response").last).to_contain_text("local example")
    page.evaluate("""() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'hyden.copilot.v1') throw new DOMException('Full', 'QuotaExceededError');
        return window.originalSetItem.call(this, key, value);
      };
    }""")
    expect(page.get_by_role("button", name="Send message", exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role("status").filter(has_text="Conversation not saved")).to_be_visible()
    page.get_by_role("button", name="Copy conversation", exact=True).click()
    assert "function summarize" in page.evaluate("() => navigator.clipboard.readText()")
    page.evaluate("() => { Storage.prototype.setItem = window.originalSetItem; }")
    page.get_by_role("button", name="Retry save", exact=True).click()
    complete(page)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    page.get_by_role("button", name="Copilot settings", exact=True).click()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    page.get_by_role("button", name="Close Copilot settings", exact=True).click()
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Clear history", exact=True).click()
    expect(page.locator(".ai-session")).to_have_count(0)
    assert stored(page)["sessions"] == []
    assert stored(page)["settings"]["systemPrompt"] == "Be a concise local coding assistant."
    assert not errors, errors
    assert not requests, requests
    print("PASS: incremental mock streaming, stop/preflight cancellation, code highlighting/copy/export,")
    print("model/custom settings, offline guidance, saved history/reload/switch/delete/clear, quota recovery and mobile layout.")
    print("No runner or remote HTTP requests, console errors, or JavaScript errors.")
    browser.close()
