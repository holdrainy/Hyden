import { useEffect, useMemo, useRef, useState } from 'react';
import { Crop, Download, ImagePlus, RefreshCcw, SlidersHorizontal, Upload } from 'lucide-react';
import { renderImageCanvas, validateImageSettings } from '../../lib/browser-image';
import { exportEditorImage, loadEditorImage } from '../../lib/ipc';
import type { ImageSettings, SourceImage } from '../../lib/ipc';
import type { ImageFormat } from '../../lib/editor-types';
import './image.css';

type Fields = { x: string; y: string; cropWidth: string; cropHeight: string; width: string; height: string };
const EMPTY: Fields = { x: '0', y: '0', cropWidth: '', cropHeight: '', width: '', height: '' };

function defaults(source: SourceImage): Fields {
  const scale = Math.min(1, 4096 / Math.max(source.width, source.height));
  return { x: '0', y: '0', cropWidth: String(source.width), cropHeight: String(source.height), width: String(Math.max(1, Math.round(source.width * scale))), height: String(Math.max(1, Math.round(source.height * scale))) };
}

function errorText(reason: unknown) { return reason instanceof Error ? reason.message : 'The image could not be processed.'; }

export default function ImageProcessor() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [quality, setQuality] = useState(90);
  const [aspect, setAspect] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<SourceImage | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const exportingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; active.current?.dispose(); active.current = null; };
  }, []);

  const evaluated = useMemo(() => {
    if (!source) return { settings: null, error: '' };
    try {
      if (Object.values(fields).some((value) => !/^\d+$/.test(value))) throw new Error('Enter whole pixel values in every crop and output field.');
      const settings: ImageSettings = {
        crop: { x: Number(fields.x), y: Number(fields.y), width: Number(fields.cropWidth), height: Number(fields.cropHeight) },
        width: Number(fields.width), height: Number(fields.height), format, brightness, contrast, quality: quality / 100,
      };
      return { settings: validateImageSettings(settings, source), error: '' };
    } catch (reason) { return { settings: null, error: errorText(reason) }; }
  }, [source, fields, format, brightness, contrast, quality]);

  useEffect(() => {
    setPreviewReady(false);
    if (!source || !evaluated.settings) return;
    const settings = evaluated.settings;
    const timeout = setTimeout(() => {
      if (!canvas.current || !mounted.current || active.current !== source) return;
      try { renderImageCanvas(source, settings, canvas.current, true); setPreviewReady(true); }
      catch (reason) { setError(errorText(reason)); }
    }, 150);
    return () => clearTimeout(timeout);
  }, [source, evaluated.settings]);

  const importImage = async (file?: File) => {
    if (!file || exportingRef.current) return;
    const request = ++generation.current;
    active.current?.dispose(); active.current = null;
    setSource(null); setLoading(true); setError(''); setNotice('');
    try {
      const loaded = await loadEditorImage(file);
      if (!mounted.current || request !== generation.current) { loaded.dispose(); return; }
      active.current = loaded; setSource(loaded); setFields(defaults(loaded));
      setBrightness(100); setContrast(100); setQuality(90); setAspect(true); setFormat(loaded.format);
    } catch (reason) { if (mounted.current && request === generation.current) setError(errorText(reason)); }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  };

  const updateField = (key: keyof Fields, value: string) => {
    setNotice('');
    setFields((previous) => {
      const next = { ...previous, [key]: value };
      const cropWidth = Number(next.cropWidth), cropHeight = Number(next.cropHeight);
      if (aspect && value !== '' && Number(value) > 0 && cropWidth > 0 && cropHeight > 0) {
        if (key === 'width') next.height = String(Math.max(1, Math.round(Number(value) * cropHeight / cropWidth)));
        if (key === 'height') next.width = String(Math.max(1, Math.round(Number(value) * cropWidth / cropHeight)));
        if ((key === 'cropWidth' || key === 'cropHeight') && Number(next.width) > 0) next.height = String(Math.max(1, Math.round(Number(next.width) * cropHeight / cropWidth)));
      }
      return next;
    });
  };

  const reset = () => {
    if (!source) return;
    setFields(defaults(source)); setBrightness(100); setContrast(100); setQuality(90); setAspect(true); setFormat(source.format); setError(''); setNotice('');
  };

  const exportImage = async () => {
    if (!source || !evaluated.settings || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true); setError(''); setNotice('');
    const currentSource = source;
    const settings = evaluated.settings;
    try {
      const blob = await exportEditorImage(source, settings);
      if (!mounted.current || active.current !== currentSource) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      const stem = source.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'image';
      anchor.download = `${stem}-edited.${settings.format === 'jpeg' ? 'jpg' : settings.format}`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${settings.width} × ${settings.height} ${settings.format.toUpperCase()}. Your original file was not changed.`);
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { exportingRef.current = false; if (mounted.current) setExporting(false); }
  };

  const disabled = !source || loading || exporting;
  return (
    <section className="image-tool" aria-label="Image processor">
      <div className="image-tool-heading"><div><h2>Small changes. A fresh perspective.</h2><p>Crop, resize, and refine an image without uploading it.</p></div><button className="secondary-button" onClick={() => picker.current?.click()} disabled={loading || exporting}><Upload size={14} />{loading ? 'Reading image…' : 'Choose image'}</button></div>
      <input ref={picker} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Import image" disabled={loading || exporting} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importImage(file); }} />
      {error && <p className="image-error" role="alert">{error}</p>}
      {notice && <p className="image-notice" role="status">{notice}</p>}
      <div className="image-layout">
        <div className="image-preview-panel"><div className="image-preview-heading"><span>YOUR IMAGE</span>{source && <span>{source.width} × {source.height} · {source.format.toUpperCase()}</span>}</div><div className={`image-canvas-wrap ${!source ? 'image-canvas-empty' : ''}`}>
          {source ? <canvas ref={canvas} aria-label="Processed image preview" /> : <div className="image-empty"><ImagePlus size={46} strokeWidth={1.1} /><h3>A little room to experiment.</h3><p>Choose a PNG, WebP, or JPEG still image. Nothing leaves your device.</p></div>}
        </div><div className="image-preview-footer"><span>{source ? source.name : 'No image selected'}</span><span>{source ? evaluated.error ? 'Check dimensions' : previewReady ? 'Preview ready' : 'Updating preview…' : 'Local processing'}</span></div>{source && <p className="image-preview-note">Preview is scaled to at most 1,024 pixels. Export uses the full output dimensions below.</p>}</div>
        <div className="image-controls"><div className="image-control-heading"><SlidersHorizontal size={15} /><h3>Make a few adjustments.</h3><button className="icon-button" aria-label="Reset image adjustments" title="Reset adjustments" disabled={disabled} onClick={reset}><RefreshCcw size={14} /></button></div>
          <fieldset disabled={disabled}><legend><Crop size={13} /> Crop · original pixels</legend><div className="image-field-grid">{([['x', 'Crop X'], ['y', 'Crop Y'], ['cropWidth', 'Crop width'], ['cropHeight', 'Crop height']] as const).map(([key, label]) => <label key={key}><span>{label.replace('Crop ', '')}</span><input type="number" aria-label={label} min={key === 'x' || key === 'y' ? 0 : 1} step={1} value={fields[key]} onChange={(event) => updateField(key, event.target.value)} /></label>)}</div></fieldset>
          <fieldset disabled={disabled}><legend>Resize · output pixels</legend><div className="image-field-grid"><label><span>Width</span><input type="number" aria-label="Output width" min={1} max={4096} step={1} value={fields.width} onChange={(event) => updateField('width', event.target.value)} /></label><label><span>Height</span><input type="number" aria-label="Output height" min={1} max={4096} step={1} value={fields.height} onChange={(event) => updateField('height', event.target.value)} /></label></div><label className="image-checkbox"><input type="checkbox" aria-label="Preserve image aspect ratio" checked={aspect} onChange={(event) => setAspect(event.target.checked)} />Preserve crop aspect ratio</label></fieldset>
          <fieldset className="image-filter-fields" disabled={disabled}>{([['Brightness', brightness, setBrightness], ['Contrast', contrast, setContrast]] as const).map(([label, value, setValue]) => <label key={label}><span>{label}<strong>{value}%</strong></span><input type="range" aria-label={label} min={0} max={200} step={1} value={value} onChange={(event) => { setValue(Number(event.target.value)); setNotice(''); }} /></label>)}</fieldset>
          <fieldset disabled={disabled}><legend>Export format</legend><select aria-label="Image output format" value={format} onChange={(event) => { setFormat(event.target.value as ImageFormat); setNotice(''); }}><option value="png">PNG · lossless, transparent</option><option value="webp">WebP · compact, transparent</option><option value="jpeg">JPEG · white background</option></select>{format !== 'png' && <label className="image-quality"><span>Quality<strong>{quality}%</strong></span><input type="range" aria-label="Image quality" min={10} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}</fieldset>
          {evaluated.error && <p className="image-validation" role="status">{evaluated.error}</p>}
          <button className="primary-button image-export" disabled={disabled || !evaluated.settings} onClick={() => void exportImage()}><Download size={14} />{exporting ? 'Encoding image…' : 'Export image'}</button>
        </div>
      </div>
      <p className="image-limit-note">Still images up to 20 MiB and 16 megapixels. Output up to 4,096 pixels per side. Processing uses this browser; the native OpenCV pipeline is not connected.</p>
    </section>
  );
}
