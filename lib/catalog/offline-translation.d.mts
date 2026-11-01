export type OfflineSpan = { text: string; width: number; height: number; top: number; left: number; font: string };
export function needsTranslation(text: string): boolean;
export function splitForTranslation(text: string, max?: number): string[];
export function groupLayoutSpans(spans: OfflineSpan[]): { indices: number[]; text: string }[];
export function distributeTranslation(text: string, indices: number[], spans: OfflineSpan[]): string[];
