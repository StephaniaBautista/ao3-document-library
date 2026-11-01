# Document library

Shared library for reading PDF, EPUB and HTML as browser-translatable text. Signed-in users with a verified email and adult declaration can import individual files or ZIP archives. The uploader detects AO3 metadata and uses the fandom to find or create a root folder; missing or ambiguous fandoms remain in the main library. Moderators can move works, and the administrator can assign moderators. The reader restricts ordinary copying and does not expose the original through the catalog download route. Browser-based restrictions cannot prevent screenshots or extraction from a reader's device.

The administrator can connect Google Drive and explicitly import selected folders into the shared catalog; those works are visible to other catalog readers. Each selected job advances only while its import dialog is open, and previously queued jobs do not resume until selected and continued. Drive requires separate OAuth configuration. The new interface does not use a paid translation API. The reader calls the isolated extraction service for each page; scanned PDF pages require Xiaomi OCR. The current development stack still uses local D1 and R2 emulators; migrating production storage to a VPS database and filesystem remains separate work. Original documents remain in storage for extraction. Conversion currently returns text and does not reproduce embedded images or exact PDF formatting. ZIP archives are indexed without loading the entire archive into memory and documents are imported one by one. A selection is limited to 50,000 archive entries, 20 GB expanded, and 50 MB per document; unsupported or oversized documents are reported. Keep the browser tab open during import. Failed documents can be retried from the result without resending successful documents while the tab remains open; after closing or reloading it, select the ZIP again and the server will identify existing works. Upload requests use PUT so the framework does not treat the file as a progressive form action. Local accounts and documents are independent of any published site.

Signed-in readers can use private collections, reading progress, notes and bookmarks, save AO3 kudo or comment reminders, and submit author removal requests. Moderators can review requests and administrators can decide them. The scheduled Worker checks AO3 and queues recovery emails; account verification, password reset and AO3 notifications require a working Postmark setup, and scheduled checks must be enabled in the deployed environment. Existing EPUB reading positions and bookmarks from the former reader cannot always be mapped automatically to the HTML reader; the original records are preserved until a new position is saved.

Readers can also add PDF and EPUB files under **Mi biblioteca → Archivos locales**. These files and their reading positions stay in the current browser profile and are not shared or synchronized unless the reader explicitly chooses **Hacer pública** for a file. That action publishes a copy to the shared catalog, where everyone with access to the library can read it, while retaining the local copy. Browser storage can be cleared or evicted; it is not an encrypted vault and other users of the same browser profile may access it. Local PDFs require selectable text; scanned pages have no local OCR. Files are limited to 50 MB. This separate local-file reader still requires the online app to load.

From that local-files screen, a signed-in reader can connect their own Google account and import a Drive folder, including its subfolders, directly into the current browser. The default keeps files local; the reader may explicitly choose to also publish the imported files to the shared catalog. The OAuth refresh token is encrypted in the server database and stored separately from the administrator's shared-catalog connection. Google requests read-only access to all files available to the connected account. Up to 50,000 entries and 10,000 folders can be processed in one import; individual PDF and EPUB files are limited to 50 MB. Keep the page open; duplicates and unconfirmed publications are counted, and interrupted imports can be started again. Check the catalog before retrying a publication whose result was not confirmed. Disconnecting or deleting the account attempts to revoke the Google grant before removing the stored private credential. If revocation fails, the credential remains available for a retry and account deletion stops. A Google grant disconnected before this change must still be reviewed in the Google account's connections settings.

The reader's **Save offline** action prepares every page of a catalog story in this browser, either in the original language or translated from English to Spanish. New saved stories and interrupted preparations do not require a password and are stored unencrypted in the browser profile. Previously encrypted stories can be unlocked once with their original password, after which they are saved without encryption. Previously encrypted incomplete preparations are preserved but are not resumed; a new preparation starts separately. The offline screen works without the server, including after restarting the browser. Translated stories can be exported offline as HTML, PDF, or EPUB. PDF and fixed-layout EPUB preserve the saved page geometry; compatible EPUB readers are needed for fixed-layout pages. Exports contain the translated text and are not encrypted. Browser storage can be cleared by the browser or its user, and others using the same browser profile may access saved stories. Preparation requires connectivity and a working extractor and translator. PDF text layout is retained where available, but embedded images are not preserved.

For local English-to-Spanish translation, run `python3 scripts/setup-translation-local.py` once, then start `python3 scripts/start-translation-local.py` alongside the extractor and web app. This installs the pinned Argos model and a separate Python environment in `.sites-runtime`; it does not use a paid API. The translation service binds to loopback on port 8766 and authenticates using `EXTRACTOR_TOKEN`. The application uses this address automatically only when the extractor is configured on localhost. For nonlocal deployments the Worker needs `LOCAL_TRANSLATION_URL` pointing to the configured HTTPS service; the service must be placed behind an authenticated HTTPS proxy, with the same token, and tested for that environment. The translation model and service are not deployed automatically.

The reader offers font, size, spacing and sepia preferences for reflowable text, plus a chapter index for EPUB navigation entries that target a spine section or an anchor inside it. Missing fragment targets are reported in the reader. Fixed-layout PDFs retain their original layout. The catalog filters accept up to ten included and ten excluded terms, one per line; matching is partial and depends on extracted metadata. Paid translation remains disabled in the current Worker.

## Requirements

- Node.js 22.13.0 or newer.
- pnpm 11.25.0 (the version in `packageManager`). You can use Corepack: `corepack pnpm --version`.

## Set up a new local installation

Install the locked dependencies and generate a private local authentication secret:

```sh
pnpm install --frozen-lockfile
node -e "const fs=require('fs'); if(fs.existsSync('.dev.vars')) throw Error('.dev.vars already exists; preserve it'); fs.writeFileSync('.dev.vars','BETTER_AUTH_SECRET='+require('crypto').randomBytes(48).toString('base64url')+'\nBETTER_AUTH_URL=http://127.0.0.1:5173\n',{mode:0o600})"
pnpm build
```

On a **new, empty** local database, apply the migrations once, in order:

```sh
for migration in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration"
done
```

For an existing installation, apply only migrations that have not already been applied, in order. The current local installation has been migrated through `0037`; inspect the target database before running any migration again. Keep `.wrangler/state` to retain local accounts and documents, and keep `.dev.vars` private and stable so sessions remain valid. These files are ignored by Git.

## Start locally

```sh
pnpm dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/), choose **Create an account**, and register with an email address and password of at least 12 characters. Then you can sign in and out normally. Stop the server with `Ctrl+C` in its terminal.

`BETTER_AUTH_URL` in `.dev.vars` must match the address used in the browser. If you change the port with `pnpm dev --port 5174`, update the URL in `.dev.vars` to `http://127.0.0.1:5174` and restart the server. Use the configured hostname exactly (`localhost` and `127.0.0.1` are different origins).

Access to the shared catalog requires a verified email address and an explicit declaration that the user is at least 18. The declaration is not an independent age or identity check; the application does not request an identity document or date of birth. Existing verified profiles remain usable. The single administrator is selected by setting `LIBRARY_ADMIN_USER_ID` to the exact existing account ID; no account is automatically assumed to be the administrator. The old Stripe data-redaction path remains only for any legacy profiles with a stored verification ID, so their provider data is not orphaned during account deletion; those exceptional deletions still require the previous Stripe credential and a supported provider session state.

The application supports Brevo for account verification, password reset and AO3 recovery notifications. Once Brevo has enabled transactional sending and verified the sender, add these server-side values to `.dev.vars`:

```sh
BREVO_API_KEY=<brevo-api-key>
BREVO_FROM_EMAIL=<verified-sender-email>
BREVO_FROM_NAME=Biblioteca
```

Set `REMOVAL_REQUEST_EMAIL` to the address that should receive withdrawal requests. The message includes the requester, story, explanation, evidence links, and attached images. Requests remain in the review panel; provider acceptance does not guarantee inbox delivery. Unconfigured or rate-limited messages remain pending for the scheduled worker; an uncertain provider result is not automatically retried to avoid duplicates. Configure this variable and scheduled checks separately in each deployed environment.

Keep the key private; never commit `.dev.vars`. Restart the server after changing it. Partial Brevo configuration disables sending rather than silently falling back to another provider. If no Brevo values are set, existing Postmark configuration continues to work during migration. Accounts must verify their email before signing in; verification and reset links expire after one hour. Resetting a password revokes existing sessions. In local development links point to `BETTER_AUTH_URL`, so they can only be opened on the computer running the application.

To test the Brevo integration without changing stored reminders, run `node scripts/test-reminder-email.mjs your-own-address@example.com` once. The message is clearly marked as a test, includes synthetic kudo and comment data, and does not assert that AO3 is up. Provider acceptance is not proof of inbox delivery; check the recipient inbox and Brevo delivery events. If the outcome is unknown, inspect provider logs before retrying to avoid duplicate messages.

Brevo may require account and transactional-sending approval, and a verified sender or authenticated domain. If a message cannot be sent, registration may leave an unverified account; use **Resend verification email** on the sign-in page after correcting delivery. Existing documents associated with the former simulated or ChatGPT identity remain stored but are not automatically assigned to new accounts.

For public deployment, configure a secure HTTPS URL, a separate secret and Brevo credentials, then review the hosting access policy and rate limits. The currently published site is not updated by local changes.

## Other commands

- `pnpm build`: build the application.
- `pnpm lint`: run ESLint.
- `pnpm exec tsc --noEmit`: check types.
- `node --test tests/*.test.mjs`: run compatibility tests.
- `pnpm exec tsx --test tests/*.test.mts`: run the TypeScript extraction and OCR integration tests.
- `python3 -m unittest discover -s services/extractor -p 'test_*.py'`: run the extractor tests after installing its dependencies.
- `pnpm audit --prod`: review production dependency advisories.
- `pnpm db:generate`: generate a migration after schema changes; review it before applying it.

`pnpm-workspace.yaml` preserves the overrides and blocks dependency installation scripts until explicitly reviewed. See [SECURITY-DEPENDENCIES.md](SECURITY-DEPENDENCIES.md) for the remaining dependency advisory.

## Additional integrations

The shared catalog and age gate are under active development. The following server-side values must be configured separately; never commit them:

- `LIBRARY_ADMIN_USER_ID`: the single administrator. `STRIPE_IDENTITY_SECRET_KEY` is only needed to delete any legacy provider verification data, not for new access.
- `GOOGLE_TRANSLATE_API_KEY`: Cloud Translation. OCR uses Xiaomi-OCR-0 and does not use Google Vision.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `DRIVE_TOKEN_ENCRYPTION_KEY`: Google Drive connection. The encryption key must be a stable base64 encoding of 32 random bytes; changing or losing it makes saved Drive credentials unreadable. Register `/api/admin/drive/callback` on the exact HTTPS application origin. The Drive integration uses read-only consent.
- `EXTRACTOR_URL` and `EXTRACTOR_TOKEN`: the isolated metadata extraction service in `services/extractor/`. Use a random token of at least 32 characters, configure the same value on the service, and set the service's `LIBRARY_ORIGIN` to the exact public origin from `BETTER_AUTH_URL` (for example `https://library.example`). HTTPS is required outside localhost. The service retrieves large originals through short-lived, story-specific signed requests. Its temporary files and extraction process consume deployment resources; provision the instance accordingly and verify its timeout and memory limits.
- Deploy the matching extractor version before the Worker: resumable translation uses its `/extract-range` and `/extract-range-from-url` endpoints. Each request extracts a bounded group of pages or EPUB sections; large originals are still downloaded to temporary storage per request.
- Xiaomi OCR runs through the extractor and a **local-only** OpenAI-compatible inference server on the same host or shared network namespace. Start the official model with `vllm serve xiaomi-research/Xiaomi-OCR-0 --host 127.0.0.1 --port 8000 --max-model-len 16384` (or the compatible SGLang server described by [Xiaomi](https://github.com/xiaomi-research/Xiaomi-OCR-0)). Set `XIAOMI_OCR_LOCAL_URL=http://127.0.0.1:8000/v1` and `XIAOMI_OCR_MODEL=xiaomi-research/Xiaomi-OCR-0` in the extractor environment. For Apple Silicon local development, Xiaomi also documents an experimental Ollama conversion: `ollama pull longwayxu/xiaomi-ocr-0:bf16`, `XIAOMI_OCR_LOCAL_URL=http://127.0.0.1:11434/v1`, `XIAOMI_OCR_MODEL=longwayxu/xiaomi-ocr-0:bf16`. Both model and extractor must be running. The extractor's public-facing endpoint requires `EXTRACTOR_TOKEN` and HTTPS outside localhost; do not expose the inference server publicly. A local image and a scanned-PDF page have been tested with the experimental Ollama conversion. Production still requires compatible hardware, deployment and end-to-end testing with the chosen inference runtime. Whole-page OCR may make errors, including omissions; output that reaches the token limit is rejected rather than silently saved as complete.
- Brevo credentials provide account and recovery emails; existing Postmark values remain a fallback until Brevo is configured.

### Starting the local Xiaomi OCR service

The local runtime prepared for this project is stored in `.sites-runtime/xiaomi` (ignored by Git). Start it in a separate terminal:

```sh
python3 scripts/start-xiaomi-local.py
```

On first use, the script adds a private local extractor URL and random token to `.dev.vars` if they are absent. Restart `pnpm dev` afterward so the application reads those settings. It refuses to overwrite a different extractor URL and runs both services on loopback only. Keep this terminal running while processing scanned files; stop both services with Ctrl+C. To recreate the Python environment, run `python3 -m venv .sites-runtime/xiaomi-venv` and `.sites-runtime/xiaomi-venv/bin/pip install -r services/extractor/requirements.txt`. The local runtime and the `longwayxu/xiaomi-ocr-0:bf16` model must also be installed in `.sites-runtime/xiaomi`; see [Xiaomi's Ollama instructions](https://github.com/xiaomi-research/Xiaomi-OCR-0/blob/main/OLLAMA.md). This local setup is separate from deployment for public users.

Production credentials, service approval, API access, scheduled triggers, actual Drive folder permissions, and provider end-to-end tests remain necessary before launch. The scheduled worker processes metadata when the extractor is configured; the browser also provides a fallback while an administrator has the library open. Large uploads and Drive downloads use bounded multipart transfers; the current application accepts up to 10,000 parts of at most 64 MiB each, while R2 and the deployment impose their own limits. Large-document background extraction requires the service configuration above. Scanned PDF pages are rendered individually and sent to the local Xiaomi-OCR-0 model through the extractor; the browser is a fallback. Processing success depends on the model, memory, time and temporary storage.

When an administrator removes a story, its catalog entry disappears immediately and the background worker retries deletion of its stored object if storage is unavailable. The administrator can see the number of pending deletions and retry them in **Tareas pendientes**. A temporary, opaque key marker is retained for 25 hours after deletion to prevent a previously issued upload ticket from restoring that object; it is removed automatically and does not provide a recycle bin or moderation history. Configure and monitor scheduled triggers so pending object deletions run.

## Security and publication

The application and its reachable Git history should be scanned for secrets immediately before each public release. Never commit `.dev.vars`, environment files, local databases, provider credentials, or screenshots that contain credentials. Git ignore rules are a safeguard, not protection for files already tracked or deliberately force-added. The outer project folder contains local materials that are not part of this Git repository and should be reviewed separately before sharing.

Static responses on Cloudflare use `public/_headers`; dynamic Worker responses apply the same baseline in `lib/security-headers.mjs`. Deployments behind another web server must configure equivalent headers for static assets and HTTPS there. Inline scripts and styles remain permitted for the framework, so CSP is defense in depth, not a substitute for output escaping. The extractor defaults to listening on all interfaces when launched directly; bind it to loopback or a private network and use authenticated, encrypted transport if it is deployed separately.

After changing extractor requirements, rebuild its container or update the local extractor environment and restart the service. Already running services are not changed by editing the requirements file.

## License

The project is distributed under the MIT license; see [LICENSE](LICENSE). Bundled third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
