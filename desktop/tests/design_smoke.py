"""Frontend-only Design & Boards smoke test.

The Figma origin is intercepted with a harmless same-origin fixture so this test
checks iframe isolation and lifecycle without depending on third-party network.
"""
import base64
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost")
DESIGN_KEY = "hyden.design.v1"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1080}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, unexpected, figma_requests = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.on("request", lambda request: (figma_requests.append(request.url) if "embed.figma.com" in request.url else None))
    page.on("request", lambda request: unexpected.append(request.url) if request.url.startswith(("http:", "https:")) and urlsplit(request.url).netloc != urlsplit(BASE).netloc and "embed.figma.com" not in request.url else None)

    def figma(route):
        route.fulfill(status=200, content_type="text/html", body="""<!doctype html><title>Mock Figma</title><script>
          try { parent.localStorage.setItem('cross-origin-probe', 'blocked'); } catch (e) { window.crossOriginBlocked = e.name === 'SecurityError'; }
        </script><main>Mock shared Figma board</main>""")
    context.route("https://embed.figma.com/**", figma)

    page.goto(f"{BASE}/#workspace", wait_until="networkidle")
    page.get_by_role("tab", name=re.compile("^Design")).click()
    expect(page.get_by_role("tab", name="Figma boards", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Make a little room for possibilities.")).to_be_visible()
    url = "https://www.figma.com/design/AbCd12/My-board?node-id=1%3A2&evil=drop"
    page.get_by_role("textbox", name="Figma board URL", exact=True).fill(url)
    page.get_by_role("textbox", name="Board title", exact=True).fill("My board")
    page.get_by_role("button", name="Save board bookmark", exact=True).click()
    expect(page.get_by_role("button", name="Open board My board", exact=True)).to_be_visible()
    assert not figma_requests, figma_requests
    stored = page.evaluate("key => JSON.parse(localStorage.getItem(key))", DESIGN_KEY)
    assert stored["bookmarks"][0]["url"] == "https://www.figma.com/design/AbCd12/My-board?node-id=1%3A2"

    # Invalid links are rejected without replacing an already saved bookmark.
    page.get_by_role("textbox", name="Figma board URL", exact=True).fill("https://evil.example/file/AbCd12/nope")
    page.get_by_role("button", name="Open live board", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("Figma")
    assert len(figma_requests) == 0

    page.get_by_role("button", name="Open board My board", exact=True).click()
    frame = page.get_by_title("Figma live viewer", exact=True)
    expect(frame).to_be_visible()
    expect(frame).to_have_attribute("sandbox", "allow-scripts allow-same-origin allow-popups")
    expect(frame).to_have_attribute("referrerpolicy", "no-referrer")
    expect(frame).to_have_attribute("allow", "fullscreen")
    expect(frame).to_have_attribute("allowfullscreen", "")
    expect(page.get_by_role("status").filter(has_text="Frame opened")).to_be_visible()
    assert frame.get_attribute("src").startswith("https://embed.figma.com/design/AbCd12/My-board")
    assert len(figma_requests) == 1
    page.get_by_role("button", name="Copy Figma link", exact=True).click()
    assert page.evaluate("() => navigator.clipboard.readText()") == "https://www.figma.com/design/AbCd12/My-board?node-id=1%3A2"
    page.get_by_role("button", name="Reload Figma board", exact=True).click()
    expect(page.get_by_title("Figma live viewer", exact=True)).to_be_visible()
    page.get_by_role("button", name="Unload Figma board", exact=True).click()
    expect(page.get_by_title("Figma live viewer", exact=True)).to_have_count(0)

    # Rename and persist the bookmark, then switch to the offline tool.
    page.get_by_role("button", name="Rename bookmark My board", exact=True).click()
    rename = page.get_by_role("textbox", name="Rename bookmark My board", exact=True)
    rename.fill("Reference board")
    page.get_by_role("button", name="Save", exact=True).click()
    expect(page.get_by_role("button", name="Open board Reference board", exact=True)).to_be_visible()
    page.get_by_role("tab", name="Offline scratchpad", exact=True).click()
    expect(page.get_by_role("img", name="Drawing board", exact=True)).to_be_visible()
    expect(page.get_by_title("Figma live viewer", exact=True)).to_have_count(0)

    board = page.get_by_role("img", name="Drawing board", exact=True)
    box = board.bounding_box()
    assert box
    # Draw a rectangle and a red pen stroke using the logical 1200x800 board.
    page.get_by_role("button", name="Rectangle tool", exact=True).click()
    page.mouse.move(box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.1)
    page.mouse.down(); page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.4); page.mouse.up()
    page.get_by_role("button", name="Pen color #b64b42", exact=True).click()
    page.get_by_role("button", name="Pen tool", exact=True).click()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.55)
    page.mouse.down(); page.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.65, steps=4); page.mouse.up()
    expect(page.get_by_role("status").filter(has_text="Saved locally")).to_be_visible()
    stored = page.evaluate("key => JSON.parse(localStorage.getItem(key))", DESIGN_KEY)
    assert len(stored["scratchpad"]["shapes"]) == 2
    assert stored["scratchpad"]["shapes"][0]["kind"] == "rectangle"
    assert stored["scratchpad"]["shapes"][1]["kind"] == "pen"

    with page.expect_download() as captured:
        page.get_by_role("button", name="Export PNG", exact=True).click()
    png = Path(captured.value.path()).read_bytes()
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    decoded = page.evaluate("""async encoded => { const bytes=Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); const image=await createImageBitmap(new Blob([bytes])); return [image.width,image.height]; }""", base64.b64encode(png).decode())
    assert decoded == [1200, 800]

    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Clear canvas", exact=True).click()
    expect(page.get_by_text(re.compile("0 / 250 shapes"))).to_be_visible()
    page.reload(wait_until="networkidle")
    page.get_by_role("tab", name=re.compile("^Design")).click()
    page.get_by_role("tab", name="Offline scratchpad", exact=True).click()
    expect(page.get_by_text(re.compile("0 / 250 shapes"))).to_be_visible()
    expect(page.get_by_role("button", name="Open board Reference board", exact=True)).to_have_count(0)
    page.get_by_role("tab", name="Figma boards", exact=True).click()
    expect(page.get_by_role("button", name="Open board Reference board", exact=True)).to_be_visible()

    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("tab", name="Offline scratchpad", exact=True).click()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    assert not unexpected, unexpected
    assert not errors, errors
    print("PASS: Figma URL normalization, bookmark persistence/rename, explicit mocked iframe loading, sandbox/referrer isolation, reload/unload lifecycle, offline scratchpad gestures, PNG export, clear/reload persistence, and mobile layout.")
    browser.close()
