# Isomo Tea

Isomo Tea is a responsive, anonymous community messaging experience for Isomo Academy. The existing React/Capacitor application includes Supabase-backed scholar and administrator authentication, persistent General Tea and private conversations, and source implementations for media, polls, mentions, stickers, moderation, and account deletion. The newer migrations and Edge Functions have not been applied/deployed or live-tested from this workspace. **Do not treat those paths as available against the hosted project until deployment and multi-account verification.**

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite listens on `0.0.0.0` so the same server can be reached from a local network. The development server is for local development only.

Useful commands:

```powershell
npm run typecheck
npm run lint
npm run build
npm run preview
```

`npm run preview` serves the production build locally after `npm run build`.

## Mobile preview

The interface uses a dedicated mobile navigation and chat layout. To preview it in Chrome:

1. Open the local URL above.
2. Press F12 (or Ctrl+Shift+I).
3. Toggle the device toolbar with Ctrl+Shift+M.
4. Choose a device preset such as Pixel and rotate or resize it as needed.

### Open on an Android phone over Wi-Fi

1. Connect the phone and computer to the same Wi-Fi network.
2. Start the server with `npm run dev`.
3. In PowerShell, run `ipconfig` and find the computer's IPv4 address under the active Wi-Fi adapter.
4. On the phone, open `http://YOUR_COMPUTER_IPV4:5173` (replace the example address).
5. If it does not load, allow Node.js or TCP port 5173 through the computer's private-network firewall profile. Do not expose the dev server to an untrusted public network.

`localhost` on the phone refers to the phone itself, not the computer.

## Installable browser app (PWA)

The production browser build includes a PWA manifest, the 😎 identity icon, and an offline application shell. On supported browsers, **Install this app** opens the browser's native install prompt; if the prompt is unavailable, the sign-in screen shows browser-menu steps. The service worker caches the app shell and local stickers, fetches versioned JavaScript/CSS from the network before using cached copies, and prompts before activating later updates. It does not cache API responses or chat media. Messaging and other server-backed actions still require a network connection.

PWA installation and offline behavior require production hosting over HTTPS (localhost is also accepted for development). A production build is served with `npm run preview`.

### Deploy to Vercel

The root [`vercel.json`](./vercel.json) selects Vite, builds with `npm run build`, serves `dist`, and routes SPA URLs back to `index.html` so reloading a hosted page does not produce a 404.

1. Push the project root to GitHub. `.env.local` is ignored by Git; do not add real credentials to the repository.
2. In Vercel, select **Add New → Project**, import that GitHub repository, and leave **Root Directory** at the repository root.
3. Check that the detected settings are **Vite**, `npm run build`, and `dist`. The checked-in `vercel.json` supplies these values and the SPA fallback.
4. Before deploying, open **Environment Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase. Never add a service-role key or any other privileged credential as a `VITE_` variable. Add `VITE_ANDROID_APK_URL` only after a signed release APK is published at a stable, public HTTPS download URL. `VITE_ANDROID_APK_VERSION` and `VITE_ANDROID_APK_SIZE` are optional button labels.
5. Click **Deploy**. Vercel builds the project and provides an HTTPS URL. Open it, test sign-in, and reload the page. Pushes to the connected production branch trigger a new deployment; pull requests can use their Vercel preview URLs.
6. If the project uses password reset or other redirect-based auth flows, add the production and preview domains to the Supabase Auth URL configuration.
7. Vercel hosts the browser/PWA frontend only; Supabase remains a separate backend. Apply pending Supabase migrations and deploy their Edge Functions separately. Emoji usernames require migration `202611120005_emoji_usernames.sql` after `202611120004_phrase_usernames.sql`, plus updated `scholar-register` and `scholar-login` functions.

The APK download button appears beside **Install this app**. Until `VITE_ANDROID_APK_URL` is configured, it stays disabled and explains that a release link is still needed. Use a public GitHub Release asset or public file host; a private repository URL, local path, or temporary build URL will not work for users. Do not publish the current debug APK as a production release.

Browsers and Windows control whether an install prompt is offered, whether the installed app opens after installation, and whether it is pinned to the taskbar. Isomo Tea can provide accurate pinning instructions but cannot force those operating-system actions. Installed PWAs can use the small reload control beside the sign-in branding.

## Supabase environment configuration (Phase 2)

No Supabase project credentials are included in this repository. The root `.env.local` is ready for your local frontend values; it is ignored by Git. Fill in only the two browser variables below. Do not paste credentials into chat or commit `.env.local`.

### Frontend values — `.env.local`

1. In the Supabase Dashboard, open your project.
2. Set `VITE_SUPABASE_URL` to the **Project URL** shown under **Project Settings → API**.
3. Set `VITE_SUPABASE_ANON_KEY` to a **Publishable key** shown under **Project Settings → API Keys**. A legacy `anon` key is also accepted. This key is intended for browser use with RLS; it is not the service-role or a secret key.
4. Save `.env.local` and restart `npm run dev` so Vite reloads the values.

The variable names in `.env.local` must stay exactly as written. `.env.example` contains safe sample placeholders and can be copied to another developer's `.env.local`; do not enter real values in `.env.example`.

### Edge Function environment — configure on the server, not in `.env.local`

The functions read the following variables:

| Variable | Used for | Where it comes from / action |
|---|---|---|
| `SUPABASE_URL` | Edge Functions connect to this Supabase project | Supabase supplies it automatically to deployed Edge Functions. Do not add it to `.env.local`. |
| `SUPABASE_ANON_KEY` | Edge Functions create the public-auth client for sign-in | Supabase supplies it automatically to deployed Edge Functions. Do not add it to `.env.local`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server-side account, profile, access-code, and role operations | Supabase supplies it automatically to deployed Edge Functions. It is privileged: never expose it in frontend variables, source files, or chat. |
| `AUTH_RATE_LIMIT_PEPPER` | Server-side hashing of client network identifiers for auth rate limiting | **You must generate and configure this one manually** as a Supabase Edge Function secret. Use the PowerShell instructions in “Edge Function deployment” below; do not put the generated value in this repo or share it. |

These are deployment/runtime requirements, not additional frontend `.env.local` entries. Do not copy privileged credentials into Vite configuration.

### Database migration status

The Phase 2 migration `202611110001_phase2_auth_and_core_schema.sql` has been applied in the Supabase SQL Editor, as confirmed by the project owner. **Do not rerun it or run `supabase db push` as part of Edge Function deployment.** The CLI may not know about a migration applied directly in the SQL Editor; do not reconcile or repair migration history without first checking it and confirming the remote schema state.

An active Isomo access-code record must exist before scholar registrations can succeed. After applying the new access-code management migration and deploying its function (below), the first code and replacements can be created through the administrator dashboard—no SQL edits are needed to manage scholar codes.

Authenticated General Tea messaging depends on `supabase/migrations/202611110003_general_chat_realtime.sql` adding `public.messages` to the Supabase Realtime publication. This migration has not been applied to the remote project. Review the remote schema, then apply it once in the SQL Editor; it does not rerun the Phase 2 migration. Chat history/sends and Realtime delivery require a signed-in member with General Tea conversation access. Live behavior has not been verified against the project.

The private member/reply initiation paths depend on `supabase/migrations/202611110004_private_conversations.sql`. It backfills canonical participant pairs, removes the administrator-wide private-conversation read bypass, exposes a caller-bound pair conversation RPC, and restricts administrator indicators to user IDs. Review the remote schema and existing private conversations before applying it once in the SQL Editor. The migration and private-conversation flow have not been applied or live-tested; do not claim private messages work against the project until this migration is applied and tested with multiple accounts.

Persistent message reactions additionally require `supabase/migrations/202611110005_message_reactions.sql`. It adds membership-protected reaction rows and includes their changes in Realtime when the publication is available. Apply it only after reviewing the schema and apply it once; its policies and client behavior have not been tested against the hosted project.

Message editing and per-user/shared-message deletion additionally require `supabase/migrations/202611110006_message_edit_delete.sql`. It grants edits only through author-specific RLS and caller-bound RPCs, and stores "delete for me" state separately from shared tombstones. Apply it after the earlier chat migrations; server behavior has not been live-tested.

Private one-to-one read receipts require `supabase/migrations/202611110008_private_read_receipts.sql`. It exposes a caller-bound RPC that records the server time and publishes membership marker updates for Realtime; General Tea group read receipts are not implemented. Apply it after `202611110004_private_conversations.sql` and test with two accounts.

The expanded administrator dashboard requires `supabase/migrations/202611110007_admin_audit_log.sql` and the `admin-console` Edge Function. It adds server-only audit history and transactional RPCs for administrator invitations/removal, General Tea history clearing, message deletion, and access-code audit events. Apply this migration after `202611110002_admin_access_code_management.sql`, then deploy `admin-console` and redeploy the updated `admin-invite` and `admin-access-codes` functions. These changes have not been applied or live-tested.

Media messaging and secure view-once delivery require `supabase/migrations/202611110009_secure_message_media.sql`, deployed `media-access` and `media-cleanup` Edge Functions, and a recurring cleanup schedule. The migration creates a private 20 MiB storage bucket, membership-checked uploads, restrictive policies that prohibit direct client reads/updates, media metadata, and per-recipient view-once claims. The access function validates membership and streams media with no-store headers; the cleanup function needs a manually configured `MEDIA_CLEANUP_SECRET` and a trusted recurring caller. Review the target project's `storage.objects.metadata` shape (`size` and `mimetype`) before applying the migration. Configure `MEDIA_CLEANUP_SECRET` only in Supabase Edge Function secrets; do not put it in Vite variables. View-once consumption is at-most-once: if the response is interrupted after the server records consumption, the recipient may lose that view. Screenshot/external recording prevention is not guaranteed.

The browser does not persist fetched media, and view-once uploads are excluded from the IndexedDB retry queue (legacy queued view-once files are removed when the queue is restored). A failed view-once upload can only be retried while the sending page remains open.

Polls, voting, in-app mentions, and stickers require `supabase/migrations/202611110010_polls_mentions_stickers.sql`. Apply chat migrations in order so the General Tea Realtime publication exists before this migration adds its tables. Poll votes are visible to conversation members, and mention notifications are in-app only; push notifications and General Tea group read receipts are not implemented.

Private Inbox listing/hiding and self-service account deletion additionally require `supabase/migrations/202611110011_private_inbox_and_account_deletion.sql` and the `account-delete` Edge Function. The endpoint rejects administrator accounts, reauthenticates with the current password, removes the caller's authored messages and media, and preserves the other participant's messages. Deletion spans Storage, Postgres, and Auth and is not atomic; the endpoint reports partial failure for retry/support. The profile requires the exact phrase `DELETE MY ACCOUNT`; administrators must transfer duties before account closure.

Private profile avatars additionally require `supabase/migrations/202611110012_private_profile_avatars.sql` and the current `account-delete` function, which removes avatar objects during account deletion. The migration creates a private bucket with a 5 MiB limit, image MIME allowlisting, signed reads, and per-user upload/delete paths. Profile settings and avatar flows are implemented in source but are not available against the hosted project until the migration is applied and the function redeployed.

Migration `202611110013_filter_hidden_message_media.sql` is a follow-up to 009. It replaces only the metadata-read policy, hiding media metadata when its message is deleted or hidden for the current member. If migration 009 is already applied, apply only migration 013; do not edit or rerun 009. If 009 is not applied, apply 009 first, then 013.

Grouped image albums additionally require the additive migration `202611120001_grouped_media_messages.sql`, which adds a shared media-group ID and a membership-checked image registration RPC. Apply it after migration 009 and before deploying this frontend: message queries select the new column, so an older schema will reject those queries. It has not been applied to the hosted project.

The illustrated sticker pack requires `202611110015_expand_community_stickers.sql` and `202611120002_illustrated_community_stickers.sql` after migration 010. The project owner reports applying `202611120002`; verify its presence before proceeding and do not rerun it. That hosted state has not been independently verified. Sticker deletion now hides the sticker payload when its message is tombstoned, and the picker has a bounded scroll area.

The current group name/photo and username-change announcement require the additive migration `202611120003_community_profile_and_username_events.sql`. It adds a trusted system-event marker, updates `set_my_username` to post a Delta Tea system notice, stores the current group-photo path, creates a private group-photo bucket, adds Realtime to conversation profile updates, and exposes a service-role-only admin RPC. Apply it after migrations 007 and 010, then redeploy the updated `admin-console` Edge Function. Group settings require no new Edge Function. The group-photo replacement cleanup and admin audit behavior have not been verified against the hosted project.

Phrase-style usernames such as `No way out` require the additive migration `202611120004_phrase_usernames.sql` after `202611120003`. It updates the profile constraint, availability RPC, username-change RPC, and mention trigger; mentions containing spaces use the quoted form `@"No way out"`. Deploy the updated `scholar-register` and `scholar-login` Edge Functions as well, since both use the shared username validator. Neither the migration nor those function changes have been deployed or live-tested from this workspace.

Emoji usernames require the additive migration `202611120005_emoji_usernames.sql` after `202611120004`, followed by redeploying the updated `scholar-register` and `scholar-login` Edge Functions. It updates the database username constraint, availability and update RPCs, and server-side mention parser. The web client also highlights mentions with emoji names. The migration and functions have not been applied or deployed to the hosted project.

Chat author names now use stable account-derived colors, and message selection uses fixed gutter checkboxes so bubbles do not shift. On touch-sized screens the message-actions control sits outside the bubble instead of covering its text; desktop hover behavior is unchanged.

Review and apply any remaining migrations only after checking the remote schema and in dependency order; do not rerun migration 001 or run `supabase db push` as part of this source change. New migrations and Edge Function changes have not been deployed or tested against the hosted project. The browser and Android builds share the same configured Supabase backend and do not provide an offline chat backend.

### Phase 2 authentication deployment

The current Phase 2 frontend invokes three Edge Functions:

- `scholar-register` — scholar registration; validates username and access code, creates a Supabase Auth account, and issues a session.
- `scholar-login` — looks up a scholar by username and authenticates the password.
- `admin-login` — authenticates email/password and checks the user's administrator role before returning a session.

`admin-invite` is used by the administrator dashboard and independently verifies the bearer token and administrator role. `admin-console` provides server-authorized member/access management, statistics, General Tea moderation, group-profile updates, history clearing, administrator management, and audit-log retrieval.

Username availability and username changes are **Postgres RPCs**, not Edge Functions: `username_is_available` and `set_my_username`. After migration `202611120003`, an actual username change atomically updates the profile and inserts a non-spoofable system-event message in the group. Access-code validation and authentication rate limiting are also migration-defined RPCs used internally by the functions.

#### Secrets used by deployed functions

Supabase automatically injects these legacy-compatible runtime variables into Edge Functions:

- `SUPABASE_URL` — project API URL.
- `SUPABASE_ANON_KEY` — public key used by the functions for password sign-in.
- `SUPABASE_SERVICE_ROLE_KEY` — privileged key used only server-side for user, profile, access-code, and role operations. Never expose or paste this key into `.env.local`, any `VITE_` variable, source control, or chat.
- `MEDIA_CLEANUP_SECRET` — **must be configured manually** in Supabase Edge Function secrets; protects the cleanup endpoint because its platform JWT verification is disabled for scheduled invocation.

The functions' server-side code expects those names; do not set or copy them manually unless Supabase reports that a platform variable is unavailable.

For the Phase 2 authentication functions, add this custom production secret:

- `AUTH_RATE_LIMIT_PEPPER` — a random secret used to hash client network identifiers before rate-limit records are stored. Generate it locally and set it with the commands below. Never share or commit its value. Supabase supports this secret in the Dashboard under **Edge Functions → Secrets**, or via the CLI.

In addition, configure `MEDIA_CLEANUP_SECRET` before deploying `media-cleanup`. Schedule a trusted caller to POST to `/functions/v1/media-cleanup` with the `x-media-cleanup-secret` header (for example, a secured external scheduler or owner-configured Supabase Cron/pg_net job). The application does not configure or invoke this schedule automatically.

#### Existing Phase 2 deployment

The project owner reports that the first migration and these four functions have already been deployed. Do not redeploy them for the access-code management feature unless their source is deliberately changed.

### Administrator access-code management deployment

Access-code management requires the 002 migration and `admin-access-codes`. The expanded tools also require migration 007 and the `admin-console` function; migration 007 additionally wraps code creation/status changes with audit records. These latest migration/function changes have **not** been applied or deployed.

1. Apply `supabase/migrations/202611110002_admin_access_code_management.sql` and `supabase/migrations/202611110007_admin_audit_log.sql` once in the SQL Editor, after reviewing the schema. They create service-role-only code management/audit functions and audited administrator operations.
2. Deploy `admin-access-codes` and `admin-console`, and redeploy `admin-invite` from the current source. Each function verifies the bearer token and administrator role before actions.

Run these commands from the project root in PowerShell. Use your project ref from the Supabase Dashboard URL (the project ref is the segment in `https://supabase.com/dashboard/project/PROJECT_REF`)—it is not a secret.

If you have not already linked the project in this workspace, authenticate and link it:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

Then deploy the updated administrator functions:

   ```powershell
   npx supabase functions deploy admin-access-codes --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy admin-console --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy admin-invite --project-ref YOUR_PROJECT_REF
   ```

No new secret is required: the functions use Supabase’s injected service-role credential server-side and require an administrator’s session JWT. Existing scholar registration, login, and `AUTH_RATE_LIMIT_PEPPER` configuration are unchanged.

#### Media function deployment

After applying migrations 003–009 and reviewing the Storage metadata layout, configure `MEDIA_CLEANUP_SECRET` in **Edge Functions → Secrets**, then deploy the media functions:

```powershell
npx supabase functions deploy media-access --project-ref YOUR_PROJECT_REF
npx supabase functions deploy media-cleanup --project-ref YOUR_PROJECT_REF
```

`media-access` verifies the user's JWT itself and requires a conversation membership row; only view-once claims are one-time. `media-cleanup` has platform JWT verification disabled and must never be exposed without its secret. No service-role key belongs in frontend code. Test media functions with separate conversation members and a non-member account before considering media live.

#### Account deletion deployment

After applying migrations `202611110011_private_inbox_and_account_deletion.sql` and `202611110012_private_profile_avatars.sql`, deploy the current self-service account deletion endpoint:

```powershell
npx supabase functions deploy account-delete --project-ref YOUR_PROJECT_REF
```

The function uses Supabase-provided server credentials and requires no new secret. It removes the user's stored chat media and profile avatar objects before deleting the account. Verify password reauthentication, administrator rejection, authored-media/avatar cleanup, surviving-peer history, and successful local sign-out with test accounts before enabling account deletion for members.

#### JWT verification settings

`supabase/config.toml` keeps platform JWT verification disabled only for `scholar-register`, `scholar-login`, and `admin-login`, because unauthenticated users cannot provide a valid session before those operations. `admin-invite`, `admin-access-codes`, and `admin-console` have `verify_jwt = true`; each also verifies the caller and administrator role server-side. Deploy using the repository config; do not add `--no-verify-jwt`.

Bootstrap the first administrator by creating/inviting the administrator email account in Supabase Authentication, then inserting its user UUID into `public.administrators` in the SQL editor. Afterward, only an existing administrator can invite another administrator through the guarded `admin-invite` function. There is intentionally no public admin registration.

The regular scholar auth flow asks only for username, password, and access code. The backend creates an internal, non-deliverable `.invalid` auth email so Supabase Auth can store a password securely; this value is generated server-side and never requested from or shown to the scholar.

Run database security tests locally with Docker and the Supabase CLI: `npx supabase start`, then `npx supabase test db`. The tests check RLS, table grants, membership boundaries, and privileged function access. Docker and the Supabase CLI are unavailable in this workspace, so the SQL tests remain pending. Applying migrations 002/007 and deploying the current administrator functions are required before the tools can operate. Live member suspension, invitations, moderation, code rotation, and audit behavior still need project-level verification.

The app is sign-in-first; there is no unauthenticated sample-chat/demo mode. Profile preferences, password changes, notification preferences, and avatar upload are implemented in source. Avatar storage requires migration 012, and all server-backed features still require their listed migrations/functions and live verification.

Database policies and function behavior are documented in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

## Android

The native Capacitor Android project is in `android/`, with app name, application ID, launcher/adaptive icon, splash assets, and keyboard resize behavior configured. MEmu's Android 9 / Chrome 68 WebView has been launch-tested, and the login screen renders. Authenticated messaging, media, and voice still need broader device testing; a browser preview is not a substitute for native testing.

The Android asset sources are in `assets/`. After changing them, regenerate the native resources with `npm run android:assets`; sync the current web build with `npm run android:sync`. In Android Studio, open the project with `npm run android:open`. A debug APK can be built with `.\gradlew.bat assembleDebug` from the `android/` directory after configuring `JAVA_HOME` and `ANDROID_SDK_ROOT`; Gradle writes it to `android\app\build\outputs\apk\debug\app-debug.apk`. This debug APK is not a release build.

To build and sign a release APK consistently into `New folder\built`, run `.\scripts\build-release.ps1 -Version 1.3.0` from the project root. The script syncs the latest web bundle, builds the unsigned release, signs it with `New folder\isomo-tea-release.jks`, verifies the signature, and writes `New folder\built\IsomoTea-1.3.0.apk`. It verifies that the output version matches `versionName` in `android\app\build.gradle`; this release uses `versionCode 4`, `versionName "1.3.0"`. Increment `versionCode` and update `versionName` before future releases. The keystore is ignored by Git, but keep a secure backup and never commit or share it.

Android mention alerts request the device's notification permission from **Profile → Activity notifications** and use local notifications for new mentions received while the app's realtime connection is still active. This does not provide reliable push when the app is closed or disconnected; that requires Firebase/FCM setup and a deployed server-side notification sender.

### APK download button

To enable downloads after publishing a signed release asset, set `VITE_ANDROID_APK_URL` in the Vercel project’s environment variables to its stable direct-download HTTPS URL, then redeploy. `VITE_ANDROID_APK_VERSION` and `VITE_ANDROID_APK_SIZE` can optionally label the button. Until a valid public URL is configured, the button stays disabled with a clear message. The debug APK is for testing and must not be used as a production download.

## Implementation status

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for phase tracking and the boundary between local verification and backend work still to do.
