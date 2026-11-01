'use client';

import type { ReactNode } from 'react';
import { useModalAccessibility } from '@/lib/use-modal-accessibility';
import { Moon, Sun } from 'lucide-react';
import { useSharedAppearance } from '@/lib/library-preferences';

export default function AccessLayout({ children }: { children: ReactNode }) {
  useModalAccessibility();
  const { appearance, toggleAppearance } = useSharedAppearance();
  const dark = appearance === 'night';
  return (
    <main className="access-page" data-appearance={appearance}>
      <button className="access-mode-toggle" type="button" onClick={toggleAppearance} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {dark ? <Sun size={17}/> : <Moon size={17}/>}<span>{dark ? 'Light mode' : 'Dark mode'}</span>
      </button>
      <div className="access-art" aria-hidden="true" />
      <div className="access-content">
        <section className="access-panel" aria-labelledby="access-title">{children}</section>
      </div>
    </main>
  );
}
