"""Optional browser smoke test: Python Playwright + Chromium, with Vite already running.

Run: python3 tests/media_smoke.py [http://127.0.0.1:1420] [--offline]
Use --offline only against a production preview, without Vite's development HMR.
No native build, package install, external media request, or existing browser data is used.
"""
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
OFFLINE = "--offline" in sys.argv[2:]
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost"), "Use a local preview server"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"]
    )
    context = browser.new_context(viewport={"width": 1440, "height": 1080})
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    external = []
    failed_requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(f"{message.text} ({message.location.get('url', '')})") if message.type == "error" else None)
    page.on("requestfailed", lambda request: failed_requests.append((request.url, request.failure)))

    def track_request(request):
        if request.url.startswith(("data:", "blob:")):
            return
        if urlsplit(request.url).hostname not in ("127.0.0.1", "localhost"):
            external.append(request.url)

    page.on("request", track_request)
    response = page.goto(f"{BASE}/#media", wait_until="networkidle")
    assert response.status == 200
    assert "media-src 'self' blob:" in response.headers["content-security-policy"]
    items = page.get_by_role("region", name="Media items")
    expect(items.locator(".media-card")).to_have_count(2)

    page.get_by_role("button", name="Favorite Quiet interval", exact=True).click()
    page.get_by_role("button", name="Favorites", exact=True).click()
    expect(items.locator(".media-card")).to_have_count(1)
    expect(items.get_by_role("heading", name="Quiet interval")).to_be_visible()
    page.get_by_role("button", name="Video", exact=True).click()
    expect(items.locator(".media-card")).to_have_count(1)
    page.get_by_role("button", name="All media", exact=True).click()
    page.get_by_role("textbox", name="Search your library").fill("missing title")
    expect(page.get_by_role("heading", name="No matches here yet.")).to_be_visible()
    page.get_by_role("button", name="Clear search").click()
    page.get_by_role("combobox", name="Sort media").select_option("title")
    expect(items.locator(".media-card h2").first).to_have_text("Color study")
    page.get_by_role("button", name="List view", exact=True).click()
    expect(items.locator(".media-items-list")).to_be_visible()
    page.get_by_role("button", name="Grid view", exact=True).click()

    page.get_by_role("button", name="Play Quiet interval", exact=True).click()
    page.wait_for_function("() => document.querySelector('audio')?.currentTime > .1")
    page.evaluate("() => { window.previousPlayer = document.querySelector('audio'); }")
    page.get_by_role("button", name="Close media details").click()
    assert page.evaluate("() => window.previousPlayer.paused && !window.previousPlayer.getAttribute('src')")
    page.get_by_role("button", name="Play Color study", exact=True).click()
    page.wait_for_function("() => document.querySelector('video')?.currentTime > .1")
    expect(page.locator(".media-metadata")).to_contain_text("320 × 180")
    page.evaluate("() => { window.previousPlayer = document.querySelector('video'); }")
    page.get_by_role("navigation").get_by_role("button", name="Overview", exact=True).click()
    assert page.evaluate("() => window.previousPlayer.paused && !window.previousPlayer.getAttribute('src')")
    page.get_by_role("navigation").get_by_role("button", name="Media library", exact=True).click()
    expect(page.get_by_role("button", name="Unfavorite Quiet interval", exact=True)).to_be_visible()

    picker = page.get_by_label("Import local media files")
    audio = ROOT / "public/media/quiet-interval.wav"
    picker.set_input_files(str(audio))
    expect(items.get_by_role("heading", name="quiet-interval", exact=True)).to_be_visible()
    expect(page.locator(".media-metadata")).to_contain_text("0:06")
    expect(page.locator(".media-metadata")).to_contain_text("audio/wav")
    assert page.locator("audio").evaluate("(player) => player.paused"), "Import must not autoplay"
    picker.set_input_files(str(audio))
    expect(page.get_by_role("status")).to_contain_text("Already in this session")
    expect(items.locator(".media-card")).to_have_count(3)
    picker.set_input_files({"name": "not-media.png", "mimeType": "image/png", "buffer": b"image"})
    expect(page.get_by_role("status")).to_contain_text("Choose an audio or video file")
    picker.set_input_files(str(ROOT / "public/media/color-study.webm"))
    expect(items.get_by_role("heading", name="color-study", exact=True)).to_be_visible()
    expect(page.locator(".media-metadata")).to_contain_text("320 × 180")
    page.get_by_role("button", name="Remove from library", exact=True).click()
    expect(items.get_by_role("heading", name="color-study", exact=True)).to_have_count(0)
    assert (ROOT / "public/media/color-study.webm").exists()

    url = page.get_by_role("textbox", name="Media URL", exact=True)
    url.fill("http://example.com/rejected")
    page.get_by_role("button", name="Queue demo", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("Use an HTTPS URL")
    url.fill("https://example.com/sound")
    page.get_by_role("button", name="Queue demo", exact=True).click()
    job = page.locator(".media-job").filter(has_text="example.com · audio demo")
    expect(job).to_contain_text("Queued · demo")
    job.get_by_role("button", name="Run demo", exact=True).click()
    expect(job).to_contain_text("Complete · demo")
    expect(items.get_by_role("heading", name="example.com · audio demo", exact=True)).to_be_visible()
    expect(page.get_by_role("status")).to_contain_text("the URL was not downloaded")
    page.get_by_role("combobox", name="Download media type").select_option("video")
    url.fill("https://example.org/video")
    page.get_by_role("button", name="Queue demo", exact=True).click()
    cancelled = page.locator(".media-job").filter(has_text="example.org · video demo")
    cancelled.get_by_role("button", name="Cancel example.org · video demo").click()
    expect(cancelled).to_contain_text("Cancelled · demo")
    expect(cancelled.get_by_role("button", name="Run demo")).to_have_count(0)

    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Toggle navigation").click()
    page.get_by_role("navigation").get_by_role("button", name="Overview", exact=True).click()
    page.get_by_role("button", name="Toggle navigation").click()
    page.get_by_role("navigation").get_by_role("button", name="Media library", exact=True).click()
    expect(page.get_by_role("heading", name="Media library", exact=True)).to_be_visible()
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    page.reload(wait_until="networkidle")
    expect(items.locator(".media-card")).to_have_count(2)
    expect(page.locator(".media-job")).to_have_count(0)
    expect(page.get_by_role("button", name="Favorite Quiet interval", exact=True)).to_be_visible()
    if OFFLINE:
        # Blob playback is the offline guarantee; no server asset needs to be cached.
        context.set_offline(True)
        picker.set_input_files(str(audio))
        expect(items.get_by_role("heading", name="quiet-interval", exact=True)).to_be_visible()
        page.get_by_role("button", name="Play quiet-interval", exact=True).click()
        page.wait_for_function("() => document.querySelector('audio')?.currentTime > .1")
        context.set_offline(False)
    assert not external, external
    assert not errors, (errors, failed_requests)
    print("PASS: media filters/search/sort/layout, real audio/video playback, metadata/import/deduplication,")
    print("session navigation/reload, cleanup/removal, download validation/simulation/cancellation and mobile layout.")
    if OFFLINE:
        print("PASS: offline local-file import and real Blob audio playback.")
    print("No external media requests, console errors, or JavaScript errors.")
    browser.close()
