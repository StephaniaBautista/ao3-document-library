# Third-party notices

The project license applies to the project's own code. Third-party components
retain their respective licenses, including:

- `public/pdf.worker.min.mjs` is part of Mozilla's PDF.js project, copyright
  Mozilla Foundation, and is provided under the Apache License 2.0. Its license
  notice is embedded in the file; the full license is in
  `vendor/pdfjs-APACHE-2.0.txt`.
- The vendored shadcn styles and UI components are covered by the MIT license
  in `vendor/shadcn-tailwind-4.13.0.LICENSE.md`.
- The offline export uses `pdf-lib`, licensed under MIT; see `vendor/pdf-lib-MIT.txt`.
- The export bundle includes JSZip (MIT or GPLv3); see `vendor/jszip-LICENSE.md` and `public/offline-export.js.LEGAL.txt`.
- Noto fonts are distributed under the SIL Open Font License; see `public/reader-fonts/LICENSE.txt`.
- The `@pdf-lib/fontkit` npm package declares MIT but does not ship a full license and notice file. Its bundled dependencies require further notice verification before redistribution; see https://github.com/Hopding/pdf-lib/issues/1793.
- `scripts/vite/sites-vite-plugin.ts` is covered by the MIT license in
  `scripts/vite/sites-vite-plugin.LICENSE`.

Installed dependencies have their own license notices in their packages.
