'use client';

import { useCallback, useSyncExternalStore, type CSSProperties } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export type ReaderFont = 'original' | 'serif' | 'sans-serif' | 'monospace';
type ReaderSettings = { font: ReaderFont; size: number; spacing: number; sepia: boolean };
const defaults: ReaderSettings = { font: 'original', size: 19, spacing: 1.85, sepia: false };

const defaultSerialized = JSON.stringify(defaults);
const memory = new Map<string, string>();
function subscribe(callback: () => void) {
 window.addEventListener('reader-settings-change', callback); window.addEventListener('storage', callback);
 return () => { window.removeEventListener('reader-settings-change', callback); window.removeEventListener('storage', callback); };
}
export function useReaderSettings(userId: string) {
 const key = `reader-settings:${userId}`;
 const snapshot = useCallback(() => { try { return memory.get(key) ?? localStorage.getItem(key) ?? defaultSerialized; } catch { return memory.get(key) ?? defaultSerialized; } }, [key]);
 const serialized = useSyncExternalStore(subscribe, snapshot, () => defaultSerialized);
 let settings = defaults;
 try {
  const raw = JSON.parse(serialized);
  settings = { font: ['original', 'serif', 'sans-serif', 'monospace'].includes(raw.font) ? raw.font : defaults.font, size: typeof raw.size === 'number' && raw.size >= 14 && raw.size <= 30 ? raw.size : defaults.size, spacing: typeof raw.spacing === 'number' && raw.spacing >= 1.3 && raw.spacing <= 2.2 ? raw.spacing : defaults.spacing, sepia: raw.sepia === true };
 } catch { /* Keep defaults. */ }
 function update(next: ReaderSettings) {
  const value = JSON.stringify(next);
  try { localStorage.setItem(key, value); memory.delete(key); } catch { memory.set(key, value); }
  window.dispatchEvent(new Event('reader-settings-change'));
 }
 const style = { '--reader-font': settings.font === 'original' ? 'Georgia, serif' : settings.font, '--reader-size': `${settings.size}px`, '--reader-spacing': settings.spacing } as CSSProperties;
 return { settings, update, style };
}

export function ReaderSettingsPanel({ settings, update, close, fixedLayout = false }: { settings: ReaderSettings; update: (next: ReaderSettings) => void; close: () => void; fixedLayout?: boolean }) {
 const fonts: { value: ReaderFont; label: string }[] = [
  { value: 'original', label: 'Original' }, { value: 'serif', label: 'Serif' },
  { value: 'sans-serif', label: 'Sans serif' }, { value: 'monospace', label: 'Mono' },
 ];
 return <div className="folio-overlay reader-settings-overlay" onMouseDown={close}><section className="reader-settings" role="dialog" aria-modal="true" aria-labelledby="reader-settings-title" onMouseDown={event => event.stopPropagation()}>
  <div className="reader-settings-head"><div><span>CUSTOMIZE</span><h2 id="reader-settings-title">Your reading</h2></div><button type="button" className="folio-icon" onClick={close} aria-label="Close"><X size={19}/></button></div>
  <div className="reader-setting"><div className="reader-setting-heading"><span>Font size</span><output>{settings.size} px</output></div><div className="reader-size-controls"><button type="button" aria-label="Reduce font size" disabled={settings.size <= 14} onClick={() => update({ ...settings, size: settings.size - 1 })}><Minus size={16}/></button><input aria-label="Font size" type="range" min="14" max="30" step="1" value={settings.size} onChange={event => update({ ...settings, size: Number(event.target.value) })}/><button type="button" aria-label="Increase font size" disabled={settings.size >= 30} onClick={() => update({ ...settings, size: settings.size + 1 })}><Plus size={16}/></button></div></div>
  <fieldset className="reader-setting reader-fonts"><legend>Font</legend><div>{fonts.map(font => <label key={font.value} className="reader-font-option"><input type="radio" name="reader-font" value={font.value} checked={settings.font === font.value} onChange={() => update({ ...settings, font: font.value })}/><span><b style={{ fontFamily: font.value === 'original' ? 'Georgia, serif' : font.value }}>Aa</b><small>{font.label}</small></span></label>)}</div></fieldset>
  {!fixedLayout && <label className="reader-setting reader-spacing"><span>Line spacing</span><select value={settings.spacing} onChange={event => update({ ...settings, spacing: Number(event.target.value) })}><option value="1.3">Compact</option><option value="1.6">Comfortable</option><option value="1.85">Wide</option><option value="2.2">Extra wide</option></select></label>}
  <label className="reader-sepia"><span><strong>Sepia background</strong><small>For light mode</small></span><input type="checkbox" checked={settings.sepia} onChange={event => update({ ...settings, sepia: event.target.checked })}/></label>
  {fixedLayout && <p className="reader-settings-note">For PDFs, font size zooms the page to preserve its layout. Scroll sideways if needed.</p>}
 </section></div>;
}
