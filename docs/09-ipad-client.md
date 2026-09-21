# 09 · iPad Client

`apps/ipad` is a React 19 + TypeScript application packaged as a native iPad
app with Capacitor. It is designed as an iPad application (persistent sidebar,
split views, sheets, popovers, context menus, swipe actions, drag-and-drop,
keyboard shortcuts, 44-pt targets, safe-area insets) rather than a responsive
website; portrait collapses the sidebar into an overlay and stacks split views.

## Structure

```
src/
  api/client.ts     fetch wrapper: bearer token + org header, typed errors, GET cache, offline outbox, multipart upload
  api/hooks.ts      TanStack Query wrappers (useResource / useApiMutation) with prefix-based invalidation
  store/db.ts       Dexie (IndexedDB): cache, outbox, blobs
  store/sync.ts     outbox processor: ordered replay, idempotent via client ids, conflicts surfaced not dropped
  store/session.tsx auth state, persisted session, org switching, permission checks
  native/           Capacitor wrappers with web fallbacks: network, camera, files, haptics, location, voice, status bar
  ui/tokens.css     design tokens (light + dark), ui.css component styles
  ui/components.tsx Button, Badge, StatusBadge, Avatar, Field/Input/Select/Textarea, Switch, Segmented, SearchField,
                    Stepper, Chip, Card, Stat, Toolbar, ListRow, SwipeRow, Sheet, ConfirmDialog, Popover/Menu/MenuButton,
                    context menu hook, Toast host, Empty/Error/Skeleton/Spinner states, keyboard shortcut hook
  layouts/AppShell  sidebar navigation (permission-filtered), favourites, org switcher, connectivity/outbox banner,
                    notifications popover, ⌘K command palette (global search), ⌘1–5 navigation
  features/         auth, dashboard, projects (hub + sections), clients, tasks, schedule, dailyLogs, documents,
                    messages, settings, field (field mode)
e2e/                Playwright tests at iPad Pro 11" landscape and portrait
```

## Offline behaviour

* Every GET is cached in IndexedDB per organization; when the network fails
  the cached copy is served and the UI shows a **Cached** badge.
* Mutations that opt in (`queue`) are written to the outbox when the network
  fails and resolve immediately with an optimistic record. The banner shows
  the queue, each item explains itself, and items can be retried or discarded
  by the user. Nothing is dropped automatically.
* Creates carry a client-generated `id` (tasks, daily logs) or
  `clientMutationId` (messages, threads, uploads) so replays are idempotent.
* Photos captured offline are stored as blobs in IndexedDB and uploaded first
  when connectivity returns, in creation order.
* Version conflicts (someone edited the same record online) are flagged
  "needs attention" with the server message; the user resolves them.

## Native build

```bash
pnpm --filter @buildline/ipad build
cd apps/ipad && pnpm exec cap add ios && pnpm cap:sync && pnpm cap:open
```

Set `VITE_API_URL` at build time to the API origin. The same bundle runs on
Apple-silicon Macs as an iPad app; a Mac Catalyst target reuses it unchanged.
