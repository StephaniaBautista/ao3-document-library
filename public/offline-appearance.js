(() => {
 let preferences = {};
 try { preferences = JSON.parse(localStorage.getItem('biblioteca-offline-appearance') || '{}') || {}; }
 catch { /* Use the default appearance if storage is unavailable or invalid. */ }
 document.documentElement.dataset.theme = preferences.appearance === 'night' ? 'dark' : 'light';
 const palettes = ['ocean', 'forest', 'lavender', 'rose', 'slate'];
 document.documentElement.dataset.palette = palettes.includes(preferences.colorPalette) ? preferences.colorPalette : 'original';
})();
