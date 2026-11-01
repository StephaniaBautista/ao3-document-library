export function createDeferredProgressWriter<T>(send: (value: T) => Promise<void>, onError: (error: unknown, value: T) => void, delay?: number): { schedule(value: T): void; flush(): Promise<void> };
export function trackClosingProgress(storyId: string, completion: Promise<void>): void;
export function waitForClosingProgress(storyId: string): Promise<void>;
