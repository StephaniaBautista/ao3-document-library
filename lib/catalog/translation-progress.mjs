// Each job represents one user's translation of a story into one language.
// A newly opened reader must see any save started by the previous reader.
const pending = new Map();

export function queueTranslationProgress(jobId, save) {
 const previous = pending.get(jobId) || Promise.resolve();
 const current = previous.catch(() => {}).then(save);
 pending.set(jobId, current);
 const clear = () => { if (pending.get(jobId) === current) pending.delete(jobId); };
 void current.then(clear, clear);
 return current;
}

export async function waitForTranslationProgress(jobId) {
 await pending.get(jobId);
}
