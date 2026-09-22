# Trying Buildline (no coding needed)

Buildline runs on your own computer for now. Nothing is on the internet yet, so
your data stays on your machine.

## What you need

* A Mac (or a PC with Windows/Linux).
* **Node.js**, a free program the app runs on. Download the "LTS" version from
  https://nodejs.org and install it like any other app. Version 22 or newer.
* This project folder on your computer. On the GitHub page click the green
  **Code** button, choose **Download ZIP**, and unzip it. Or, if you use GitHub
  Desktop, clone the `claude/ipad-construction-platform-ip5nbw` branch.

## Start it

1. Open the project folder.
2. Double-click **`start-demo.command`** (on Windows or Linux run `start-demo.sh`).
   The first start installs and builds everything and takes a minute or two.
   If macOS says the file is from an unidentified developer, right-click it,
   choose **Open**, then **Open** again.
3. A Terminal window stays open. Leave it open while you test; closing it
   stops the app. Your browser opens http://localhost:4000 automatically.

Sign in with the demo account:

| Role | Email | Password |
|---|---|---|
| Owner | owner@demo.buildline.app | demo-password-123 |
| Project manager | marcus@demo.buildline.app | demo-password-123 |
| Field supervisor | rosa@demo.buildline.app | demo-password-123 |
| Field crew (field mode) | jake@demo.buildline.app | demo-password-123 |
| Office / finance | tom@demo.buildline.app | demo-password-123 |
| Estimator | priya@demo.buildline.app | demo-password-123 |

You can also create your own company with **Create a company** on the sign-in
screen and invite people from Settings → Members. Invitation emails are not
sent in demo mode; the invitation link is shown on screen instead, and you can
open it in a private browser window to accept as the new person.

## Testing on an iPad

While the app is running, the Terminal window shows an address like
`http://192.168.1.23:4000`. Open that address in Safari on an iPad connected to
the same Wi‑Fi. Tap the Share button and **Add to Home Screen** to use it
full-screen. Turn Wi‑Fi off to try offline mode: recently viewed screens keep
working and anything you save is queued and sent when Wi‑Fi returns.

## What to try

* Dashboard: overdue tasks, upcoming deadlines, schedule conflicts, activity.
* Projects → Smith Residence → Schedule: drag a bar on the Timeline and watch
  dependent tasks move; try List and Calendar views.
* Daily Logs → New log: weather chips, crew steppers, camera, post it.
* Documents: upload, take a photo, share with the client.
* Messages: start a thread, mention someone with @Name.
* Settings → Members: invite someone; Roles: edit what each role can do.
* Field mode (sign in as Jake) for the on-site experience.

Money (new):

* Projects → Baker Addition → Estimate: tap **Line**, search the catalog for
  "quartz", set a quantity and add it. Change **Markup & tax** and watch every
  line re-price. **Lock estimate** turns it into a budget and sets the contract.
* Projects → Smith Residence → Budget: each line shows original, approved
  changes, committed (open purchase orders), actual (approved bills) and
  variance. Tap a line to see every transaction behind the numbers.
* Change Orders: open the one that is "sent" and **Record approval**. The
  contract value and the budget update immediately.
* Invoices: open the draft **Draw 3**, **Send to client**, then **Record
  payment**. Try **New invoice** and bill a percentage of a budget line.
* Purchasing: open PO-0002 (Bluebonnet Plumbing), **Issue to vendor**, then
  **Enter bill**; approving the bill marks the PO matched. A bill that exceeds
  its PO shows an over-billing warning before you approve it.
* Vendors, Estimating (catalog and cost codes), Budget and Invoices in the left
  menu show the same information across every project.

Client experience (new):

* Sign in as the homeowner (jane@example.com, same password). You get a short
  menu and a home page with what needs your decision and what is due. Open the
  project, approve the change order that was sent to you, choose the shower
  tile, and pay an invoice with **Pay now** (payments are simulated in demo).
* As the owner: Projects → Baker Addition → Proposals shows the proposal sent
  to the Bakers. Clients → Baker Family → add a contact with an email and tap
  the link icon to invite them to the portal; the invitation link appears on
  screen so you can open it in a private window.
* Projects → Smith Residence → Selections: release the "Wall colour" choice to
  the client, or record a choice on their behalf. Picking an option over the
  allowance drafts a change order for the difference automatically.

Field and vendors (new):

* Sign in as Jake (field crew). Field mode now has a time clock: pick a cost
  code, **Clock in**, take a break, **Clock out**. The hours go to a supervisor
  for approval. The **Time** page shows your week.
* Sign in as Rosa (supervisor) → Time → **Previous week**: approve the pending
  hours. Sign in as the owner → Time → **Payroll export** to get a CSV of
  approved hours and mark them exported. Settings → Members lets you set each
  person's hourly cost; approved hours become labour cost on the budget.
* Projects → Smith Residence → Purchasing → **Bid requests**: request bids from
  several vendors, key in a bid that arrived by email, and **Award** it to
  create a draft purchase order.
* Sign in as the subcontractor (orders@hillcountrycabinets.example). They see
  only their purchase orders (acknowledge one), the bid request they were
  invited to (submit a price), their scheduled tasks and shared documents.

AI assistant (new):

* **AI Assistant** in the menu: ask "What's overdue on Smith Residence?",
  "How is the Baker budget?", "Any unpaid invoices?", "What needs my
  approval?". Answers come from your live data; each fact shows the tool that
  fetched it.
* Ask it to do something: "Create a to-do 'Confirm the countertop template
  date' on Smith Residence due tomorrow". It shows what it is about to do and
  waits for you to tap **Confirm**. Cancel and nothing happens.
* Sign in as Jake (field crew) and ask about a budget: he is told he doesn't
  have access, because the assistant can only see what he can see.
* Settings → **AI assistant** shows whether a real model is connected. In the
  demo you can paste an Anthropic API key there to get natural-language
  answers; without one the built-in understanding still works.

Leads, reports, automations and offline (new):

* **Leads** in the menu: a board of the sales pipeline. Tap a card to see the
  contact, log a call or note (with a follow-up date), move it through the
  stages, or tap **Won — create project** to turn it into a client and project
  in one step. Mark one lost and say why.
* **Reports**: Job cost, Receivables aging, Time by project and Sales
  pipeline. Every report has a **Download CSV** button; if your browser blocks
  downloads you get a copy-and-paste view instead.
* Settings → **Automations**: rules like "change order approved → to-do for the
  project managers" and "invoice overdue → follow-up to-do and email". Start
  from a ready-made rule or build your own. **Run now** checks the time-based
  rules immediately; the run log underneath shows exactly what each rule did.
  Try it: sign in as Rosa, post a daily log on Smith Residence, then sign in
  as Tom (office) and open the bell: the "Daily log posted" rule notified him.
* Settings → **Offline**: **Download for offline** fetches every project,
  task, log, document list and message you can see, plus the screens that
  show them, so the iPad works with no signal. Reconnecting fetches only what
  changed.
* Ask the assistant "How is the pipeline?" or "Who owes us money?".

Client selections sheet (new):

* Projects → Baker Addition → **Selections**: the standard sheet is on this
  project. Tap **Open sheet** to see the whole thing laid out like the paper
  form: tick boxes for choices, tick-all-that-apply items, written-in answers
  (paint colours, manufacturers), the builder's default for each item, and the
  client signature block at the bottom.
* Tap any item on the sheet to make or change the choice. Written-in items
  have fields to fill; renovations can tick **Match existing**; every item
  takes a comment.
* **Add standard sheet** puts either list on any project: the tick-box
  *Interior selections checklist* or the written-in *Residential selection
  list* used for pricing. Items already on the project are skipped.
* **Record client signature** (or, for the homeowner in the portal, **Sign the
  sheet**) freezes the sheet as it stands. **Publish to documents** saves a
  copy into Documents → Specifications where the crew, the client and
  subcontractors can read the finished picks. **Print / PDF** prints it.
* **Selections** in the main menu (every role, including the homeowner and
  subcontractors) shows the live choices on every project you can see, with
  the latest decisions first. It refreshes itself every 30 seconds and every
  account is reading the same record on the server. Ask the assistant "What
  did the Bakers choose for flooring?".
* Sign in as Jane (homeowner) after adding the checklist to Smith Residence:
  her home page shows "Your selections sheet" with progress; she can tick her
  choices and sign. Sign in as Jake (field crew): Field mode has a **Client
  selections** tile that opens the sheet read-only.

## Starting over

Stop the app (close the Terminal window), delete the folder `data/demo` inside
the project, and start again. Fresh demo data is created.

## Where things stand

Done and tested: sign-in and company setup, roles and permissions, clients,
projects, schedule with dependencies, tasks, daily logs, documents, messaging,
notifications, search, activity history, offline queue, cost catalog and cost
codes, estimates, budgets and job costing, change orders, purchase orders and
bills, invoices and payments, vendors, proposals, selections, the client portal
with approvals and online payment, time clock with approvals and payroll export,
bid requests and the vendor portal, the AI assistant with confirm-before-acting,
leads and the sales pipeline, reports with CSV export, automations, the
offline download, and the client selections sheets (checklist and written-in list).

Everything in the original plan is built. What is deliberately simple in this
version: the demo payment provider stands in for Stripe, email goes to a log
unless SMTP is configured, and the AI assistant uses built-in understanding
unless an Anthropic key is added.
