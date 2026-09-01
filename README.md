# MediStock

**Real-time critical-medicine finder, geospatial stock aggregator, and atomic reservation system.**

MediStock lets a patient find who *actually* has a critical medicine in stock right now, hold it for 30 minutes with a one-time code, and collect it at the counter — without the pharmacy ever overselling a single unit.

**Backend** (`apps/api`)

- **Runtime:** Node.js 20+, TypeScript (strict)
- **HTTP:** Fastify 4
- **Durable store:** PostgreSQL 16 + Prisma
- **Hot path:** Redis 7 (ioredis) — GEO index, stock counters, atomic Lua
- **Jobs:** BullMQ (delayed auto-reclamation)
- **Validation:** Zod
- **Auth:** JWT + RBAC (`PATIENT`, `PHARMACIST`, `ADMIN`)

**Frontend** (`apps/web`)

- React 18 + Vite 5 + TypeScript (strict)
- React Router 6, TanStack Query 5, Tailwind CSS 3
- One SPA for all three roles; served by nginx in Docker, proxying `/api` to the Fastify service

### Repository layout

```
medi stock/
├── package.json            workspace convenience scripts (no deps)
├── docker-compose.yml      postgres · redis · migrate · api · worker · web
├── README.md
└── apps/
    ├── api/                Fastify API + BullMQ worker + Prisma
    │   ├── prisma/         schema.prisma · seed.ts
    │   ├── src/            config · lib · scripts/lua · validators · services · queues · workers · plugins · routes
    │   ├── Dockerfile
    │   └── package.json
    └── web/                React SPA
        ├── src/            lib · auth · api · components · pages
        ├── Dockerfile · nginx.conf
        └── package.json
```

---

## 1. Problem analysis

### Why traditional inventory APIs fail during a shortage

During a shortage the access pattern inverts: demand for a single SKU spikes 10–100×, many patients converge on the same few pharmacies in the same minute, and the value of *accuracy* rises sharply because a wasted trip to a pharmacy that is already sold out has a real health cost.

A conventional "CRUD over a `stock` column" API breaks in four specific ways:

| # | Failure mode | Root cause | Consequence |
|---|--------------|-----------|-------------|
| 1 | **Overselling** | `SELECT stock` → app checks `stock >= qty` → `UPDATE stock = stock - qty` is a read-modify-write with a gap. Two requests both read `1`, both pass the check, both decrement. | Pharmacy promises stock it does not have; patient arrives to nothing. |
| 2 | **Race conditions on "hold"** | Even with `UPDATE ... SET stock = stock - qty WHERE stock >= qty`, layering *temporary* holds, TTLs, and reversals on top produces interleavings that a single statement cannot express. Row locks held for the length of a hold serialise the hottest row in the system. | Either lock contention collapses throughput, or holds leak and permanently sequester stock. |
| 3 | **Stale inventory** | Reads are served from the same OLTP row that writes contend on; caches are invalidated lazily; POS pushes are applied with full-table locks. | Search results show stock that was gone minutes ago. |
| 4 | **Slow spatial queries** | `ORDER BY earth_distance(...)` or PostGIS `KNN` on every search, joined to inventory and filtered by availability, under spike load, with no geo cache. | P99 search latency in seconds exactly when traffic peaks. |

### The architectural solution

MediStock separates the three workloads that a shortage stresses and gives each the datastore that fits it:

1. **Read-heavy spatial offload to Redis.**
   Verified pharmacy coordinates are mirrored into a Redis GEO set (`GEOADD`). Proximity search is a single `GEOSEARCH ... BYRADIUS ... ASC WITHDIST` — sorted, distance-annotated, sub-millisecond — followed by **one** batched SQL query that resolves availability (`totalStock - heldStock > 0`) and the medicine/pharmacy detail for just the candidate pharmacies. PostgreSQL never sorts by distance.

2. **Atomic reservation holds in Redis, durable record in PostgreSQL.**
   Each inventory row has a Redis hash `{ total, held }`. A hold runs `holdStock.lua`, which checks `(total - held) >= requested` **and** increments `held` **in one indivisible server-side step** — the check-then-act gap that causes overselling simply does not exist. Only after Redis accepts the hold do we write the `Reservation` row and bump `heldStock` inside an explicit DB transaction. If that transaction fails, the Redis counter is compensated back down.

3. **Automated background reclamation.**
   Every hold enqueues a BullMQ delayed job at `now + 30 min`. When it fires, the worker flips the hold to `EXPIRED` *only if it is still `PENDING`* and returns the units to availability in both stores immediately. Claims and cancellations cancel the job and do the same math with a different terminal status. No cron sweep, no leaked stock.

**Consistency model.** PostgreSQL is the source of truth. Redis is a fast, self-healing mirror: `initStock.lua` re-seeds a missing hash from the DB row on demand, and `POST /pharmacies/geo/rebuild` rebuilds the GEO index from scratch. Every stock mutation is applied to PostgreSQL first (transactionally) and then to Redis.

---

## 2. Architecture

```
                       ┌──────────────────────────────────────────────┐
   PATIENT  ──────────▶│  Fastify API  (JWT + RBAC, Zod, rate-limit)   │
   PHARMACIST ─────────▶│                                              │
   ADMIN ─────────────▶│  /medicines/search  /reservations/*  ...      │
                       └───────┬───────────────────────┬──────────────┘
                               │                       │
                 GEOSEARCH +   │                       │  atomic Lua
                 counter reads │                       │  (holdStock / release / commit)
                               ▼                       ▼
                        ┌─────────────┐         ┌─────────────┐
                        │ PostgreSQL  │◀───────▶│    Redis    │
                        │  (truth)    │  seed / │  GEO set    │
                        │  Prisma     │  rebuild│  stock:{id} │
                        └──────┬──────┘         └──────┬──────┘
                               │                       │
                               │                 delayed jobs
                               ▼                       ▼
                        ┌───────────────────────────────────────┐
                        │  BullMQ expiry worker (separate proc) │
                        │  PENDING @ expiry -> EXPIRED + release │
                        └───────────────────────────────────────┘
```

### Request lifecycles

**Search** — `GEOSEARCH` (Redis) → candidate pharmacy ids + distance → one `$queryRaw` join filtered by `(totalStock - heldStock) > 0` and medicine/generic → merge distances, sort, slice.

**Hold** — load inventory → `initStock` (seed hash if absent) → `holdStock.lua` (atomic check + `held += qty`) → DB tx: `heldStock += qty`, create `Reservation` (6-digit OTP, `expiresAt`) → enqueue delayed job (`jobId = reservationId`) → return OTP + `expiresAt`. DB failure ⇒ `releaseStock.lua` compensation.

**Claim** — `SELECT ... FOR UPDATE` the reservation → validate status `PENDING`, not expired, OTP match, pharmacy owns it → DB tx: `totalStock -= qty`, `heldStock -= qty`, status `CLAIMED` → `commitStock.lua` (Redis `total -= qty`, `held -= qty`) → remove delayed job.

**Expire (worker)** / **Cancel (patient)** — `SELECT ... FOR UPDATE` → if still `PENDING`: `heldStock -= qty` (floored at 0), status `EXPIRED`/`CANCELLED` → `releaseStock.lua`. Non-`PENDING` ⇒ no-op.

**Batch sync** — idempotency check on `batchId` → resolve/create medicines up front → chunked upsert transactions keyed on `(pharmacyId, medicineId)` → refresh Redis `total` (preserve `held`) → record `InventorySyncBatch`.

---

## 3. Data model

`prisma/schema.prisma` — five core models plus an idempotency ledger.

| Model | Purpose | Notable indexes / constraints |
|-------|---------|------------------------------|
| `User` | Auth identity + role. `pharmacyId` set for `PHARMACIST`. | `@@index([role])`, `email @unique` |
| `Pharmacy` | Location + verification status. Verified rows are mirrored to the Redis GEO set. | `@@index([status])`, `@@index([latitude, longitude])`, `licenseNo @unique` |
| `Medicine` | Catalogue entry. `genericFormula` drives salt-level substitution. | `@@unique([name, strength, form, brand])`, `@@index([genericFormula])`, `@@index([isCritical])` |
| `Inventory` | Per-pharmacy stock line. `totalStock` = shelf count, `heldStock` = sum of active holds. `version` is a change counter. | `@@unique([pharmacyId, medicineId])`, `@@unique([pharmacyId, sku])` |
| `Reservation` | A hold. `code` = 6-digit OTP, `jobId` = BullMQ delayed job. | `@@index([status, expiresAt])`, `@@index([pharmacyId, status])`, `@@index([code])` |
| `InventorySyncBatch` | Idempotency ledger for POS ingestion. | `batchId @unique` |

Enums: `Role`, `PharmacyStatus (PENDING│VERIFIED│SUSPENDED)`, `ReservationStatus (PENDING│CLAIMED│EXPIRED│CANCELLED)`.

**Availability** is always `totalStock - heldStock`, never a stored column — it cannot drift.

---

## 4. Concurrency & the Lua scripts

`src/scripts/lua/` — each script is executed atomically by Redis.

| Script | Keys / Args | Returns | Used by |
|--------|-------------|---------|---------|
| `holdStock.lua` | `stock:{id}` / `qty` | new `held`, or `-1` missing / `-2` insufficient / `-3` bad qty | `POST /reservations/hold` |
| `initStock.lua` | `stock:{id}` / `total`, `held` | `1` created / `0` existed | seed-on-demand before any hold |
| `releaseStock.lua` | `stock:{id}` / `qty` | new `held` (floored 0), or `-1` / `-3` | expiry worker, cancel, hold-compensation |
| `commitStock.lua` | `stock:{id}` / `qty` | `[newTotal, newHeld]` (floored 0) | `POST /reservations/claim` |

They are registered as ioredis custom commands in `src/lib/redis-scripts.ts` (`defineCommand` → `EVALSHA` with automatic `EVAL` fallback), so application code calls `redis.holdStock(key, qty)` directly and typed.

**Why Lua and not a DB transaction?** The hot row during a shortage is a single inventory line. A row lock held for the *duration of a 30-minute hold* is impossible, and a lock held only for the decrement still serialises every concurrent buyer through one Postgres row. Redis executes the whole check-and-increment as one non-interleaved operation in memory, then the durable write happens off the hot path.

---

## 5. API reference

Base URL: `http://localhost:3000`  ·  All API routes are under `/api/v1`.
Auth: `Authorization: Bearer <token>`. Errors: `{ "error": { "code", "message", "details?" } }`.

### Auth

| Method | Path | Role | Body |
|--------|------|------|------|
| `POST` | `/api/v1/auth/register` | public | `{ email, password, fullName, phone? }` → `201 { token, user }` (role `PATIENT`) |
| `POST` | `/api/v1/auth/login` | public | `{ email, password }` → `{ token, user }` |
| `GET` | `/api/v1/auth/me` | any | → `{ user }` |

### Medicines & search

| Method | Path | Role | Notes |
|--------|------|------|-------|
| `GET` | `/api/v1/medicines/search` | any | Query: `lat`, `lon`, `radiusKm` (≤ `GEO_MAX_RADIUS_KM`), **one of** `medicineId` / `genericFormula`, `limit` (≤ `GEO_MAX_RESULTS`). Returns results sorted by `distanceKm` asc. |
| `GET` | `/api/v1/medicines` | any | Query: `q?`, `critical?=true\|false`, `limit?`. |
| `POST` | `/api/v1/medicines` | `ADMIN` | `{ name, brand?, genericFormula, strength, form, isCritical? }` |

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/medicines/search?lat=31.5204&lon=74.3587&radiusKm=10&genericFormula=amoxicillin&limit=10"
```

```jsonc
{
  "query": { "lat": 31.5204, "lon": 74.3587, "radiusKm": 10, "medicineId": null, "genericFormula": "amoxicillin" },
  "count": 2,
  "results": [
    {
      "inventoryId": "…",
      "distanceKm": 0,
      "availableStock": 23,
      "sku": "PH-0001-Amoxil",
      "price": { "amountCents": 1899, "currency": "PKR" },
      "medicine": { "id": "…", "name": "Amoxicillin", "brand": "Amoxil", "genericFormula": "amoxicillin", "strength": "500mg", "form": "capsule", "isCritical": true },
      "pharmacy": { "id": "…", "name": "Gulberg Care Pharmacy", "address": "…", "phone": "…", "latitude": 31.5204, "longitude": 74.3587 }
    }
  ]
}
```

### Reservations

| Method | Path | Role | Body → Result |
|--------|------|------|---------------|
| `POST` | `/api/v1/reservations/hold` | `PATIENT` | `{ inventoryId, quantity }` (`quantity` ≤ `MAX_HOLD_QUANTITY`) → `201 { reservation }` incl. `otpCode`, `expiresAt`. `409 INSUFFICIENT_STOCK` if unavailable. |
| `POST` | `/api/v1/reservations/claim` | `PHARMACIST` / `ADMIN` | `{ reservationId, otpCode }` → `{ reservation }` (status `CLAIMED`). `409` on wrong/expired/used. |
| `POST` | `/api/v1/reservations/cancel` | `PATIENT` | `{ reservationId }` → `{ outcome }` (status `CANCELLED`, stock released). |
| `GET` | `/api/v1/reservations` | any | Query: `status?`, `limit?`. Scoped: patients see their own, pharmacists their pharmacy's, admins all. |
| `GET` | `/api/v1/reservations/:id` | any (scoped) | `otpCode` echoed to the owning patient/admin, never to a pharmacist. |

```bash
curl -s -X POST -H "Authorization: Bearer $PATIENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"inventoryId":"…","quantity":2}' \
  http://localhost:3000/api/v1/reservations/hold
```

### Inventory (POS)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| `POST` | `/api/v1/inventory/batch-sync` | `PHARMACIST` / `ADMIN` | JSON `{ batchId, pharmacyId?, items[] }` **or** `Content-Type: text/csv` body with `?batchId=&pharmacyId=`. Idempotent on `batchId` (`200 ALREADY_PROCESSED` vs `202 PROCESSED`). Pharmacists are pinned to their own pharmacy. |
| `GET` | `/api/v1/inventory` | `PHARMACIST` / `ADMIN` | Query: `pharmacyId?` (admin), `limit?`. Includes `availableStock`. |

`items[]` element: `{ sku, totalStock, priceCents, currency?, ` **either** `medicineId` **or** `medicineName + genericFormula + strength + form (+ brand?)` `}`.

CSV header: `sku,medicineId,medicineName,genericFormula,strength,form,brand,totalStock,priceCents,currency`

```bash
curl -s -X POST -H "Authorization: Bearer $PH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"batchId":"pos-2026-08-30-001","items":[
        {"sku":"A-500","medicineId":"…","totalStock":120,"priceCents":45000,"currency":"PKR"}]}' \
  http://localhost:3000/api/v1/inventory/batch-sync
```

### Pharmacy administration (`ADMIN` only)

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/pharmacies` | `{ name, licenseNo, address, phone, latitude, longitude, status? }`. `VERIFIED` ⇒ added to GEO index. |
| `GET` | `/api/v1/pharmacies` | list |
| `PATCH` | `/api/v1/pharmacies/:id/status` | `{ status }`. `VERIFIED` ⇒ GEO add; else GEO remove. |
| `POST` | `/api/v1/pharmacies/:id/staff` | create a `PHARMACIST` bound to the pharmacy. |
| `POST` | `/api/v1/pharmacies/geo/rebuild` | rebuild the Redis GEO index from Postgres. |

### Ops

`GET /health` → `{ status: "ok" | "degraded", checks: { database, redis } }`.

---

## 6. Running it

### With Docker Compose (everything)

```bash
docker compose up --build
```

Brings up **postgres**, **redis**, a one-shot **migrate** (schema + seed), the **api** (`:3000`), the **worker**, and the **web** SPA on **http://localhost:5173** (nginx, proxying `/api` → api).

Seed credentials (password `Password123!` for all):
`admin@medistock.dev` · `patient@medistock.dev` · `pharmacist.ph-0001@medistock.dev`

```bash
curl -s localhost:3000/health
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"patient@medistock.dev","password":"Password123!"}' | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/v1/medicines/search?lat=31.5204&lon=74.3587&radiusKm=10&genericFormula=amoxicillin"
```

### Local development

```bash
# 1. Infra only
docker compose up -d postgres redis

# 2. Install both apps
npm run install:all                       # = npm install in apps/api and apps/web
cp apps/api/.env.example apps/api/.env     # DATABASE_URL / REDIS_URL point at localhost

# 3. Schema + client + seed
npm run prisma:migrate                     # creates apps/api/prisma/migrations + applies (dev)
npm run db:seed

# 4. Run — three terminals (from the repo root)
npm run dev:api                            # Fastify API   → http://localhost:3000
npm run dev:worker                         # BullMQ expiry worker
npm run dev:web                            # Vite dev server → http://localhost:5173 (proxies /api)

# Or run the worker inside the API process:
#   RUN_WORKER_IN_PROCESS=true npm run dev:api
```

### Scripts

Root (`package.json`) — thin wrappers that delegate into `apps/*`:

| Script | Action |
|--------|--------|
| `npm run install:all` | install `apps/api` + `apps/web` |
| `npm run dev:api` / `dev:worker` / `dev:web` | watch-mode API / worker / Vite |
| `npm run build` | build API (`tsc` + Lua copy) then web (`tsc --noEmit` + `vite build`) |
| `npm run typecheck` | typecheck both apps |
| `npm run prisma:migrate` / `db:seed` | (in `apps/api`) dev migration / seed + Redis prime |

`apps/api` also exposes `start`, `start:worker`, `prisma:deploy`, `prisma:generate`.
`apps/web` also exposes `preview` (serve the production build locally).

---

## 7. Configuration

All API config is validated by Zod at boot (`apps/api/src/config/env.ts`); an invalid value aborts start-up. The web app reads only `VITE_API_BASE_URL` (empty = same-origin `/api`, proxied by Vite in dev and nginx in Docker).

| Var | Default | Meaning |
|-----|---------|---------|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | bind address |
| `LOG_LEVEL` | `info` | pino level |
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | — (required, ≥16 chars) | HS256 signing key |
| `JWT_EXPIRES_IN` | `24h` | token lifetime |
| `RESERVATION_TTL_MINUTES` | `30` | hold lifetime / delayed-job delay |
| `MAX_HOLD_QUANTITY` | `5` | max units per hold |
| `GEO_DEFAULT_RADIUS_KM` / `GEO_MAX_RADIUS_KM` | `5` / `50` | search radius default / ceiling |
| `GEO_MAX_RESULTS` | `100` | search `limit` ceiling |
| `BATCH_SYNC_MAX_ITEMS` | `5000` | max rows per batch |
| `RATE_LIMIT_MAX` | `200` | requests / minute / IP |
| `RUN_WORKER_IN_PROCESS` | `false` | also run the expiry worker in the API process |
| `EXPIRY_WORKER_CONCURRENCY` | `10` | worker job concurrency |

---

## 8. Project layout

```
apps/api/
  prisma/
    schema.prisma          5 models + idempotency ledger, enums, indexes
    seed.ts                demo users / pharmacies / medicines / inventory + Redis priming
  src/
    config/                env (Zod), prisma singleton, redis singleton + key helpers
    scripts/lua/           holdStock · initStock · releaseStock · commitStock
    lib/                   errors, otp, password, csv, redis-scripts (defineCommand), serializers
    validators/            Zod schemas: auth, medicine, reservation, inventory, pharmacy
    services/
      geo.service.ts       GEO index maintenance + GEOSEARCH-then-batch-SQL search
      reservation.service.ts  atomic hold, claim, release (expire/cancel), reads
      inventory.service.ts idempotent chunked batch upsert + Redis refresh
    queues/reservation.queue.ts   BullMQ delayed queue + schedule/cancel helpers
    workers/expiry.worker.ts      BullMQ worker: PENDING@expiry -> EXPIRED + release
    plugins/               auth (JWT + authorize(...roles)), central error handler
    routes/                auth · medicine · reservation · inventory · pharmacy
    app.ts                 Fastify assembly (helmet, cors, rate-limit, health, /api/v1)
    server.ts              listen + graceful shutdown (drains worker, queue, prisma, redis)

apps/web/
  src/
    lib/         api.ts (fetch wrapper + auth hooks), types.ts, format.ts
    auth/        AuthContext (token in localStorage), RequireAuth (role guard)
    api/         one module per API area: auth, medicines, reservations, inventory, pharmacies
    components/  ui.tsx (Button/Field/Card/Alert/Badge…), Layout, Countdown
    pages/       Login · Register · Search · MyReservations · ReservationDetail
                 Claim · Inventory · BatchSync · AdminPharmacies · AdminMedicines
    App.tsx      routes + per-role guards;  main.tsx  QueryClient + Router + AuthProvider
```

---

## 10. Frontend (`apps/web`)

A single React SPA that adapts to the signed-in role.

| Role | Pages |
|------|-------|
| **PATIENT** | **Search** (geolocation or manual lat/lon, radius, generic-formula *or* specific medicine → distance-sorted results → *Hold for 30 min*), **My reservations** (auto-refreshing list), **Reservation detail** (large OTP, live mm:ss countdown, cancel) |
| **PHARMACIST** | **Claim** (reservation id + 6-digit OTP → fulfil), **Inventory** (stock lines, available = total − held), **Batch sync** (JSON or CSV, file upload or paste, client-generated idempotent `batchId`) |
| **ADMIN** | Everything above, plus **Pharmacies** (create, verify/suspend → toggles the Redis GEO index, add pharmacist staff, rebuild GEO index) and **Medicines** (catalogue list + create) |

- **Auth**: JWT kept in `localStorage`; the fetch wrapper attaches `Authorization` and logs out on any `401`. Guards redirect unauthenticated users to `/login` and wrong-role users to their home page.
- **Data**: TanStack Query for caching, background refetch, and mutation state. No global store beyond the auth context.
- **Networking**: all calls are same-origin `/api/v1/...`; Vite proxies to the API in dev, nginx in the Docker image — so there is no CORS dependency. Point at a remote API with `VITE_API_BASE_URL`.
- **Verified**: `tsc --noEmit` clean, `vite build` produces `apps/web/dist` (~76 kB gzipped JS).

## 9. Operational notes

- **Two processes.** Run `api` and `worker` as independent deployments; scale the worker horizontally (BullMQ distributes jobs, `FOR UPDATE` keeps releases correct under concurrency).
- **Redis is disposable but should be durable.** With AOF on (compose enables it) counters survive a restart. If Redis is wiped, `initStock.lua` re-seeds each stock hash from Postgres on the next hold, and `POST /pharmacies/geo/rebuild` restores the GEO index. Availability reads in search come straight from Postgres, so search keeps working regardless.
- **Drift.** Every mutation writes Postgres (transaction) then Redis. The `Inventory.version` counter and `lastSyncedAt` support a periodic reconciliation job that re-`HSET`s `total`/`held` from the DB.
- **Idempotency.** POS clients must send a stable `batchId`; retries are free.
- **Security.** Helmet, per-IP rate limiting (Redis-backed), bcrypt (cost 12), role-checked routes, OTP never exposed to pharmacists. Replace `JWT_SECRET` before any real deployment.
