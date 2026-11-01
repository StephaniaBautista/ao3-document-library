/** Coalesce nearby changes, serialize saves and flush pending work on exit. */
export function createDeferredProgressWriter(send, onError, delay = 500) {
 let pending = null, timer = null, queue = Promise.resolve();
 function flush() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (pending !== null) {
   const value = pending; pending = null;
   queue = queue.then(() => send(value)).catch(error => { onError(error, value); });
  }
  return queue;
 }
 return {
  schedule(value) {
   pending = value;
   if (timer !== null) clearTimeout(timer);
   timer = setTimeout(() => { void flush(); }, delay);
  },
  flush,
 };
}

// A reader can reopen before the previous component's last save finishes.
const closingWrites = new Map();
export function trackClosingProgress(storyId, completion) {
 closingWrites.set(storyId, completion);
 const clear = () => { if (closingWrites.get(storyId) === completion) closingWrites.delete(storyId); };
 void completion.then(clear, clear);
}
export async function waitForClosingProgress(storyId) {
 await closingWrites.get(storyId);
}
