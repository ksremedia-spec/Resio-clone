# 05 · iPad Navigation Architecture

Landscape iPad is the primary target (1194 × 834 pt iPad Pro 11", 1366 × 1024
pt 13"). Portrait keeps the same information architecture with the sidebar as
an overlay. Layout primitives: **Sidebar**, **SplitView** (list + detail),
**Sheet** (modal, form-size or full), **Popover**, **ContextMenu**, **Toolbar**.

```
┌ Sidebar ─────────┬─ Content ───────────────────────────────────────────────┐
│ ⌘1 Dashboard     │  Toolbar: title · search · quick actions (+)            │
│ ⌘2 Projects      │                                                          │
│    ★ favourites  │  SplitView: list (320–360 pt)  │  detail                 │
│ ⌘3 Leads         │                                │                         │
│ ⌘4 Schedule      │                                │                         │
│ ⌘5 Tasks         │                                │                         │
│    Clients       │                                                          │
│    Vendors       │                                                          │
│    Estimating    │                                                          │
│    Budget        │                                                          │
│    Invoices      │                                                          │
│    Messages      │                                                          │
│    Documents     │                                                          │
│    Reports       │                                                          │
│    AI Assistant  │                                                          │
│    Settings      │                                                          │
│ [org switcher]   │                                                          │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

Sidebar items appear only when the user holds the permission. Field roles get
the **Field Mode** layout by default: a project picker and six large actions
(Today's schedule, Daily log, Camera, Documents/Plans, Messages, Time clock).

## Project hub

`/projects/:id` renders a segmented section bar under the project header:
Overview · Estimate · Budget · Schedule · Tasks · Daily Logs · Selections ·
Change Orders · Proposals · Invoices · Documents · Messages · Time · Activity.
Sections are routes (`/projects/:id/schedule`) so deep links, keyboard
navigation and multi-window work. The project header carries favourite,
status, client, address, and a **Field Mode** toggle.

## Interaction rules

* Minimum tap target 44 × 44 pt; primary actions in the toolbar and as a
  floating "+" in list views.
* Create/edit happens in a **Sheet** (form) that can be dismissed by swipe;
  unsaved changes prompt.
* Lists support swipe actions (complete, archive), long-press context menus,
  and drag-and-drop (tasks in Gantt/list, documents into folders).
* Keyboard: ⌘K global search, ⌘N new in current list, ⌘1..5 sidebar, Esc
  closes sheets, arrows move selection in lists.
* Every list is virtualised and paginated (cursor) from the API; detail data
  loads lazily per section.
* Offline banner shows queued changes and lets the user retry; each queued
  item explains itself ("Daily log for Mon 14 — 3 photos waiting to upload").

## Fast field workflow (target ≤ 4 taps)

Open project (1) → Daily Log tile (2) → Camera (3) → Save (4). Photos and voice
notes are captured through the native shell and queued offline.

## Client and vendor portals

Separate route trees (`/portal/c/:token`, `/portal/v/:token`) with a simplified
single-column layout, no sidebar, and no internal terminology. They reuse the
design system tokens and read-only components but none of the internal views.

## macOS path

The same client runs on Apple-silicon Macs as an iPad app; a Mac Catalyst /
Electron packaging target can add menu bar items and window management. No
view depends on touch-only input: every gesture has a pointer/keyboard
equivalent.
