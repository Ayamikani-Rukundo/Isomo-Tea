# Implementation status

Updated: 2026-11-12

Status meanings: **Not Started**, **In Progress**, **Implemented**, **Tested**, **Verified**. “Implemented” means the source path exists; it does not imply that pending Supabase migrations/functions are deployed or that hosted behavior has been verified.

## Phase 1 — Runnable foundation

| Feature | Status | Notes |
|---|---|---|
| Installable browser app manifest and 😎 icon | Implemented | Browser SVG/PNG icon and native-generated launcher assets use one emoji |
| Offline application shell | Implemented | Network-first navigation/static assets and versioned same-origin JS/CSS with cached fallback; includes the chat wallpaper and local stickers but excludes API and chat media; PWA update activation is user-controlled |
| PWA install prompt | Implemented | Native browser prompt is shown when supported |
| APK download UI | Implemented | Link is enabled only with an HTTPS artifact URL; no APK is currently hosted |
| Capacitor Android project, app label, launcher/adaptive icon, and splash sources | Implemented | `android/` scaffolded and native assets generated from `assets/` |
| Android debug APK build and current web-bundle sync | Verified | `android/app/build/outputs/apk/debug/app-debug.apk` (6,530,846 bytes / 6.23 MiB; SHA-256 `619535ce62b815fb436134669c00ca50d7545d42812c1b7d87b4ad5be1efddf2`; Gradle debug build passed; all 22 current `dist/` files were hash-verified inside the APK) |
| Android device installation, launch, auth, and messaging | Not Started | No Android emulator or physical device is connected; backend behavior remains unverified |
| Vite + React + TypeScript project and npm scripts | Implemented | `npm run dev`, `build`, `lint`, `typecheck`, `preview` |
| Responsive Isomo Tea shell and branding | Implemented | The Delta Tea member directory is the final panel on the right, after the main chat; opening it smoothly collapses the left navigation on desktop, and closing it restores the layout. The floating upper-right theme toggle is removed; the left navigation has a labeled “Dark Mode”/“Light Mode” control, with dark as the default when no preference is saved. The composer fills the chat pane with a compact edge inset. Valid @mentions are highlighted green in message bubbles and mention previews. Reply previews jump to their original message, loading older pages if needed, and briefly highlight the target. When scrolled away from the latest messages, a floating down-arrow returns to the bottom; incoming messages do not pull readers away from older messages. The sticker picker has 48 options, including 16 original illustrated character reactions with Kinyarwanda phrases. The Messages list defaults to 380px and can be resized from 280–500px with pointer or keyboard, with the preference saved locally. The initial Messages screen shows chats without selecting one; users can clear selection or open Delta Tea/new chat from the main pane. The member picker has an explicit Cancel action. Mobile uses the inbox as its chat list and preserves the header return control. Delta Tea uses the supplied circular group image; 80% desktop scale and full-scale mobile bottom navigation are preserved |
| Sign-in-first welcome/auth experience | Implemented | Scholar sign-in, access-code registration, and administrator sign-in; no unauthenticated sample-chat/demo path |
| Authenticated Delta Tea and Private Inbox | In Progress | Signed-in landing opens Chats without auto-selecting a conversation; the current group name/photo now flow through chat lists, the header, and the member panel. Per-device unread counts use a local last-read timestamp (not cross-device group receipts); migration 202611120003 and hosted tests remain pending |
| Member list and profile | In Progress | Authenticated member discovery, profile preferences, password update, avatar upload/replacement/removal, and sign-out are implemented in source; avatar storage migration is pending |
| Light and dark themes | Implemented | Theme choice persists in local storage |
| Local-network development instructions | Implemented | Vite configured to listen on `0.0.0.0` |
| Typecheck and lint | Tested | Latest `npm run typecheck` and `npm run lint` passed after adding reply navigation and illustrated stickers |
| Production build | Tested | `npm run build`, `npm run android:sync`, and Gradle debug build passed; Vite reports a non-blocking >500 kB JavaScript chunk warning |
| Core browser interactions and responsive layout | Tested | Local production preview shows sign-in-first flow; desktop 80% scale verified at 1440px; mobile remains unscaled with no horizontal overflow at 390px. Authenticated navigation and hosted account behavior were not tested. |

## Phase 2 — Supabase authentication and core schema

| Feature | Status | Notes |
|---|---|---|
| Central Supabase client and environment template | Implemented | Uses only the public project URL and anon/publishable key in Vite |
| Scholar registration and login | Implemented | Edge Functions use private synthetic auth emails; require a deployed Supabase project and access code |
| Username uniqueness, availability, suggestions, and changes | In Progress | Normalized database constraint and caller-bound update remain; migration 202611120003 adds a server-generated Delta Tea username-change system notice. The migration is pending and the hosted path is not verified |
| Administrator login and invitation foundation | Implemented | Email/password login; initial role provisioning is owner-only; invitations are administrator-gated |
| Administrator dashboard | In Progress | Access-code management, member suspension, administrator invitations/removal, General Tea moderation/history clearing, statistics, audit UI, and current group name/photo controls are implemented in source; migration 202611120003 and updated `admin-console` deployment/live testing are pending |
| Session restore, logout, protected app, and runtime errors | Implemented | Session restore ignores stale `getSession` results after auth events; rendering errors have a manual recovery screen and async/runtime errors are logged |
| Core tables, RLS, grants, and database security tests | Implemented | Base migration is reported applied by the project owner; pgTAP assertions have not been run from this workspace |
| Typecheck, lint, and production build | Tested | `npm run typecheck`, `npm run lint`, and `npm run build` pass |
| Live auth and RLS verification | Not Started | Requires end-to-end testing against the configured project; local pgTAP requires Docker and Supabase CLI |

**Base Phase 2 deployment is reported complete by the project owner, but its authentication and RLS behavior has not been verified from this workspace.** Registration, duplicate handling, wrong-code rejection, login/logout, session persistence, username changes, unauthorized access, and administrator restrictions still require live tests. The new access-code management migration/function are not yet deployed. Read [README.md](./README.md) for setup steps.

## Later phases

| Phase | Status | Scope |
|---|---|---|
| 3 — Persistent/realtime Delta Tea | In Progress | Authenticated text/replies/reactions/editing/deletion, keyset pagination, optimistic sends/retry, and Realtime synchronization implemented in source; reply previews jump to the original message and highlight it briefly, loading earlier pages when needed. Compact grouped bubbles show timestamps/edit state/ticks inline, with an original tiled chat wallpaper and dismissible message actions. UI label is Delta Tea while the stored conversation kind remains `general`. Apply migrations `202611110003`–`202611110006` and live-test |
| 4 — Persistent private Inbox | In Progress | Member and General Tea reply initiation use the same unique-pair RPC; inbox listing, per-user hiding, existing-conversation opening, and stale-account request guards are implemented. Apply migrations `202611110004`–`202611110006`, `202611110008`, and `202611110011`, then live-test member authorization with multiple accounts |
| 5 — Media and view-once cleanup | In Progress | Image/audio/video uploads, inline media without separate “Photo”/“Audio message” text bubbles, composer-contained media/recording previews, albums, and menu placement that opens downward near the chat header are implemented. Apply migrations 009 and 013 plus `202611120001_grouped_media_messages.sql`; deploy `media-access`/`media-cleanup`, configure the cleanup secret/schedule, and run remote tests before treating media as live. |
| 6 — Administration | In Progress | Access-code, member/admin, moderation, date-range General Tea clearing, stats, and audit interfaces/backend are implemented in source; apply migration `202611110007` and deploy current `admin-console`, `admin-access-codes`, and `admin-invite` functions before use. |
| 7 — Capacitor Android and offline queue | In Progress | Existing Capacitor project and 😎 icon are preserved; current source is synchronized and built, and local text/media retry queues and reconnect retries are implemented. Android device verification remains. |
| 8 — Product/security/performance testing | In Progress | Typecheck, lint, production build, local sign-in/registration smoke checks, Capacitor sync, Gradle build, and APK bundle/signature/permission checks passed. pgTAP, multiple-account Supabase tests, and Android device tests remain pending. |
| 9 — Account deletion and privacy | In Progress | Migration 011 and `account-delete` implement password-confirmed, non-admin self-deletion, peer-history retention, privacy-minimized audit, and per-user inbox hiding. Migration 012 adds private avatars; updated `account-delete` cleans avatar objects. Not deployed or tested against a live Supabase project. |
| 10 — Sign-in UX and account preferences | Implemented | Removes unauthenticated demo, persists settings, supports password update, private avatar upload, searchable emoji, and a searchable 48-sticker pack including 16 original illustrated characters with Kinyarwanda captions. Migration 012 and account-delete function redeployment remain pending. Apply migration 015 and verify the owner-reported 202611120002 is present before sending all sticker codes; do not rerun 120002. |

## Known limitations and pending verification

- There is no unauthenticated sample-chat/demo mode. If Supabase URL/key or deployed authentication functions are unavailable, sign-in/registration cannot connect and the user remains on the sign-in screen.
- Private text, replies, reactions, editing, deletion, inbox listing/hiding, and authenticated member discovery are wired to Supabase in source, but migrations `202611110004`–`202611110006`, `202611110008`, and `202611110011` are pending. Media upload, view-once access and cleanup, poll/vote, sticker, and mention source paths are implemented but require migrations `202611110009`–`202611110010` and the media Edge Functions before live use.
- Profile settings use `user_settings`; avatar upload requires migration `202611110012` and redeployment of the updated `account-delete` function. Avatar reads use short-lived signed URLs. The service-role key is server-only.
- Media and view-once requests use authenticated, membership-checked server access with no-store headers; screenshots/external recording cannot be prevented. Cleanup requires the owner to configure `MEDIA_CLEANUP_SECRET` and a recurring trusted invocation. Uploaded objects and metadata will not be automatically removed until deployment and scheduling are complete.
- View-once media is excluded from the persistent browser retry queue, and legacy view-once queue entries are cleared on restore. If its upload fails, retry is available only while the current page remains open; the UI warns before the sender leaves.
- Grouped image albums store each image as its own message/media object. The additive migration `202611120001_grouped_media_messages.sql` adds the shared group ID and registration RPC; apply it after migration 009 and before deploying this frontend, because message queries now select the new column. It has not been applied remotely or tested with multiple accounts.
- Poll votes are visible to members of the conversation; mentions are in-app only. General Tea group read receipts, push notifications, full offline synchronization, and Android device verification remain incomplete.
- The sticker picker has 48 codes, including 16 illustrated character stickers, and now scrolls within a bounded panel. Deleted messages no longer render their separate sticker relation. The owner reports applying `202611120002_illustrated_community_stickers.sql`; this was not independently verified.
- Apply `202611120003_community_profile_and_username_events.sql` after 007 and 010, then redeploy `admin-console`. It enables username-change system notices, live group-name/photo settings, private group-photo storage, and the admin-only update RPC. None of these server paths have been live-tested.
- Administrator tools require migrations `202611110002` and `202611110007`, plus current `admin-access-codes`, `admin-console`, and `admin-invite` Edge Functions; none has been live-tested in this workspace.
- Account deletion requires migrations `202611110011`–`202611110012` and deployment of the current `account-delete`. The endpoint blocks administrators and reauthenticates the scholar's password; its Storage/Postgres/Auth operations are not atomic, and partial failures require retry/support. Avatar Storage cleanup is implemented but not live-verified.
- PWA shell availability does not provide offline chat or auth. Media responses request no-store and are not added to the service-worker cache; failed media uploads are persisted locally in IndexedDB for retry. This is not a full offline chat/history sync implementation.
- The new migration has not been applied or live-tested from this workspace; pgTAP/multi-account/backend/device tests remain pending. APK distribution remains disabled until a release-signed APK is hosted over HTTPS.
