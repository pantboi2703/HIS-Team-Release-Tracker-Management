# Release testing tracker

Internal web app for the HIS IT department, Amrita Hospital Faridabad. It
replaces the shared Excel file that gets emailed around during every software
release.

---

## The problem it fixes

Every release (R18, R19, R20) is tested in phases — **L2-A → L2 → L1** — with
50–250 Redmine tickets per phase. A manager assigns each ticket to a tester.
Testers mark Pass / Fail / Unable to test and write a remark. Failures go back to
the developers, get fixed, and are tested again — often by a different person,
often in a later phase.

The spreadsheet has **one row per item, and that row is overwritten on every
retest**, so the history is destroyed the moment it becomes interesting. The
stats sheet in the current R18 file is showing `#REF!` across the whole pivot.

**The fix: one row becomes three objects, and nothing is ever overwritten.**

| Object | What it is | Has a status? |
|---|---|---|
| **Issue** | A Redmine ticket, e.g. `187521`. Created once, lives across every release. | **No** |
| **Cycle** | One testing window: release + phase + build, e.g. `R20 L2-A B123`. | No — it has a *state* |
| **Test run** | One person testing one issue in one cycle, one time. | **Yes** |

An issue has many runs. When an item fails and is fixed, a **new run** is opened
(round 2). Round 1 stays frozen forever with the original tester's name, verdict,
remark and date. RM 187521 in the seed data has six runs across two releases,
including a regression that the spreadsheet could never have shown.

---

## Running the demo

No database needed — the whole app runs against a seeded in-memory layer.

```bash
cd frontend
npm install
cp .env.example .env      # VITE_USE_MOCK=true
npm run dev               # http://localhost:5173
```

Sign in as any seeded user with the password **`amrita`**:

| Username | Role |
|---|---|
| `ranga.n`, `arvind.a` | admin |
| `bharti.sehgal`, `divitya`, `neetu.singh`, `pankaj`, `rupali`, `kamal.mishra`, `naval`, `kusum.rani` | tester |
| `mayank.pant`, `melanie` | coordinator |

A **role switcher** sits in the header (demo builds only) so admin, tester and
coordinator views can be shown in one sitting without signing out.

### What to show, in order

1. **Cycles** — seven cycles, closed ones marked read-only. Closing warns and
   lists every unattempted run first, and is reversible.
2. **All items** — select rows, the bulk bar replaces the filter row. Open a
   round; round 1 stays frozen and the new row carries a previous-round banner.
3. **Issue timeline → RM 187521** — six runs across R18 and R20, the regression
   flagged, retests and phase moves drawn differently, a gap between releases
   marked as a gap. *This is the screen the Excel file cannot produce.*
4. **Stats** — flip the counting toggle: 86 items becomes 99 runs, and the note
   beside it explains why. Showstoppers, regressions, stuck items, person matrix
   with grey zeros, module breakdown worst-first.
5. **Import wizard** — drop the real `R18 Testing B. 111.xlsx`. It finds the
   header on row 5 under the version rows, skips the stats sheets and the Redmine
   export, catches that RM 199385 appears twice with different descriptions, and
   refuses to continue until a human decides.
6. **Switch to Bharti (tester)** — My items, inline editing, previous-round
   banners. Try to reach Stats: a plain explanation, not a crash.

---

## Running against MongoDB

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full server setup. The short
version:

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # set MONGO_URI and JWT_SECRET
.venv/bin/python -m scripts.seed
.venv/bin/uvicorn app.main:app --reload
```

Then point the frontend at it — this is the only change:

```ini
# frontend/.env
VITE_USE_MOCK=false
VITE_API_BASE=/api
```

The mock layer sits behind the same interface as the real API client, so the
swap is one file (`src/api/client.js`), not a rewrite.

---

## Verifying it

```bash
cd backend && python smoke_test.py
```

90 checks covering role enforcement, optimistic locking, closed-cycle 409s,
retest rounds, regression detection, carry-forward, the import pipeline against
the real R18 workbook, and the Excel export. It runs against an in-memory Mongo,
so no server is required.

---

## Layout

```
frontend/
  src/api/          client.js (the mock/real switch) · mockServer.js · rttApi.js · domain.js
  src/features/     auth · runs · issues · stats · admin · history
  src/styles/       tokens.css — every colour, radius and size, defined once
backend/
  app/routers/      auth · cycles · runs · issues · users · imports · exports · me
  app/services/     runs.py · stats.py · importer.py · exporter.py
  app/deps.py       the permission matrix and the closed-cycle rule
  scripts/seed.py   the same data the demo uses
deploy/             systemd unit · nginx config
```

---

## Decisions worth knowing

**Permissions are enforced on the server.** `app/deps.py` holds the matrix; the
copy in `domain.js` only decides what to draw. A list endpoint injects the
caller's permitted filter from their token — `mine=1` always means the token
holder, and a client-supplied `assignee_id` cannot override it.

**Coordinator is not a viewer.** They assign work, open retest rounds and carry
items into the next cycle. The role is named `coordinator` everywhere in the code.

**Closed cycles reject every write with 409**, including from admins. One
dependency (`writable_cycle`) sits on every write path, so no route can forget.

**Two people editing the same run is handled, not ignored.** Every write carries
a version. A stale version returns 409 with both values, and the UI asks which to
keep. It never silently last-write-wins.

**`issues.derived` is a cache, never the truth.** `rebuild_derived()` recomputes
it from `test_runs` after every write. If it is ever wrong, recompute.

**`run_history` is append-only** and written in the same operation as every run
write. With NABH/GAHO audits, that is what makes the record defensible.

**Nothing is ever deleted.** Items that vanish from a re-imported sheet are
marked `descoped`. People who leave are deactivated, never removed, because their
name still has to resolve in cycles that closed months ago.

**No browser storage.** The access token lives in memory and the refresh token is
an httpOnly cookie, so a page reload signs you out — that is deliberate.

**The export rebuilds the original sheet**, metadata rows and column order
included, with the stats as live `COUNTIFS` formulas rather than computed values.
`XLOOKUP`, `FILTER` and `UNIQUE` are avoided because they break in LibreOffice and
older Excel, and this file gets opened on whatever is installed on the ward PC.

---

## Known gaps

- **Export job state is in process memory.** Restarting the API loses in-flight
  export jobs; the user clicks Download again. Fine for one service on one LAN
  box, worth moving to a collection if it ever runs multi-worker.
- **Merge-mode re-import is implemented but only lightly exercised.** The rules
  are enforced (a tester's status and remark are never overwritten; missing RMs
  are descoped, never deleted) and covered by the smoke test, but it has not been
  run against a second real workbook yet.
- **Verified against an in-memory MongoDB, not a live `mongod`.** The sandbox this
  was built in could not reach the MongoDB download servers. Run
  `python smoke_test.py` and `curl localhost:8000/api/health` on the real server
  as the first check after deploying.
- **No email or Redmine write-back.** Redmine links are one-way, out of the app.
