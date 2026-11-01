export function queueTranslationProgress(jobId: string, save: () => Promise<void>): Promise<void>;
export function waitForTranslationProgress(jobId: string): Promise<void>;
