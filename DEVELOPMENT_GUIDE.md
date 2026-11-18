# Development guide

## Local workflow

1. Install Node.js 20.19+ (or 22.12+) and npm.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:5173`.
4. Use Chrome DevTools' device toolbar for responsive layout checks.
5. Run `npm run typecheck`, `npm run lint`, and `npm run build` before sharing a change.
6. For production PWA validation, serve the built app over HTTPS (or localhost), install it from a supported browser, and test the offline shell. Do not treat cached shell availability as offline chat support.

Vite listens on all local interfaces for phone preview. For an Android phone on the same Wi-Fi, find the computer's active Wi-Fi IPv4 address with `ipconfig`, open `http://YOUR_COMPUTER_IPV4:5173` on the phone, and permit the private-network firewall connection if prompted. Never use the development server on an untrusted public network.

## Current interaction boundaries

i Fam (Isomo Family) is a peer-support space for sharing personal challenges at your own pace and supporting one another. The shared group is called Support Circle; members can also create private groups and continue one-to-one conversations. It is not professional counseling or emergency support, and the interface should not promise confidentiality.

Scholar/admin authentication, profile preferences, password updates, private avatar uploads, and username updates are implemented but still require live project verification. The app is sign-in-first and has no unauthenticated sample-chat/demo mode. Authenticated Support Circle, private one-to-one chats, and member-created groups support text, replies, reactions, editing, deletion, paginated history, and Realtime synchronization in source. Members can permanently delete a private chat for both participants, and group admins can manage members, invites, group details, messages, and deletion. These features require the additive migration `202611180001_group_conversations_and_chat_deletion.sql` and the `delete-conversation` Edge Function; group list visibility and all role checks are server-side. Account deletion removes a deleted member's Support Circle messages, private inboxes label a deleted peer **User deleted**, and username notices do not reveal the new username. None of these new server paths have been applied or live-tested. Profile avatar storage additionally requires migration `202611110012_private_profile_avatars.sql` and redeployment of `account-delete`. Migration `202611110013_filter_hidden_message_media.sql` is a follow-up policy-only migration for 009: apply it after 009, and do not rerun or edit an already-applied migration. Private and group read markers require the earlier `202611110008_private_read_receipts.sql`. Media cleanup additionally requires `MEDIA_CLEANUP_SECRET` in Edge Function secrets and a recurring trusted POST to `media-cleanup`. Account deletion requires the current password and exact phrase, rejects administrators, and can partially complete if Storage, Postgres, or Auth fails; the endpoint reports that outcome for retry/support. Apply migrations after reviewing the target schema; do not run `supabase db push` or apply remote migrations as part of local development. The service worker provides an offline shell and caches local static assets, not API responses, chat media, or offline message history.

If application rows were manually cleared, back up the hosted project and apply `202611180002_repair_deleted_account_basics.sql` once in the Supabase SQL Editor, after the core schema and `202611180001_group_conversations_and_chat_deletion.sql` are present. This repairs missing profile/settings/membership rows for Auth users that still exist, but intentionally does not restore administrator roles, deleted Auth users, messages, or uploaded files. Use Supabase backups/PITR for those. For future content resets, use the administrator dashboard's Support Circle history-clearing action or the in-app private/group conversation deletion flow; do not manually delete from account, role, profile, settings, conversation, or membership tables.

The owner-only full reset is provided by migrations `202611180003_owner_only_full_reset.sql` and `202611180004_owner_only_full_reset_safe_deletes.sql` and the updated `admin-console` Edge Function. Back up the project, apply migrations 002, 003, and 004 in order (after migrations 011, 120004, 120006, and 180001), then deploy `admin-console` and the current frontend. The Overview form requires the owner email and exact phrase, followed by a second confirmation. It deletes other Auth accounts, chat and group data, access codes, prior audit records, push registrations, and files in the three Isomo Storage buckets while retaining the owner's login/admin role and required Support Circle. It does not delete database schema, policies, functions, Storage buckets, or other Supabase platform data. Create a new access code afterward if registration should resume.

## Remaining implementation sequence

1. Verify the existing authentication, RLS, and access-code management deployment against the project using separate scholar/admin accounts.
2. Apply and live-test the Support Circle Realtime, private conversation, and member-group migrations using multiple authenticated accounts; deploy `delete-conversation` and verify cross-participant deletion and group membership boundaries.
3. Review and apply migrations 009–010 after the earlier chat migrations; verify `storage.objects.metadata` includes `size` and `mimetype`, and confirm media bucket policies on the target project.
4. Review and apply migrations 011–012; deploy the current `account-delete`; test password reauthentication, administrator rejection, deleted-user labels, avatar cleanup, and the surviving peer's message history.
5. Deploy `media-access` and `media-cleanup`, set `MEDIA_CLEANUP_SECRET`, and schedule trusted cleanup. Test with multiple member accounts and an unauthorized account; do not claim remote functionality before these tests.
6. Verify administrator group controls, group role/invite lifecycle, message moderation, storage cleanup retries, and fuller offline synchronization against the hosted project.
7. Test a fresh debug APK on an Android device; configure private release signing before preparing a public release.
8. Publish the release APK to stable HTTPS hosting, configure the website's APK URL, and verify the download end to end.

## Android build prerequisites

The Android app uses the shared Vite bundle inside the Capacitor project in `android/` and is configured to connect to the same Supabase project when the frontend environment is set. The native project and generated 😎 launcher/adaptive/splash resources exist. A fresh debug APK has been synced and built; its size, hash, signature, permissions, and embedded web bundle verification are recorded in `IMPLEMENTATION_STATUS.md`. It has not been installed or launched on a device.

```powershell
npm run android:assets
npm run android:sync
npm run android:open
```

In Android Studio, build a debug APK, or run `.\gradlew.bat assembleDebug` from the `android/` directory with `JAVA_HOME` and `ANDROID_SDK_ROOT` configured. The expected debug artifact is `android\app\build\outputs\apk\debug\app-debug.apk`. This workspace used a user-local Temurin JDK 21 and Android SDK 36. Configure release signing with a private keystore that is kept out of source control; no signing key or credentials are provided. No APK should be linked from the website until a real release asset has been uploaded to stable HTTPS hosting.

Verify the application ID, callback/deep-link flow, native permissions, icons/splash screen, back navigation, keyboard resizing, network status handling, and secure session persistence. Install and launch the debug APK on an Android device; browser device emulation is not a substitute. Device behavior, authentication, and messaging remain unverified in this workspace.

The Android build uses the same web bundle and Supabase client configuration as the PWA. `RECORD_AUDIO` is declared for voice capture; verify the runtime permission prompt and recording/playback on a real device. View-once responses are streamed with no-store headers and are not intended for persistent caching, but screenshots and external recording may still be possible.

The welcome page reads optional `VITE_ANDROID_APK_URL`, `VITE_ANDROID_APK_VERSION`, and `VITE_ANDROID_APK_SIZE` build variables. Set the URL only to the actual hosted APK; it must use HTTPS. Without it, the page displays an explicit unavailable status instead of a broken link.

## Environment safety

Use `.env.local` for local Vite variables and do not commit it. The Supabase anon key is a public client key; it is not an authorization boundary. Privileged actions, access-code checks, and admin credentials must stay server-side. Do not commit Supabase service-role credentials or signing keys.
