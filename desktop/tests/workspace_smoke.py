"""Frontend-only Workspace smoke test. Run with Vite already running:
python3 tests/workspace_smoke.py [http://127.0.0.1:1420]
Uses a fresh browser context; never touches an existing user's browser data.
Requires Python Playwright and /usr/bin/chromium; no Tauri build is performed.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost")
KEY = "hyden.workspace.v1"
MARKDOWN = '# Field notes\n\n**Bold idea** and *quiet emphasis*.\n\n- [ ] Draft the plan\n\n```python\nprint("local")\n```\n\n<script>window.injected = true</script>'


def saved(page):
    expect(page.get_by_role("status").filter(has_text="All changes saved")).to_be_visible()


def export(page, button):
    with page.expect_download() as captured:
        page.get_by_role("button", name=button, exact=True).click()
    download = captured.value
    return download.suggested_filename, Path(download.path()).read_text()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1080}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.on("request", lambda request: external.append(request.url) if request.url.startswith(("http:", "https:")) and urlsplit(request.url).hostname not in ("127.0.0.1", "localhost") else None)
    page.goto(f"{BASE}/#workspace", wait_until="networkidle")
    page.get_by_role("button", name="New note", exact=True).click()
    source = page.get_by_role("textbox", name="Note Markdown", exact=True)
    source.fill("strong")
    source.evaluate("(element) => element.setSelectionRange(0, 6)")
    page.get_by_role("button", name="Bold", exact=True).click()
    expect(source).to_have_value("**strong**")
    source.fill(MARKDOWN)
    title = page.get_by_role("textbox", name="Document title", exact=True)
    title.fill("Field journal")
    page.get_by_role("button", name="Rename", exact=True).click()
    saved(page)
    page.get_by_role("button", name="Preview note", exact=True).click()
    preview = page.get_by_label("Formatted note preview")
    expect(preview.get_by_role("heading", name="Field notes", exact=True)).to_be_visible()
    expect(preview.locator("strong")).to_have_text("Bold idea")
    expect(preview.locator("em")).to_have_text("quiet emphasis")
    expect(preview.locator("pre")).to_contain_text('print("local")')
    assert page.evaluate("() => window.injected === undefined")
    page.get_by_role("checkbox", name="Task: Draft the plan", exact=True).check()
    saved(page)
    expected_markdown = MARKDOWN.replace("[ ]", "[x]")
    page.get_by_role("button", name="Copy Markdown", exact=True).click()
    assert page.evaluate("() => navigator.clipboard.readText()") == expected_markdown
    page.get_by_role("button", name="Copy text", exact=True).click()
    plain = page.evaluate("() => navigator.clipboard.readText()")
    assert "Bold idea" in plain and "**Bold idea**" not in plain
    name, content = export(page, ".md")
    assert name == "Field journal.md" and content == expected_markdown
    name, content = export(page, ".txt")
    assert name == "Field journal.txt" and "**Bold idea**" not in content
    page.get_by_role("button", name="Enter focus mode", exact=True).click()
    expect(page.get_by_role("dialog", name="Note editor focus mode")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog", name="Note editor focus mode")).to_have_count(0)
    page.get_by_role("button", name="New note", exact=True).click()
    page.get_by_role("button", name="Write note", exact=True).click()
    source.fill("Second note, saved before switching.")
    page.get_by_role("complementary", name="Notes documents").get_by_role("button", name=re.compile("^Field journal")).click()
    expect(source).to_have_value(expected_markdown)
    page.reload(wait_until="networkidle")
    saved(page)
    stored = page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", KEY)
    assert len(stored["notes"]) == 2
    assert any(note["markdown"] == expected_markdown for note in stored["notes"])
    assert any(note["markdown"] == "Second note, saved before switching." for note in stored["notes"])

    page.get_by_role("tab", name=re.compile("^Sheets")).click()
    page.get_by_role("button", name="New sheet", exact=True).click()
    cell = lambda address: page.get_by_role("textbox", name=f"Cell {address}", exact=True)
    for address, value in {"A1": "10", "A2": "20", "A3": "30", "B1": "=SUM(A1:A3)", "B2": "=AVERAGE(A1:A3)", "B3": "=A1*2+5", "C1": "=1/0", "C3": "=A2"}.items():
        cell(address).fill(value)
    cell("D1").click()
    expect(cell("B1")).to_have_value("60")
    expect(cell("B2")).to_have_value("20")
    expect(cell("B3")).to_have_value("25")
    expect(cell("C1")).to_have_value("#DIV/0!")
    page.get_by_role("button", name="Format first row as header", exact=True).click()
    saved(page)
    name, csv = export(page, "Export CSV")
    assert name.endswith(".csv") and '"60"' in csv and '"25"' in csv
    name, content = export(page, "Export JSON")
    sheet_json = json.loads(content)
    assert sheet_json["sheet"]["cells"]["B1"] == "=SUM(A1:A3)"
    assert sheet_json["sheet"]["headerRow"] is True
    page.get_by_role("button", name="Select row 2", exact=True).click()
    page.get_by_role("button", name="Add row", exact=True).click()
    expect(cell("A4")).to_have_value("30")
    expect(cell("B1")).to_have_value("60")
    page.get_by_role("button", name="Delete row", exact=True).click()
    expect(cell("B1")).to_have_value("40")
    expect(cell("C3")).to_have_value("#REF!")
    page.get_by_role("button", name="Select column A", exact=True).click()
    page.get_by_role("button", name="Add column", exact=True).click()
    expect(cell("C1")).to_have_value("40")
    page.get_by_role("button", name="Delete column", exact=True).click()
    expect(cell("B1")).to_have_value("#REF!")
    saved(page)
    page.screenshot(path="/tmp/hyden-workspace-sheets.png", full_page=True)
    page.reload(wait_until="networkidle")
    page.get_by_role("tab", name=re.compile("^Sheets")).click()
    expect(cell("B1")).to_have_value("#REF!")
    expect(page.get_by_role("button", name="Format first row as header", exact=True)).to_have_attribute("aria-pressed", "true")
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Delete document", exact=True).click()
    expect(page.get_by_role("heading", name="Make a little sense of the numbers.")).to_be_visible()

    page.get_by_role("tab", name=re.compile("^Notes")).click()
    source.fill("Autosaved when leaving the module immediately.")
    page.get_by_role("navigation").get_by_role("button", name="Overview", exact=True).click()
    page.get_by_role("navigation").get_by_role("button", name="Workspace", exact=True).click()
    expect(source).to_have_value("Autosaved when leaving the module immediately.")
    saved(page)
    page.evaluate("""() => {
      window.originalSetItem = Storage.prototype.setItem;
      window.originalGetItem = Storage.prototype.getItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'hyden.workspace.v1') throw new DOMException('Full', 'QuotaExceededError');
        return window.originalSetItem.call(this, key, value);
      };
    }""")
    source.fill("Recovery draft must remain exportable.")
    page.get_by_role("button", name="Preview note", exact=True).click()
    expect(page.get_by_role("alert")).to_be_visible()
    page.evaluate("""() => {
      Storage.prototype.getItem = function(key) {
        if (key === 'hyden.workspace.v1') throw new DOMException('Unavailable', 'SecurityError');
        return window.originalGetItem.call(this, key);
      };
    }""")
    page.get_by_role("navigation").get_by_role("button", name="Overview", exact=True).click()
    page.get_by_role("navigation").get_by_role("button", name="Workspace", exact=True).click()
    expect(source).to_have_value("Recovery draft must remain exportable.")
    expect(source).to_be_disabled()
    name, recovery = export(page, ".md")
    assert recovery == "Recovery draft must remain exportable."
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Load saved version", exact=True).click()
    expect(source).to_have_value(recovery)
    page.evaluate("() => { Storage.prototype.getItem = window.originalGetItem; Storage.prototype.setItem = window.originalSetItem; }")
    page.get_by_role("button", name="Retry save", exact=True).click()
    saved(page)
    expect(source).to_be_enabled()
    expect(source).to_have_value(recovery)

    # Dirty sequential edits from another tab must not silently overwrite each other.
    other = context.new_page()
    other.goto(f"{BASE}/#workspace", wait_until="networkidle")
    source.fill("First tab wins this revision.")
    other.get_by_role("textbox", name="Note Markdown", exact=True).fill("Second tab keeps its conflict draft.")
    page.get_by_role("button", name="Preview note", exact=True).click()
    saved(page)
    other.get_by_role("button", name="Preview note", exact=True).click()
    expect(other.get_by_role("alert")).to_contain_text("changed")
    other.get_by_role("button", name="Write note", exact=True).click()
    expect(other.get_by_role("textbox", name="Note Markdown", exact=True)).to_have_value("Second tab keeps its conflict draft.")
    other.bring_to_front()  # Chromium suppresses confirm dialogs in inactive tabs.
    other.once("dialog", lambda dialog: dialog.accept())
    other.get_by_role("button", name="Load saved version", exact=True).click()
    expect(other.get_by_role("textbox", name="Note Markdown", exact=True)).to_have_value("First tab wins this revision.")
    other.close()
    page.bring_to_front()

    page.get_by_role("button", name="Write note", exact=True).click()
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    page.get_by_role("tab", name=re.compile("^Sheets")).click()
    page.get_by_role("button", name="New sheet", exact=True).click()
    cell("A1").fill("7")
    cell("B1").fill("=A1*3")
    cell("B2").click()
    expect(cell("B1")).to_have_value("21")
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    assert not errors, errors
    assert not external, external
    print("PASS: notes formatting/tasks, CRUD, clipboard/exports, reload/navigation saves; sheet formulas/errors/structure/header/exports;")
    print("storage quota/read-failure recovery, sequential cross-tab conflict protection and mobile layout. No page/console errors or remote requests.")
    browser.close()
