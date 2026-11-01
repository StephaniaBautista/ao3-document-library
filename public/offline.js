import { pdf as exportPdf, epub as exportEpub } from './offline-export.js';
import { openOffline } from './offline-vault.mjs';
const $ = id => document.getElementById(id);
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/offline-worker.js').catch(() => {});
document.querySelectorAll('.online-link').forEach(link => link.addEventListener('click', event => {
 if (!navigator.onLine) { event.preventDefault(); $('connection-message').hidden = false; }
}));
window.addEventListener('online', () => { $('connection-message').hidden = true; });
const dbRequest = () => new Promise((resolve, reject) => {
 const request = indexedDB.open('biblioteca-offline-v1', 1);
 request.onupgradeneeded = () => request.result.createObjectStore('stories', { keyPath: 'id' });
 request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function transact(mode, action) {
 const db = await dbRequest();
 try { return await new Promise((resolve, reject) => { const tx = db.transaction('stories', mode); const request = action(tx.objectStore('stories')); tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
 finally { db.close(); }
}
function sameBytes(a, b) {
 if (!a || !b || a.byteLength !== b.byteLength) return false;
 const left = new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength), right = new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength);
 return left.every((value, index) => value === right[index]);
}
function sameEnvelope(a, b) {
 return a?.version === b?.version && sameBytes(a?.salt, b?.salt) && sameBytes(a?.iv, b?.iv) && sameBytes(a?.ciphertext, b?.ciphertext);
}
let current = null, position = 0, zoom = 1;
async function showList() {
 $('reader').hidden = true; $('library').hidden = false; $('stories').replaceChildren();
 try {
  const stories = await transact('readonly', store => store.getAll());
  if (!stories.length) { $('status').textContent = 'You have no saved stories yet. Open a story online and choose “Save offline”.'; return; }
  $('status').textContent = '';
  for (const [index, stored] of stories.entries()) {
   const card = document.createElement('article'); card.className = 'story';
   const info = document.createElement('div'); info.className = 'story-info';
   const title = document.createElement('h2'); title.textContent = stored.sealed ? `Protected story ${index + 1}` : (stored.title || 'Saved story');
   const desc = document.createElement('p'); desc.textContent = stored.sealed ? 'Enter the previous password once to remove protection from this saved story.' : (stored.author || 'Ready to read offline.');
   const form = document.createElement('form'); form.className = 'offline-unlock';
   let password;
   if (stored.sealed) {
    const label = document.createElement('label'); label.textContent = 'Previous offline password';
    password = document.createElement('input'); password.type = 'password'; password.required = true; password.autocomplete = 'current-password'; label.append(password); form.append(label);
   }
   const open = document.createElement('button'); open.type = 'submit'; open.className = 'story-open'; open.textContent = stored.sealed ? 'Unlock and read' : 'Read';
   const error = document.createElement('p'); error.setAttribute('role', 'alert'); form.append(open, error);
   form.onsubmit = async event => {
    event.preventDefault(); error.textContent = ''; open.disabled = true;
    try {
     const story = stored.sealed ? await openOffline(stored.sealed, password.value) : stored;
     if (!story || !Array.isArray(story.pages) || !story.pages.length || typeof story.title !== 'string') throw new Error('This saved story is damaged.');
     if (stored.sealed) {
      // Only replace the exact encrypted entry that was opened, preserving newer saves.
      const db = await dbRequest();
      try { await new Promise((resolve, reject) => { const tx = db.transaction('stories', 'readwrite'), store = tx.objectStore('stories'), check = store.get(stored.id); check.onsuccess = () => { if (!check.result || !sameEnvelope(check.result.sealed, stored.sealed)) { tx.abort(); return; } store.put({ ...story, id: stored.id }); }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(new Error('This story changed. Reload and try again.')); }); } finally { db.close(); }
      password.value = '';
     }
     current={...story, id:stored.id}; let saved=0; try { saved=Number(localStorage.getItem(`offline-position:${stored.id}`)) || 0; } catch {} position=Math.max(0,Math.min(saved,current.pages.length-1)); zoom=1; $('library').hidden=true; $('reader').hidden=false; $('title').textContent=current.title; $('author').textContent=[current.author,current.language === 'es' ? 'Automatic translation into Spanish' : ''].filter(Boolean).join(' · '); $('downloads').hidden=current.language!=='es'; render();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : 'Could not open this story.'; }
    finally { open.disabled = false; }
   };
   const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.onclick = async () => { if (!confirm('Delete this saved story from this browser?')) return; try { await transact('readwrite', store => store.delete(stored.id)); try { localStorage.removeItem(`offline-position:${stored.id}`); } catch {} await showList(); } catch { $('status').textContent = 'Could not delete the story.'; } };
   info.append(title, desc, form); card.append(info,remove); $('stories').append(card);
  }
 } catch { $('status').textContent = 'Could not open this browser’s storage.'; }
}
function render() {
 if (!current) return;
 const page = current.pages[position], target = $('page'); target.replaceChildren(); target.className='';
 $('previous').disabled=position===0; $('next').disabled=position===current.pages.length-1; $('position').textContent=`${position+1} / ${current.pages.length}`;
 const font=$('font').value;
 if (page.layout && Array.isArray(page.layout.spans) && (page.layout.spans.length || page.layout.blank)) {
  const layout=page.layout, viewport=$('page-viewport'); const width=Math.min(viewport.clientWidth-16,820)*zoom;
  target.style.width=`${width}px`; target.style.height=`${width*layout.height/layout.width}px`; target.style.minHeight='0';
  const sheet=document.createElement('div'); sheet.className='sheet'; sheet.style.width=`${layout.width}px`; sheet.style.height=`${layout.height}px`; sheet.style.transform=`scale(${width/layout.width})`;
  for(const item of layout.spans) { const span=document.createElement('span'); span.className='span'; span.textContent=item.text; span.style.left=`${item.left}px`; span.style.top=`${item.top}px`; span.style.fontSize=`${item.height}px`; span.style.fontFamily=font==='original' ? (/sans|arial|helvetica/i.test(item.font)?'Arial, sans-serif':'Georgia, serif') : font; span.style.fontWeight=/bold/i.test(item.font)?'bold':'normal'; span.style.fontStyle=/italic|oblique/i.test(item.font)?'italic':'normal'; sheet.append(span); }
  target.append(sheet);
  const canvas=document.createElement('canvas').getContext('2d');
  if(canvas) Array.from(sheet.children).forEach((span,i)=>{canvas.font=getComputedStyle(span).font;const measured=canvas.measureText(layout.spans[i].text).width;if(measured>0)span.style.transform=`scaleX(${layout.spans[i].width/measured})`;});
 } else { target.className='reflow'; target.style.width=''; target.style.height=''; target.style.minHeight=''; target.style.fontFamily=font==='original'?'Georgia, serif':font; target.style.fontSize=`${19*zoom}px`; target.textContent=page.text; }
}
function move(delta){if(!current)return; position=Math.max(0,Math.min(current.pages.length-1,position+delta)); try{localStorage.setItem(`offline-position:${current.id}`,String(position));}catch{/* Reading can continue even if progress cannot be saved. */} render(); $('page-viewport').scrollLeft=0; window.scrollTo({top:0,behavior:'smooth'});}
function escapeText(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function safeNumber(value, fallback=0){return Number.isFinite(Number(value))?Math.max(0,Math.min(10000,Number(value))):fallback;}
function downloadStory(){
 if(!current || current.language!=='es')return;
 const sheets=current.pages.map(page=>{
  if(!page.layout?.spans?.length && !page.layout?.blank)return `<article class="text-page">${escapeText(page.text)}</article>`;
  const {layout}=page,w=safeNumber(layout.width,595)||595,h=safeNumber(layout.height,842)||842;
  const lines=layout.spans.filter(item=>item.text.trim()).map(item=>{const font=/sans|arial|helvetica/i.test(item.font)?'sans-serif':'serif';const weight=/bold/i.test(item.font)?'bold':'normal';const style=/italic|oblique/i.test(item.font)?'italic':'normal';return `<text x="${safeNumber(item.left)}" y="${safeNumber(item.top)}" dominant-baseline="hanging" font-family="${font}" font-size="${safeNumber(item.height,12)}" font-weight="${weight}" font-style="${style}" textLength="${safeNumber(item.width,1)||1}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escapeText(item.text)}</text>`;}).join('');
  return `<article class="pdf-page"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Story page">${lines}</svg></article>`;
 }).join('');
 const title=escapeText(current.title);
 const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#eee;color:#282222;font-family:Georgia,serif}header{position:sticky;top:0;background:#fff;padding:12px 20px;font:14px sans-serif;border-bottom:1px solid #ddd}button{padding:8px 12px;cursor:pointer}main{max-width:820px;margin:20px auto}.pdf-page,.text-page{background:white;margin:0 0 16px;box-shadow:0 1px 6px #0002}.pdf-page svg{display:block;width:100%;height:auto}.text-page{padding:8%;white-space:pre-wrap;overflow-wrap:anywhere;font:19px/1.8 Georgia,serif}@media print{header{display:none}body{background:white}main{width:100%;max-width:none;margin:0}.pdf-page,.text-page{box-shadow:none;margin:0;break-after:page}.pdf-page svg{max-height:100vh}}</style></head><body><header lang="en"><strong>${title}</strong> · Automatic translation <button type="button" onclick="window.print()">Print or save as PDF</button></header><main>${sheets}</main></body></html>`;
 const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${current.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'story'} - Spanish.html`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('download').onclick=downloadStory;
async function downloadFormat(format) {
 if (!current || current.language !== 'es') return;
 const buttons = ['download', 'download-pdf', 'download-epub'].map($);
 buttons.forEach(button => { button.disabled = true; });
 $('download-status').textContent = `Preparing ${format.toUpperCase()}…`;
 try {
  const { blob, filename } = await (format === 'pdf' ? exportPdf(current) : exportEpub(current));
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $('download-status').textContent = 'Download ready.';
 } catch (error) { $('download-status').textContent = error instanceof Error ? error.message : 'Could not prepare the file.'; }
 finally { buttons.forEach(button => { button.disabled = false; }); }
}
$('download-pdf').onclick = () => void downloadFormat('pdf');
$('download-epub').onclick = () => void downloadFormat('epub');
$('back').onclick=()=>{current=null;void showList();}; $('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('font').onchange=render;$('smaller').onclick=()=>{zoom=Math.max(.7,zoom-.1);render();};$('larger').onclick=()=>{zoom=Math.min(2,zoom+.1);render();};window.addEventListener('resize',render);void showList();
