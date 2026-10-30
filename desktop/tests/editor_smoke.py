"""Frontend-only Studio check. Vite must already be running.
python3 tests/editor_smoke.py [http://127.0.0.1:1420]
Verifies command plans without executing FFmpeg and decodes actual exported image bytes.
"""
import base64
import struct
import sys
import zlib
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420"
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost")
ROOT = Path(__file__).resolve().parents[1]


def png_fixture():
    def chunk(kind, content):
        return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content) & 0xffffffff)
    row = b'\x00' + bytes([80, 120, 160, 255]) * 4 + bytes([0, 0, 0, 0]) * 4
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 6, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(row * 6)) + chunk(b'IEND', b'')


def decode(page, data):
    return page.evaluate("""async base64 => {
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const image=await createImageBitmap(new Blob([bytes]));
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
      return {width:canvas.width,height:canvas.height,first:[...ctx.getImageData(0,0,1,1).data],last:[...ctx.getImageData(canvas.width-1,0,1,1).data]};
    }""", base64.b64encode(data).decode())


def download_image(page):
    with page.expect_download() as captured:
        page.get_by_role("button", name="Export image", exact=True).click()
    return captured.value.suggested_filename, Path(captured.value.path()).read_bytes()


def slider(page, name, value):
    page.get_by_role("slider", name=name, exact=True).evaluate("""(element,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
    }""", value)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1080}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.on("request", lambda request: external.append(request.url) if request.url.startswith(("http:", "https:")) and urlsplit(request.url).netloc != urlsplit(BASE).netloc else None)
    page.goto(f"{BASE}/#editor", wait_until="networkidle")
    picker = page.get_by_label("Import trim media", exact=True)
    picker.set_input_files(str(ROOT / "public/media/color-study.webm"))
    video = page.get_by_label("Trimmer video preview", exact=True)
    expect(video).to_be_visible()
    start = page.get_by_role("spinbutton", name="Start seconds", exact=True)
    end = page.get_by_role("spinbutton", name="End seconds", exact=True)
    expect(end).to_have_value("6")
    assert video.evaluate("element=>element.paused")
    start.fill("1"); end.fill("4")
    page.get_by_role("button", name="Generate FFmpeg plan", exact=True).click()
    command = page.get_by_label("FFmpeg command", exact=True)
    expect(command).to_contain_text("'1.000'")
    expect(command).to_contain_text("'3.000'")
    expect(command).to_contain_text("libx264")
    expect(page.get_by_role("button", name="Run native FFmpeg", exact=True)).to_be_disabled()
    page.get_by_role("button", name="Copy FFmpeg command", exact=True).click()
    assert "libx264" in page.evaluate("() => navigator.clipboard.readText()")
    page.get_by_role("button", name="Preview selection", exact=True).click()
    page.wait_for_function("() => document.querySelector('video')?.currentTime > 1.1")
    video.evaluate("element=>{window.oldTrimPlayer=element}")
    page.get_by_role("checkbox", name="Extract audio as MP3", exact=True).check()
    expect(command).to_have_count(0)
    page.get_by_role("button", name="Generate FFmpeg plan", exact=True).click()
    expect(command).to_contain_text("libmp3lame")
    expect(command).to_contain_text("-audio.mp3")
    end.fill("0.5")
    expect(page.get_by_role("button", name="Generate FFmpeg plan", exact=True)).to_be_disabled()
    expect(command).to_have_count(0)
    picker.set_input_files(str(ROOT / "public/media/quiet-interval.wav"))
    expect(page.get_by_label("Trimmer audio preview", exact=True)).to_be_visible()
    expect(page.get_by_role("checkbox", name="Extract audio as MP3", exact=True)).to_be_checked()
    expect(page.get_by_role("checkbox", name="Extract audio as MP3", exact=True)).to_be_disabled()
    assert page.evaluate("() => window.oldTrimPlayer.paused && !window.oldTrimPlayer.getAttribute('src')")
    page.get_by_role("tab", name="Image Processor", exact=True).click()
    expect(page.get_by_label("Trimmer audio preview", exact=True)).to_have_count(0)

    image_picker = page.get_by_label("Import image", exact=True)
    image_picker.set_input_files({"name": "sample.png", "mimeType": "image/png", "buffer": png_fixture()})
    expect(page.get_by_role("spinbutton", name="Crop width", exact=True)).to_have_value("8")
    page.get_by_role("spinbutton", name="Crop width", exact=True).fill("2")
    page.get_by_role("spinbutton", name="Crop height", exact=True).fill("2")
    page.get_by_role("spinbutton", name="Crop X", exact=True).fill("1")
    page.get_by_role("spinbutton", name="Crop Y", exact=True).fill("1")
    page.get_by_role("spinbutton", name="Output width", exact=True).fill("4")
    expect(page.get_by_role("spinbutton", name="Output height", exact=True)).to_have_value("4")
    slider(page, "Brightness", 150)
    slider(page, "Contrast", 50)
    page.wait_for_function("() => {const c=document.querySelector('canvas');return c?.width===4 && c?.getContext('2d').getImageData(0,0,1,1).data[0]===156;}")
    name, data = download_image(page)
    assert name == "sample-edited.png" and data.startswith(b'\x89PNG')
    decoded = decode(page, data)
    assert decoded["width"] == 4 and decoded["height"] == 4, decoded
    assert decoded["first"] == [156, 186, 216, 255], decoded
    # High-quality resize interpolation may ring slightly near the crop edge.
    assert decoded["last"][3] == 255 and all(abs(actual-expected) <= 3 for actual, expected in zip(decoded["last"][:3], [156, 186, 216])), decoded
    page.get_by_role("combobox", name="Image output format", exact=True).select_option("webp")
    name, data = download_image(page)
    assert name.endswith(".webp") and data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    assert decode(page, data)["width"] == 4
    page.get_by_role("button", name="Reset image adjustments", exact=True).click()
    page.get_by_role("combobox", name="Image output format", exact=True).select_option("jpeg")
    slider(page, "Image quality", 100)
    name, data = download_image(page)
    assert name.endswith(".jpg") and data.startswith(b'\xff\xd8')
    decoded = decode(page, data)
    assert decoded["width"] == 8 and decoded["height"] == 6
    assert decoded["last"][3] == 255 and all(value >= 245 for value in decoded["last"][:3]), decoded
    page.get_by_role("spinbutton", name="Crop width", exact=True).fill("99")
    expect(page.get_by_role("button", name="Export image", exact=True)).to_be_disabled()
    page.get_by_role("button", name="Reset image adjustments", exact=True).click()
    expect(page.get_by_role("button", name="Export image", exact=True)).to_be_enabled()
    page.screenshot(path="/tmp/hyden-image-editor.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    image_picker.set_input_files({"name": "unsafe.svg", "mimeType": "image/svg+xml", "buffer": b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'})
    expect(page.get_by_role("alert")).to_contain_text("SVG")
    expect(page.get_by_role("button", name="Export image", exact=True)).to_be_disabled()
    image_picker.set_input_files({"name": "sample.png", "mimeType": "image/png", "buffer": png_fixture()})
    expect(page.get_by_role("button", name="Export image", exact=True)).to_be_enabled()
    page.get_by_role("tab", name="Audio/Video Trimmer", exact=True).click()
    expect(page.get_by_label("Processed image preview", exact=True)).to_have_count(0)
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    assert not external, external
    assert not errors, errors
    print("PASS: real local media metadata/selection playback, range validation, MP3/video command plans and player cleanup;")
    print("actual crop/resize/filter PNG pixels, WebP/JPEG byte formats/dimensions/white alpha flattening, validation/reset and mobile layout.")
    print("No FFmpeg execution, uploads, remote requests, or page/console errors.")
    browser.close()
