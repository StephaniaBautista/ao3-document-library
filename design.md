# Design — Document library

## Direction
Modern, understated reading workspace. The app uses a dark navigation rail, a soft cool canvas and a bright document area. No decorative product statistics or sample files.

## Structure
- Sign in: editorial book photograph and a focused account form, without a name or slogan.
- Library: compact navigation, a focused document workspace and one set of creation actions. Appearance, spacing and layout are configurable per account in the browser.
- Reader: dedicated document stage with a focused translation panel.

## Visual system
- Ink: oklch(24% .025 255); muted: oklch(52% .025 255).
- Canvas: oklch(97% .009 255); surfaces: oklch(100% .002 255).
- Navigation: oklch(22% .028 258); accent: oklch(56% .15 253).
- Display: Avenir Next / ui-sans-serif, weight 650. Body: Avenir Next / ui-sans-serif.
- Four-pixel spacing rhythm. Corners are restrained, with soft borders.
- Motion is limited to feedback; respect reduced motion and preserve visible focus.

## Interface principles
Show account identity and sign-out clearly. Make upload and folder creation visible. Use real records only, preserve existing features and make destructive actions explicit. Copy is in English.

## Exports
The canonical color, typography, spacing, radius and motion variables live in `tokens.css`; app CSS imports them. The current site uses plain CSS rather than Tailwind-generated UI, JSON token tooling, or shadcn theme variables.

### Tailwind v4
```css
@theme {
  --color-canvas: oklch(97% .009 255);
  --color-ink: oklch(25% .027 255);
  --color-accent: oklch(54% .15 253);
  --font-display: 'Avenir Next', 'Segoe UI', sans-serif;
  --font-body: 'Avenir Next', 'Segoe UI', sans-serif;
  --spacing-md: 16px;
}
```

### DTCG
```json
{
  "color": {
    "canvas": { "$value": "oklch(97% .009 255)", "$type": "color" },
    "ink": { "$value": "oklch(25% .027 255)", "$type": "color" },
    "accent": { "$value": "oklch(54% .15 253)", "$type": "color" }
  },
  "font": { "body": { "$value": ["Avenir Next", "Segoe UI", "sans-serif"], "$type": "fontFamily" } },
  "space": { "md": { "$value": "16px", "$type": "dimension" } }
}
```

### shadcn/ui variables
```css
:root {
  --background: 97% .009 255;
  --foreground: 25% .027 255;
  --primary: 54% .15 253;
  --primary-foreground: 100% .002 255;
  --muted: 98.5% .006 255;
  --muted-foreground: 53% .022 255;
  --border: 91% .012 255;
  --input: 91% .012 255;
  --ring: 58% .18 253;
  --radius: 10px;
}
```

## Access image

Asset: `public/reading-access.jpg`. Generated with the built-in image generation tool using this prompt:

> Create a refined editorial photograph used as a full-height background image alongside a sign-in form for a document library app. Vertical portrait composition. Close-up of an open physical book resting on a desk, richly detailed folded off-white paper pages, soft natural daylight from an unseen window, subtle shadows, deep muted indigo and slate-blue surroundings with some warm paper tones. Sophisticated modern publishing aesthetic, analog, quiet and tactile; photographic realism, imperfect real paper texture, no people. Intentionally leave the upper third relatively quiet. No words, letters, typography, watermark, logo, icons, interface or collage. This will be cropped vertically to cover a panel, so make the book visually compelling in the middle.
