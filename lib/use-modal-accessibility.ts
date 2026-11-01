'use client';
import { useEffect } from 'react';

/** Keep keyboard focus inside the active modal and restore it after closing. */
export function useModalAccessibility() {
 useEffect(() => {
  let active: HTMLElement | null = null;
  let previous: HTMLElement | null = null;
  const controls = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
  const update = () => {
   const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop [role="dialog"], .folio-overlay [role="dialog"]'));
   const next = dialogs.at(-1) || null;
   if (next === active) return;
   if (next) {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active = next;
    const first = next.querySelector<HTMLElement>('[autofocus]') || controls(next)[0];
    first?.focus();
   } else {
    active = null;
    if (previous?.isConnected) previous.focus();
    previous = null;
   }
  };
  const keydown = (event: KeyboardEvent) => {
   if (!active) return;
   if (event.key === 'Tab') {
    const elements = controls(active), first = elements[0], last = elements[elements.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
   } else if (event.key === 'Escape') {
    const close = active.querySelector<HTMLElement>('[aria-label="Close"], [aria-label="Cerrar"]') || Array.from(active.querySelectorAll<HTMLButtonElement>('button[type="button"]')).find(button => ['Cerrar', 'Cancelar', 'Cancel'].includes(button.textContent?.trim() || ''));
    if (close) { event.preventDefault(); close.click(); }
   }
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', keydown);
  update();
  return () => { observer.disconnect(); document.removeEventListener('keydown', keydown); };
 }, []);
}
