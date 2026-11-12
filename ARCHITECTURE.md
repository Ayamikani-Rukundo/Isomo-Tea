# Architecture

## Application

```text
Browser / Capacitor Android WebView
  └── React + TypeScript (Vite)
      ├── Sign-in-first scholar/admin authentication and registration
      ├── AuthProvider — Supabase session, role check, and profile
      ├── Profile — username/password, account settings, private avatar
      ├── Support Circle and one-to-one conversations — paginated text, replies, reactions,
      │   edits/deletes, media, polls, mentions, stickers, and Realtime source paths
      ├── Admin dashboard — member/admin/access-code operations and audit UI
      ├── PWA service worker — shell/local static assets only; no API/chat media
      └── Android Capacitor project — packages the shared `dist/` web bundle

Supabase
  ├── Auth — account/password and persisted sessions
  ├── PostgreSQL + RLS — profiles, roles, conversations, messages, and settings
  ├── Realtime — authorized message, reaction, poll, and mention changes
  ├── Private Storage — chat media and profile avatars
  └── Edge Functions — authentication, admin, media access/cleanup, account deletion
```

The browser and Android shell use the same frontend and configured Supabase project. The browser only receives the public anon/publishable key; the service-role credential stays in server-side Edge Functions. All pending migrations and functions remain owner-controlled and must be applied/deployed and tested before any source path is considered live.

The root UI is sign-in-first; there is no unauthenticated sample-chat/demo route. Supabase configuration or deployment failures are surfaced on the sign-in or authenticated screen rather than falling back to fake data.

## Caching and offline boundaries

The production PWA service worker caches the application shell, icons, and local sticker art. Hashed JavaScript/CSS is fetched network-first with cached fallback; navigation falls back to the cached app shell. Supabase API responses, signed avatars, and chat media are not added to the service-worker cache. View-once media is requested through the server-authorized no-store endpoint and must never be persistently cached. The local retry queue can retain failed sends for retry, but this is not full offline history synchronization.

PWA cache updates are user-controlled. A local shell can open offline, but sign-in, messaging, media, and other server-backed actions require connectivity.

## Security boundaries

- Conversation membership and RLS determine message access; administrator status alone does not grant private-message access.
- The private media Edge Function verifies the session, conversation membership, message state, and view-once claim before streaming bytes.
- Profile avatars are stored in a private bucket with path-scoped write/delete policies; reads use short-lived signed URLs.
- Server-side administrative actions verify the caller's role and use service-only database operations.
- View-once consumption is enforced per recipient, but screenshots and external recording cannot be prevented reliably.
- Account deletion spans Storage, Postgres, and Auth and is not atomic; partial failures are reported for retry/support.

## Verification boundaries

Browser device emulation verifies responsive layout, not native Android behavior. Android source must be synced and rebuilt after web changes; the debug APK still needs installation/launch tests on a real device or emulator. No remote migrations are applied from this workspace, and live authorization/multi-account behavior must not be claimed until the project owner deploys and verifies it.

See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for the data model, migration list, and RLS boundaries.
