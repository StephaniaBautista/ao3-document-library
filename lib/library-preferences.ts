'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Appearance = 'blue' | 'warm' | 'night';
export type ColorPalette = 'original' | 'ocean' | 'forest' | 'lavender' | 'rose' | 'slate';
type LightAppearance = 'blue' | 'warm';
export type LibraryPreferences = {
  appearance: Appearance;
  colorPalette: ColorPalette;
  lightAppearance: LightAppearance;
  density: 'comfortable' | 'compact';
  view: 'list' | 'grid';
  sidebar: 'expanded' | 'collapsed';
};

const defaults: LibraryPreferences = { appearance: 'blue', colorPalette: 'original', lightAppearance: 'blue', density: 'comfortable', view: 'list', sidebar: 'expanded' };
const defaultValue = JSON.stringify(defaults);
const sharedAppearanceKey = 'library-appearance';
const sharedLightKey = 'library-light-appearance';
const pendingAppearanceKey = 'library-pending-appearance';
const pendingPaletteKey = 'library-pending-palette';
const temporaryValues = new Map<string, string>();
const preferenceEvent = 'library-preferences-change';

function readValue(key: string): string | null {
  try { return temporaryValues.get(key) ?? window.localStorage.getItem(key); }
  catch { return temporaryValues.get(key) ?? null; }
}

function writeValue(key: string, value: string) {
  try { window.localStorage.setItem(key, value); temporaryValues.delete(key); }
  catch { temporaryValues.set(key, value); }
}

function removeValue(key: string) {
  temporaryValues.delete(key);
  try { window.localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

function readAppearance(): Appearance {
  const value = readValue(sharedAppearanceKey);
  return value === 'warm' || value === 'night' ? value : 'blue';
}

function readLightAppearance(): LightAppearance {
  return readValue(sharedLightKey) === 'warm' ? 'warm' : 'blue';
}

function saveSharedAppearance(appearance: Appearance, lightAppearance?: LightAppearance) {
  writeValue(sharedAppearanceKey, appearance);
  if (appearance !== 'night') writeValue(sharedLightKey, appearance);
  else if (lightAppearance) writeValue(sharedLightKey, lightAppearance);
}

export function setSharedAppearance(appearance: Appearance, lightAppearance?: LightAppearance) {
  saveSharedAppearance(appearance, lightAppearance);
  window.dispatchEvent(new Event(preferenceEvent));
}

function parsePreferences(value: string): LibraryPreferences {
  try {
    const parsed = JSON.parse(value) as Partial<LibraryPreferences> | null;
    const appearance = parsed?.appearance === 'warm' || parsed?.appearance === 'night' ? parsed.appearance : 'blue';
    return {
      appearance,
      colorPalette: ['ocean', 'forest', 'lavender', 'rose', 'slate'].includes(parsed?.colorPalette ?? '') ? parsed!.colorPalette! : 'original',
      lightAppearance: parsed?.lightAppearance === 'warm' || (!parsed?.lightAppearance && appearance === 'warm') ? 'warm' : 'blue',
      density: parsed?.density === 'compact' ? 'compact' : 'comfortable',
      view: parsed?.view === 'grid' ? 'grid' : 'list',
      sidebar: parsed?.sidebar === 'collapsed' ? 'collapsed' : 'expanded',
    };
  } catch { return defaults; }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(preferenceEvent, onChange);
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(preferenceEvent, onChange); };
}

export function useSharedAppearance() {
  const appearance = useSyncExternalStore(subscribe, readAppearance, () => 'blue' as Appearance);
  function toggleAppearance() {
    const next = appearance === 'night' ? readLightAppearance() : 'night';
    writeValue(pendingAppearanceKey, next);
    setSharedAppearance(next);
  }
  return { appearance, toggleAppearance };
}

export function useLibraryPreferences(userId: string) {
  const key = `library-preferences:${userId}`;
  const getSnapshot = useCallback(() => {
    const saved = readValue(key);
    return saved ?? JSON.stringify({ ...defaults, appearance: readAppearance(), lightAppearance: readLightAppearance() });
  }, [key]);
  const serialized = useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);
  useEffect(() => {
    const pending = readValue(pendingAppearanceKey);
    const palette = readValue(pendingPaletteKey);
    const validAppearance = pending === 'blue' || pending === 'warm' || pending === 'night';
    const validPalette = palette === 'original' || palette === 'ocean' || palette === 'forest' || palette === 'lavender' || palette === 'rose' || palette === 'slate';
    if (!validAppearance && !validPalette) return;
    removeValue(pendingAppearanceKey);
    removeValue(pendingPaletteKey);
    const current = parsePreferences(getSnapshot());
    const appearance = validAppearance ? pending : current.appearance;
    const next: LibraryPreferences = { ...current, appearance, colorPalette: validPalette ? palette : current.colorPalette, lightAppearance: appearance === 'night' ? current.lightAppearance : appearance }; 
    writeValue(key, JSON.stringify(next));
    saveSharedAppearance(next.appearance, next.lightAppearance);
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key, getSnapshot]);
  const preferences = parsePreferences(serialized);
  function updatePreferences(update: Partial<LibraryPreferences>) {
    const current = parsePreferences(getSnapshot());
    const next = { ...current, ...update };
    if (update.appearance && update.appearance !== 'night') next.lightAppearance = update.appearance;
    writeValue(key, JSON.stringify(next));
    if (update.appearance) saveSharedAppearance(next.appearance, next.lightAppearance);
    window.dispatchEvent(new Event(preferenceEvent));
  }
  return { preferences, updatePreferences };
}
