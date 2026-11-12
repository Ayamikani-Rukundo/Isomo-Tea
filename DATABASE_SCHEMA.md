# Database schema

The Phase 2 schema is introduced by [202611110001_phase2_auth_and_core_schema.sql](./supabase/migrations/202611110001_phase2_auth_and_core_schema.sql). Subsequent work adds [202611110002_admin_access_code_management.sql](./supabase/migrations/202611110002_admin_access_code_management.sql), [202611110003_general_chat_realtime.sql](./supabase/migrations/202611110003_general_chat_realtime.sql), [202611110004_private_conversations.sql](./supabase/migrations/202611110004_private_conversations.sql), [202611110005_message_reactions.sql](./supabase/migrations/202611110005_message_reactions.sql), [202611110006_message_edit_delete.sql](./supabase/migrations/202611110006_message_edit_delete.sql), [202611110007_admin_audit_log.sql](./supabase/migrations/202611110007_admin_audit_log.sql), [202611110008_private_read_receipts.sql](./supabase/migrations/202611110008_private_read_receipts.sql), [202611110009_secure_message_media.sql](./supabase/migrations/202611110009_secure_message_media.sql), [202611110010_polls_mentions_stickers.sql](./supabase/migrations/202611110010_polls_mentions_stickers.sql), [202611110011_private_inbox_and_account_deletion.sql](./supabase/migrations/202611110011_private_inbox_and_account_deletion.sql), [202611110012_private_profile_avatars.sql](./supabase/migrations/202611110012_private_profile_avatars.sql), [202611110013_filter_hidden_message_media.sql](./supabase/migrations/202611110013_filter_hidden_message_media.sql), [202611120002_illustrated_community_stickers.sql](./supabase/migrations/202611120002_illustrated_community_stickers.sql), and [202611120003_community_profile_and_username_events.sql](./supabase/migrations/202611120003_community_profile_and_username_events.sql). The project owner reports applying 202611120002, but this was not independently verified. Other migrations and related Edge Functions still require review/deployment/testing; no project credentials are stored in the repository.

## Tables

| Table | Contents and constraints | Access |
|---|---|---|
| `profiles` | `auth.users` primary/foreign key, alias, generated lowercase alias key with unique constraint, private avatar object path, timestamps | Authenticated read; own avatar path update. Username changes only through `set_my_username` or trusted server operations. |
| `administrators` | User ID and grant audit (`created_by`, timestamp) | Authenticated users can read only the indicator user IDs; role writes and management metadata are service-role only. |
| `access_codes` | bcrypt `crypt()` hash, active/expiry/usage limits, optional creator | No client access. Edge Functions consume codes or return safe usage metadata through privileged operations. |
| `conversations` | General/private kind, current group title/photo object path, creator and timestamps; canonical sorted participant IDs for private pairs | Authenticated reads require actual conversation membership. Administrator role alone grants no private conversation access. No client create/update/delete grant. |
| `conversation_members` | Conversation/user key, join/read timestamps, per-user private-inbox `hidden_at` | Authenticated reads within accessible conversations; writes are backend-only. |
| `messages` | Conversation/sender IDs, body, optional trusted system-event kind, same-conversation reply and deletion timestamps | Reads require membership and exclude per-user-hidden messages. Clients cannot insert system events; username-change notices are created by the caller-bound RPC. |
| `message_reactions` | Unique per-message/user/emoji reactions | RLS limits reads and writes to members of the conversation; Realtime enabled by migration 005. |
| `message_hidden_for_users` | Per-user "delete for me" state | No direct client grants; the caller-bound RPC records state and a security-definer predicate filters hidden rows. |
| `message_media` | Private image/audio/video object path, MIME/size metadata, view-once flag and expiry | Members can read metadata; registration is through a caller-bound RPC; media bytes are streamed only through the authorized Edge Function. |
| `view_once_recipients` | Send-time recipient snapshot, active claim and per-recipient consumption timestamp | No client table grants; only trusted service-role RPCs can claim or complete consumption. |
| `message_polls`, `poll_options`, `poll_votes` | Poll prompts/options and one current vote per participant | Conversation members can read votes; validated RPCs create polls and cast/update votes. Individual choices are visible to conversation members. |
| `message_stickers` | Allow-listed sticker code attached to a message | Conversation members can read; validated RPC creates sticker messages. |
| `message_mentions` | Per-user in-app mention notification and read marker | A trigger resolves current conversation members; each user can read only their own notifications. |
| `admin_audit_log` | Actor, action, target IDs, safe JSON details, timestamp | No browser access; service-role-only through administrator-checked Edge Functions. |
| `account_deletion_audit` | Random request ID, lifecycle status, removed-message count and timestamps; no user ID or message contents | RLS enabled; service-role-only. |
| `user_settings` | Per-user theme and notification preference | Owner-only select/insert/update. |
| `auth_rate_limits` | Hashed network identifier, endpoint and attempt window | RLS enabled; no browser grants. The service-only atomic function updates it. |

`auth.users` insertion runs a trigger to create a generated private alias, default settings, and membership in the seeded General Tea conversation. Scholar registration then replaces the generated alias with the requested unique username. Deleting a user cascades their profile, settings, and memberships; message sender IDs are set null so deleting an account does not block or erase shared history.

The private `isomo-profile-avatars` Storage bucket is created by migration 012. It allows image MIME types up to 5 MiB. Signed-in users can read avatar objects, but uploads and deletes are restricted to the authenticated user's UUID folder; the browser stores the object path in `profiles.avatar_url` and resolves short-lived signed URLs for display. Users can clear their profile photo; the updated `account-delete` Edge Function removes avatar objects during account deletion.

Migration 202611120003 creates the private `isomo-community-assets` bucket. All signed-in members can read signed group-photo URLs; only administrators can upload objects, and database updates run through a service-role-only RPC after the Edge Function verifies the administrator JWT. The current conversation row is overwritten and the previous Storage object is removed after a replacement succeeds.

## Functions

- `username_is_available(text)` returns a boolean only; it never returns email, auth IDs, or account details.
- `set_my_username(text)` requires `auth.uid()`, validates format, enforces case-insensitive uniqueness, and inserts a trusted Delta Tea system event when the username changes.
- `consume_access_code(text)` uses bcrypt verification and atomically enforces active/expiry/use limits. Execution is granted only to `service_role`.
- `admin_create_access_code(...)` validates registration limits/expiry, prevents duplicate code values, stores only a salted bcrypt hash, and can deactivate one selected active code in the same transaction. It returns metadata only, never the hash. Execution is granted only to `service_role`.
- `admin_set_access_code_active(...)` toggles a code and refuses to reactivate an expired or exhausted one. Execution is granted only to `service_role`.
- `consume_auth_rate_limit(...)` atomically limits authentication Edge Function attempts. Execution is granted only to `service_role`.
- `is_administrator()` reads the caller's role only. Role checks for admin invitations also run in the Edge Function.
- Internal `private` functions enforce conversation-membership checks without exposing membership tables to clients.
- `get_or_create_private_conversation(uuid)` creates/reuses the single canonical private conversation for the authenticated caller and selected member. It does not grant administrator-wide access to private messages.
- `get_private_conversation_list()`, `hide_private_conversation(uuid)`, and `open_private_conversation(uuid)` list only the caller's private pairs and apply per-user inbox hiding. Opening or starting a conversation requires existing membership or uses the unique-pair RPC.
- `purge_account_content(uuid,uuid)` and `complete_account_deletion(uuid)` are service-role-only deletion audit steps. The `account-delete` Edge Function derives the target from the bearer token, reauthenticates the password, blocks administrators, removes authored messages/media, and then deletes that Auth account. A peer's messages and the shared private conversation are retained.
- `mark_conversation_read(uuid)` advances only the caller's private conversation read marker using server time; it does not permit arbitrary/future timestamps.
- `edit_message(uuid,text)`, `delete_message_for_me(uuid)`, and `delete_message_for_everyone(uuid)` enforce caller-bound edits/hides/soft deletes. Edits are limited to 15 minutes; shared deletion leaves a tombstone.
- `register_message_media(...)` checks membership, upload path, supported MIME type and Storage metadata before creating a message; General Tea recipients are snapshotted at send time. `claim_view_once_media` and `complete_view_once_media` are service-role-only and enforce one successful view per recipient.
- `get_message_media_cleanup_candidates(integer)` and `delete_cleaned_message_media(uuid[])` are service-role-only; the `media-cleanup` function removes eligible Storage objects before metadata. Expired/consumed view-once media and media on deleted messages are eligible for cleanup.
- `create_message_poll(...)`, `cast_poll_vote(...)`, `get_poll_results(...)`, `create_sticker_message(...)`, and `mark_mentions_read(...)` validate authentication and conversation membership. Polls/votes/mentions participate in Realtime.
- Administrator history clearing (General Tea only), message deletion, role changes, invitations, and audited access-code operations are available only to service-role RPC callers from authenticated administrator Edge Functions.
- `admin_update_general_conversation(text,text,uuid)` updates the current group name/photo and records a metadata-minimized audit event; execution is service-role-only.

## Row Level Security and grants

RLS is enabled on every application table. Table grants are limited separately from row policies. Anonymous clients cannot read profiles, codes, messages, or roles. Signed-in members can read community aliases and only conversations where they are members; administrator status alone does not grant private-message access. They cannot directly change usernames, grant administrator roles, manage access codes, or create memberships. Private Inbox list/hide/open RPCs are caller-bound; `hidden_at` affects only the caller. Storage has restrictive policies that prohibit direct client reads and updates from the private chat-media bucket, even if a broader permissive policy exists. Media metadata excludes deleted and per-user-hidden messages; media bytes are fetched only after the Edge Function checks the user's JWT, membership, hidden/deleted state, and view-once claim. Administrator operations use server-verified JWTs and service-role-only RPCs; the service-role credential never enters the browser bundle.

The SQL checks in `supabase/tests/*.test.sql` assert RLS, grants, membership boundaries, and service-only administrator/media functions. They have not been run against a database in this workspace because Docker and the Supabase CLI are unavailable.

## Access-code and first-admin provisioning

Use the administrator dashboard to create codes; do not insert them manually. The dashboard can display the submitted code once after successful creation, while the database stores only its salted bcrypt hash. Codes have a positive finite maximum-use count and may optionally expire. Deactivation and selected-code replacement are administrator-authorized; replacement and old-code deactivation are atomic.

Bootstrap exactly one first admin through the Supabase project owner: create/invite the email account, then add its auth user UUID to `public.administrators`. There is no unauthenticated admin grant path. Further administrators are invited through the Edge Function after it verifies the caller's role.

## Remaining scope

Image/audio/video uploads, voice recording/playback, view-once consumption, polls/voting, in-app mentions, stickers, local retry queues, profile avatar uploads, and account deletion are implemented in source but are not live until migrations 009–013 and the required Edge Functions are deployed and tested. Migration 013 replaces the media-metadata read policy so deleted messages and messages hidden for the current user no longer expose metadata; it must run after migration 009. Account deletion spans Storage, Postgres, and Auth and is not atomic; partial failures are reported for retry/support. The cleanup schedule and media secret are owner-configured. General Tea group read receipts, push notifications, full offline chat synchronization, and Android device testing remain incomplete. Migrations 002–013 and the related Edge Function changes have not been applied/deployed or live-tested from this workspace.
