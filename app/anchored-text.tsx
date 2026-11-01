'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export type TextAnchor = { id: string; offset: number };
export type Chapter = { title: string; page: number; anchor?: string };
export type ChapterJump = { page: number; anchor?: string; sequence: number };

/** Render plain text and place a safe marker at the selected EPUB fragment. */
export function AnchoredText({ text, anchors, target }: { text: string; anchors?: TextAnchor[]; target?: ChapterJump | null }) {
 const marker = useRef<HTMLSpanElement>(null);
 const offset = target?.anchor ? anchors?.find(item => item.id === target.anchor)?.offset : undefined;
 useEffect(() => { if (offset !== undefined) marker.current?.scrollIntoView({ block: 'start' }); }, [offset, target?.sequence]);
 const chunks = text.split(/(\n{2,})/); let position = 0, placed = false;
 const paragraphs: ReactNode[] = [];
 let lastTextIndex = chunks.length - 1;
 while (lastTextIndex >= 0 && (!chunks[lastTextIndex] || /^\n{2,}$/.test(chunks[lastTextIndex]))) lastTextIndex--;
 for (let index = 0; index < chunks.length; index++) {
  const chunk = chunks[index], start = position; position += chunk.length;
  if (/^\n{2,}$/.test(chunk) || !chunk) continue;
  if (offset !== undefined && !placed && (offset < position || index === lastTextIndex)) {
   placed = true;
   const at = Math.max(0, Math.min(chunk.length, offset - start));
   paragraphs.push(<p key={index}>{chunk.slice(0, at)}<span ref={marker}/>{chunk.slice(at)}</p>);
  } else paragraphs.push(<p key={index}>{chunk}</p>);
 }
 return <>
  {target?.anchor && offset === undefined && <p role="status">The exact location of this chapter was not found.</p>}
  {paragraphs}
 </>;
}
