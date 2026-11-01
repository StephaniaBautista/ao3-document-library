(() => {
 if (window.location.pathname === '/offline.html') history.replaceState(history.state, '', `/offline${window.location.search}${window.location.hash}`);
 const root = document.documentElement;
 const toggle = document.getElementById('theme-toggle');
 const palettes = ['original', 'ocean', 'forest', 'lavender', 'rose', 'slate'];
 let appearance = root.dataset.theme === 'dark' ? 'night' : 'blue';
 let palette = palettes.includes(root.dataset.palette) ? root.dataset.palette : 'original';
 const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
 const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Changes still apply for this page. */ } };
 const update = () => {
  root.dataset.theme = appearance === 'night' ? 'dark' : 'light';
  root.dataset.palette = palette;
  const label = appearance === 'night' ? 'Light mode' : 'Dark mode';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  document.querySelectorAll('input[name="color-palette"]').forEach(input => { input.checked = input.value === palette; });
 };
 const save = () => write('biblioteca-offline-appearance', JSON.stringify({ appearance, colorPalette: palette }));
 toggle.addEventListener('click', () => {
  appearance = appearance === 'night' ? (read('library-light-appearance') === 'warm' ? 'warm' : 'blue') : 'night';
  write('library-appearance', appearance);
  write('library-pending-appearance', appearance);
  save(); update();
 });
 document.querySelectorAll('input[name="color-palette"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked || !palettes.includes(input.value)) return;
  palette = input.value;
  write('library-pending-palette', palette);
  save(); update();
 }));
 update();
})();
