# Contacts II — CNT-13 → CNT-46

Work order for the contacts module: the contact record, history, lists, filters, import,
export, and the hygiene around them. Same conventions as [FIX-PLAN.md](FIX-PLAN.md): one ID
per change, a state column, decisions listed with a recommendation, and a Verified section
that is filled in only from things that were run.

**State: built, not deployed.** Everything from CNT-13 to CNT-44 is implemented and covered by
tests that were run (see [Verified](#verified)); CNT-45 and CNT-46 wait on other modules, and
CNT-42 is deferred by decision. CNT-01 → CNT-12 (the original module) are listed in
[THE-PLAN.md](../THE-PLAN.md).

## Rolling it out

1. Deploy the code.
2. `sync-indexes` — new indexes on contacts (phone digits, owner, import job, parcels), on
   history (per type, pinned), and the new tasks, appointments and import-jobs collections.
3. `migrate:contacts-ii`, dry run then `--apply` — see
   [docs/DEPLOY.md](../docs/DEPLOY.md#indexes-and-data-migrations). Until it has run,
   contacts from before the release have no normalised phone digits (the duplicate check and
   import matching will not find them by phone) and no parcels on the record.

What people will notice:

- **The contact page is new.** History is under tabs; the composer logs notes, calls, tasks
  and appointments; every field is editable card by card; N/C/T/A/E are shortcuts.
- **A contact can own several parcels** (D2). The one marked primary is what the table,
  search and exports use.
- **Phone numbers are matched as digits** (D1). "(303) 555-0142" and "3035550142" are the
  same number to the duplicate check and the import.
- **An import now asks what a match means** — update, skip or create — and shows the counts
  before writing. Every import is listed under Settings → Imports and can be undone for 30
  days (the contacts it created are deleted; the ones it updated are kept).
- **Smart lists are the saved-view mechanism.** "Save as list" in the toolbar turns the
  current filter into one; the lists page describes each in words.
- **Tasks and Appointments** are new entries under Contacts in the sidebar. Callers can
  create both.
- **Exports choose their columns**, can include custom fields and the owner, can be Excel,
  and are written to the audit log.

---

## What exists today

Stated precisely, because the plan is the gap between this and what the module should be.

**Record.** A contact has name, email, one phone plus `altPhones` (never shown), company,
status, source, owner (`ownerId`, never assigned anywhere), tags, one mailing address, one
parcel (`property`), `customFields`, DNC, and import provenance (`sourceSystem`/`sourceId`).

**Contact page.** Two cards (details, parcel), the opportunities on this contact, and one
timeline of `Activity` rows with a composer for notes and manual call logs. Edit mode covers
phone, email, company, status, city/state and the parcel — **not** the name, street, postal
code, tags, alternate phones, owner, source or custom fields. There is no delete, no "who did
this" on timeline entries, no filtering of the timeline, and it stops at the 50 most recent.

**History.** Everything is an `Activity` row. Sent email is logged there with the message id;
calls and SMS exist only as manual logs. There is no appointment anywhere in the system, and
the `Task` model exists with no routes and no UI. Custom field definitions can be created in
Settings but their values are shown nowhere, imported from nowhere and exported nowhere.

**List and filters.** The table shows name, status, phone, parcel, acres, tags, last
activity; 25 per page; sortable only by editing the URL. The toolbar offers search, one
status, one state, one tag, one list. The API already accepts county, DNC, acreage range,
owner and multiple statuses — the UI does not expose them. Bulk actions: set status, add tag
(via a browser prompt), mark DNC, add to list, delete, with "select all matching".

**Lists.** Smart lists can be built from one status, one tag and the DNC flag, although the
query layer supports states, counties, acreage, owner and search. Static lists are filled
through the bulk action and the import. Lists can be created and deleted; not edited. A
contact's page does not say which lists it is in.

**Import.** CSV only, parsed in the browser, chunked, resumable, tagged. Matching is by
external id, then phone; a match is updated, never skipped. No mapping onto custom fields, no
preview of what will change, no record that the import happened, no undo beyond filtering by
the tag.

**Export.** CSV of the current filter, fixed columns, no custom fields, no export of a
selection.

---

## Order of work

| Phase | What | Why this order |
|---|---|---|
| 0 | Foundations | One history contract, one detail endpoint, normalised phones — everything later writes through these |
| 1 | The contact record | The page people spend their calls on; every later phase adds a tab to it |
| 2 | Filters, lists, table | The daily working surface; blocked on phase 0's phone and owner work |
| 3 | Tasks and appointments | New records that phase 1's history tab is designed to hold |
| 4 | Import | Depends on custom fields (phase 1) and the import record (phase 0) |
| 5 | Export and bulk hygiene | Mirrors import's column handling; merge needs the history contract |
| 6 | Channel history | Calls and SMS land when the telephony module does; the slot is ready before then |

Phases 1 and 2 can proceed in parallel once phase 0 is done.

---

## Phase 0 — Foundations

| ID | Change | Size | State |
|---|---|---|---|
| CNT-13 | **One history contract.** Every record of contact with a person is an `Activity` with a fixed `type` vocabulary (`note`, `call`, `sms`, `email`, `appointment`, `task`, `status_change`, `stage_change`, `field_change`, `list_change`, `import`, `merge`, `created`), an optional `channelRef` (`{ kind, id }`) pointing at the source record (an `EmailMessage`, later a call or message from telephony), `userId` for who, and structured `metadata` per type (duration and outcome for a call, direction for email/SMS). Documented in one file, enforced by a Zod schema on write. Future modules write history through this and nothing else | M | done |
| CNT-14 | **One detail endpoint.** `GET /contacts/:id` returns the contact, its custom field *definitions* alongside the values, its lists, its owner's name, its open opportunities, counts per history type, and the first page of history. Today the page makes the call and then would need four more for the rest | M | done |
| CNT-15 | **History endpoint.** `GET /contacts/:id/history?type=&before=&limit=` — cursor-paginated, newest first, filterable by type, with the actor's name resolved. Replaces the 50-row cap | S | done |
| CNT-16 | **Phone numbers stored normalised.** Keep what was typed in `phone`, and store `phoneDigits` (E.164 without the `+`) on write and on import. Matching, duplicate detection and search use the digits; display uses the original. Decision D1 covers the country assumption | S | done |
| CNT-17 | **Owner is a real field.** `ownerId` is validated against the sub-account's members, shown with a name, assignable on the record and in bulk, filterable ("mine"). Changing it writes a `field_change` entry | S | done |
| CNT-18 | **Import record.** An `ImportJob` document per import: who, when, file name, row counts, the tag, the mapping, and the ids it created. The import wizard writes it; undo (CNT-37) and history (CNT-36) read it | S | done |

---

## Phase 1 — The contact record

The page is a header, a left column of facts, and a right column of history. It is used
mid-call, so reading must be instant and editing must not rearrange the page.

| ID | Change | Size | State |
|---|---|---|---|
| CNT-19 | **Header.** Name, status, DNC, owner, tags, source, and quick actions that are live today: Email (exists), Log call, Add note, New task, Schedule. Call and Text buttons appear when telephony lands (CNT-45), greyed with a reason until then | M | done |
| CNT-20 | **Everything is editable, in place.** Name, alternate phones (add/remove), company, source, owner, tags (typeahead over the sub-account's existing tags), street/city/state/postal code, parcel. Each card edits itself; no page-wide edit mode | M | done |
| CNT-21 | **Custom fields rendered and editable**, typed by their definition: text, number, currency, date, select, multiselect, checkbox, email, phone, URL. Required fields are enforced on save. Values of deleted definitions are shown under "Other" rather than lost | M | done |
| CNT-22 | **Multiple parcels.** A land owner often owns several. `property` becomes `properties: []` with one marked primary; the table and search use the primary; the page lists all. Migration copies the existing `property` into `properties[0]`. Decision D2 | L | done |
| CNT-23 | **History tabs.** All · Notes · Calls · Emails · Texts · Appointments · Tasks · Changes. Each is the history endpoint filtered by type; "All" is unfiltered. Infinite scroll on the cursor. Entries show who and when, and open their source where there is one (the email's full body, the task) | M | done |
| CNT-24 | **Email tab reads the real messages.** Subject, direction, status (sent/failed/bounced), opens; click to read the body as sent. Uses `EmailMessage`, not the activity summary | S | done |
| CNT-25 | **Pinned notes.** A note can be pinned; pinned notes sit above the tabs. For "always speaks Spanish", "widow — sensitive", "wants cash only" | S | done |
| CNT-26 | **Lists on the record.** Which static lists the contact is in and which smart lists currently match it, with remove/add | S | done |
| CNT-27 | **Delete and merge from the page.** Delete (cascade already built, FIX-09). Merge: pick the duplicate, choose which value wins per field, history and opportunities move to the survivor, the loser is removed and a `merge` entry records what was folded in | M | done |
| CNT-28 | **Keyboard and speed.** `N` note, `C` log call, `T` task, `A` appointment, `E` email, `/` focus search. The page renders from one request (CNT-14). **Not done:** `J`/`K` previous/next — the page does not know which list it was opened from, and carrying that in the URL was more than the shortcut is worth for now | S | partial |

---

## Phase 2 — Filters, lists and the table

| ID | Change | Size | State |
|---|---|---|---|
| CNT-29 | **Filter panel exposing the whole filter.** Multiple statuses, states, counties, tags (any/all), DNC, acreage range, assessed value range, owner (including "mine" and "unassigned"), created and last-activity date ranges, has email / has phone, source, list membership, and custom fields by their type. All in the URL, as now. The API's `ContactFilter` gains the fields it lacks (`assessedValue`, `lastActivity`, `hasEmail`, `hasPhone`, `source`, `customFields`) | L | done |
| CNT-30 | **Save the current filter as a smart list** from the toolbar, and **edit a smart list** by reopening it in the same panel. Smart lists become the saved-view mechanism rather than a separate, weaker builder. The lists page shows each list's criteria in words | M | done |
| CNT-31 | **Sorting and columns.** Click a header to sort (name, status, acres, assessed value, last activity, created, county, owner); choose and reorder columns, including custom fields; the choice is remembered per browser | M | done |
| CNT-32 | **Table shows more without a click.** Owner, assessed value, county, source and a pin icon for pinned notes become available columns; row hover shows the primary phone's DNC state and last activity in words ("3 days ago") | S | done |
| CNT-33 | **Bulk actions completed.** Assign owner, remove tag, remove from list, clear DNC, set source, export selection (CNT-40). The browser `prompt()` for tags becomes a proper picker | S | done |
| CNT-34 | **Lists page.** Edit name/description/criteria, member count as now, last-changed, "open in table", duplicate a list, and a static list's members page with remove | M | done |

---

## Phase 3 — Tasks and appointments

| ID | Change | Size | State |
|---|---|---|---|
| CNT-35 | **Tasks.** Routes for the existing `Task` model: create, complete, reassign, due date, priority; permissions `contacts:task:*` in the catalog. On the record: the Tasks tab and a "New task" action. A **My tasks** page under the Contacts nav (due today, overdue, upcoming). Completing a task writes a `task` history entry | M | done |
| CNT-36 | **Appointments.** A new `Appointment` model: contact, with whom (a user), start/end, location or phone, purpose, outcome (held / no-show / rescheduled / cancelled), notes. Manual for now — created from the record's Schedule action — with an Appointments tab and an **Upcoming** list. The calendars module, when built, syncs these; the record is designed so that only the sync is new. Decision D3 | M | done |

---

## Phase 4 — Import

| ID | Change | Size | State |
|---|---|---|---|
| CNT-37 | **Map onto custom fields, tags, lists and the owner.** The mapping step lists custom field definitions beside the built-in fields; a column can be mapped to "tags (comma-separated)"; the wizard can add every row to a list (the API already accepts `listId`) and assign an owner | S | done |
| CNT-38 | **Duplicate strategy.** Match on external id, then phone digits, then email — in that order, each configurable off. Per import, choose what a match means: **update** (today's behaviour), **skip**, or **create anyway**. The preview step says how many rows will create, update and skip before anything is written. Decision D4 | M | done |
| CNT-39 | **Import history and undo.** Settings → Imports lists every `ImportJob` with counts and who ran it. Undo deletes the contacts an import *created* and leaves the ones it *updated*, saying so; available for 30 days | M | done |
| CNT-40 | **Excel files.** `.xlsx` parsed in the browser (SheetJS) into the same column/row shape the CSV path produces, with a sheet picker. Nothing after the parse changes | S | done |
| CNT-41 | **Saved mappings.** The wizard remembers mappings by header signature, so the second file from the same skip-trace vendor maps itself. Remembered per browser (localStorage), not per account — good enough for one person's vendor files, and no server state to migrate | S | done |
| CNT-42 | **Background import (IMP-08).** A queued job so a 50 MB file does not need the tab open. Needs a worker, which the Vercel deployment cannot host — on the VPS only, or deferred. Listed so it is not forgotten; see decision D5 | L | deferred |

---

## Phase 5 — Export and hygiene

| ID | Change | Size | State |
|---|---|---|---|
| CNT-43 | **Export chooses its columns**, including custom fields and the primary parcel, remembers the choice, exports the current selection or the whole filter, and offers `.xlsx` as well as CSV. Every export writes an audit entry with the filter and the row count — it is the one action that walks data out of the building | M | done |
| CNT-44 | **Duplicate detection.** On create and on edit, warn when the phone digits or email already belong to another contact in the sub-account and offer to open it. A Settings → Duplicates page lists likely pairs (same digits, same email, same name + parcel) with merge (CNT-27) | M | done |

---

## Phase 6 — Channel history

| ID | Change | Size | State |
|---|---|---|---|
| CNT-45 | **Calls and texts from telephony.** When the telephony module lands it writes `call` and `sms` history through CNT-13 with recordings, duration and outcome in `metadata`, and the Call / Text actions on the record go live. The contract is in [history.ts](../src/server/modules/contacts/history.ts); the buttons are on the page, greyed with the reason | — | blocked on telephony |
| CNT-46 | **Inbound email.** Replies land as `inbound` `EmailMessage` rows on the contact's Email tab. Needs the email module's inbound handling (webhook or IMAP); the tab already renders direction and status | — | blocked on email inbound |

### Where the build departed from the plan

- **Import preview is sampled**, not whole-file: the first 20,000 rows (ten chunks) are
  checked against existing contacts, and the wizard says so when the file is larger. A full
  pass over a 400,000-row file would be 200 requests before the import even starts.
- **Import history entries are written per contact** (`import` type, created or updated), so
  a contact's Changes tab shows which file touched it. One `insertMany` per batch.
- **Merge takes no field by default** on the Duplicates page ("keep this one"): the survivor's
  values win, the duplicate fills only what is missing, and sets are unioned. The dialog on
  the contact page offers the per-field choice.
- **Custom field values are now validated** against their definition on every write — a
  currency field refuses "twelve", a select refuses an option that does not exist, a required
  field must be present on create. Previously anything was stored under any key.
- **A smart list's conditions intersect with the user's own filter** when viewed in the
  table. Before, the list's keys overwrote the user's, so filtering a list to one county
  showed the whole list.
- **The caller role can manage tasks and appointments**, and every account role gained
  explicit `task:read` / `appointment:read`: `implies` in the catalog is advice to the role
  editor, not something the permission check expands. The list routes also accept the
  `manage` permission as sufficient.

---

## Decisions

None was answered, so each went ahead on its recommendation. D2 (multiple parcels) is the
one that changes the data shape and is the hardest to reverse.

| # | Question | Recommendation |
|---|---|---|
| D1 | Phone normalisation: assume US numbers? | Yes. Land-investing lists are US owners. Ten digits get a `1`; eleven starting with `1` are kept; anything else is stored as typed with no digits form, and flagged in the UI as "not a US number" |
| D2 | One parcel per contact, or many? | Many, with a primary (CNT-22). It is the largest change in the plan and the one most worth doing early, because every later feature (filters, import, export) would otherwise be built around a shape that has to change |
| D3 | Do appointments live in Contacts or wait for the Calendars module? | Build the record in Contacts now, manual entry only. Calendars later adds sync. Waiting means the contact page has a gap for a year |
| D4 | Default duplicate strategy on import | **Update**, as today — a skip-trace refresh is the common case. The choice is per import and the preview shows the counts |
| D5 | Background import | Defer. The chunked import already handles a 50 MB file without timing out; the cost is a tab that stays open for ~12 minutes. A worker is infrastructure the Vercel deployment cannot run |
| D6 | Are tasks their own module in the catalog, or part of Contacts? | Part of Contacts, with their own permission group. A task is always about a contact here; a separate module is a toggle nobody would turn off |
| D7 | Retention of history | Keep forever. Owner lists are worked over years, and "we called this parcel in 2024" is the point of the record |

---

## Out of scope

- The dialer, SMS sending, call recording — telephony module.
- Calendar sync — calendars module.
- Campaigns and sequences — campaigns module.
- Skip-tracing or data enrichment integrations.

---

## Verified

Run on 2026-10-02 against an in-memory MongoDB 8.2 replica set. Nothing was run against Atlas.

- `npm test`: **195 tests passing** — 35 shared (10 new: filter parsing/description,
  phone normalisation), 149 API (28 new, in
  [contacts-ii.routes.test.ts](../src/server/modules/contacts/contacts-ii.routes.test.ts)
  and [derive.test.ts](../src/server/modules/contacts/derive.test.ts)), 11 web.
- `npm run typecheck` clean; `eslint src` clean; `next build` compiles every route.
- **Phase 0:** phones normalise to digits and alternates never repeat the primary; a legacy
  single `property` is lifted into `properties` as the primary; exactly one parcel is primary;
  the detail endpoint returns owner, definitions, lists, open tasks, upcoming appointments,
  pinned notes, per-type counts and the first history page; history pages by cursor with no
  repeats and filters by type; a malformed entry (a call with `direction: 'sideways'`) is
  refused; an owner outside the sub-account is refused.
- **Phase 1:** notes pin, edit and delete, other entry types refuse both; field edits write a
  `field_change` naming the fields; static membership and matching smart lists appear on
  the record and can be added/removed; merge folds history, tasks, tags, alternate phones
  and parcels into the survivor, keeps the survivor's primary, carries do-not-contact from
  either, and removes the duplicate; merge needs the delete permission and refuses a
  self-merge; the email tab entry carries the message's status.
- **Phase 2:** owner `me`/`none`, has-email, any-parcel acreage and county, assessed value,
  tags any/all, source and created-range conditions each narrow the list; a custom-field
  condition filters and facets name the fields and owners; a smart list stores the shared
  shape, refuses an empty filter, edits and duplicates; the table sorts by acres; bulk
  assign-owner (and refusing a foreign owner), remove-from-list and set-source work.
- **Phase 3:** a task defaults to its creator, appears in "mine" and not in someone else's,
  completing it writes history; the caller role can create one. An appointment defaults to
  thirty minutes, keeps its duration when moved, records an outcome, refuses ending before
  starting.
- **Phase 4:** custom fields import from a `cf.` mapping; the preview counts matches; `skip`
  leaves the match alone, `create` makes a second record, `update` updates and reports a bad
  custom value without failing the row; a job is recorded with counts and the runner's name;
  the job owner is set on created contacts; undo deletes the created contact and keeps the
  updated one, and refuses a second time.
- **Phase 5:** CSV export with chosen columns including owner and a custom field; `.xlsx`
  export of a selection by POST, read back with SheetJS; a request for only unknown columns
  is refused. The duplicate check finds a contact by digits or email and excludes a given id;
  the pairs page groups by phone and by email.
- **Migration:** run against data written in the old shape — a contact with `property` only
  and no digits, a `list_added` entry, tasks without a status. Dry run reported 1 / 1 / 2 and
  wrote nothing; `--apply` derived digits, alternates, a primary parcel and search tokens,
  renamed the type, set the statuses; a second `--apply` found nothing to do.
- **The running app**, signed in as the seeded agency owner over HTTP: the contacts list
  renders with panel filters and a sort; the contact page renders with history, parcel and
  lists cards and, after creating them through the API, shows a task, an appointment, a
  pinned note and a logged call; the tasks, appointments, lists, import, Settings → Imports
  and Settings → Duplicates pages render; the sidebar shows Tasks and Appointments under
  Contacts and Imports/Duplicates under Settings; a smart list is described in words on the
  lists page; an import through jobs creates rows, is listed, is found by the duplicate check
  by digits, and undoes; CSV and `.xlsx` exports download through the proxy; bulk
  assign-owner shows on the page.

## Not verified

- **No browser.** Pages were fetched over HTTP and checked for content. None of the new
  forms — the per-card editors, the history composer, the filter panel, the column chooser,
  the export dialog, the merge dialog, the import wizard's Excel path and preview, the tasks
  and appointments forms — was clicked through. Their server actions call endpoints that are
  tested; the forms themselves are the least-proven part of this work.
- **Excel parsing in the browser.** The wizard's `.xlsx` path uses SheetJS loaded on demand;
  it was type-checked and built, not run on a real workbook.
- **Nothing against Atlas, nothing deployed.** The first `sync-indexes` on a real cluster
  builds nine new indexes on contacts; on a large collection that takes time.
- **Performance of the detail endpoint** at scale: it runs ten queries in parallel plus one
  per smart list; with many smart lists that is many small queries. Fine for tens; measure
  before hundreds.
