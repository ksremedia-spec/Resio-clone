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

## Starting over

Stop the app (close the Terminal window), delete the folder `data/demo` inside
the project, and start again. Fresh demo data is created.

## Where things stand

Done and tested: sign-in and company setup, roles and permissions, clients,
projects, schedule with dependencies, tasks, daily logs, documents, messaging,
notifications, search, activity history, offline queue, cost catalog and cost
codes, estimates, budgets and job costing, change orders, purchase orders and
bills, invoices and payments, vendors.

Not built yet: the client portal (proposals, selections, online approvals and
payments), the vendor portal, time clock, the AI assistant, leads and reports.
Those menu items show a "coming in Phase N" note.
