import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { redis, PHARMACY_GEO_KEY } from '../config/redis';
import type { SearchQuery } from '../validators/medicine.schema';

export interface NearbyPharmacy {
  pharmacyId: string;
  distanceKm: number;
}

export interface StockSearchResult {
  inventoryId: string;
  distanceKm: number;
  availableStock: number;
  sku: string;
  price: { amountCents: number; currency: string };
  medicine: {
    id: string;
    name: string;
    brand: string | null;
    genericFormula: string;
    strength: string;
    form: string;
    isCritical: boolean;
  };
  pharmacy: {
    id: string;
    name: string;
    address: string;
    phone: string;
    latitude: number;
    longitude: number;
  };
}

interface RawStockRow {
  inventoryId: string;
  pharmacyId: string;
  medicineId: string;
  sku: string;
  totalStock: number;
  heldStock: number;
  availableStock: number;
  priceCents: number;
  currency: string;
  medicineName: string;
  brand: string | null;
  genericFormula: string;
  strength: string;
  form: string;
  isCritical: boolean;
  pharmacyName: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
}

// ── Redis GEO index maintenance ────────────────────────────────────────────

export async function indexPharmacyLocation(pharmacy: {
  id: string;
  latitude: number;
  longitude: number;
}): Promise<void> {
  await redis.geoadd(PHARMACY_GEO_KEY, pharmacy.longitude, pharmacy.latitude, pharmacy.id);
}

export async function removePharmacyLocation(pharmacyId: string): Promise<void> {
  await redis.zrem(PHARMACY_GEO_KEY, pharmacyId);
}

/** Full rebuild of the GEO index from Postgres — safe to run any time. */
export async function rebuildPharmacyGeoIndex(): Promise<number> {
  const pharmacies = await prisma.pharmacy.findMany({
    where: { status: 'VERIFIED' },
    select: { id: true, latitude: true, longitude: true },
  });

  const pipeline = redis.pipeline();
  pipeline.del(PHARMACY_GEO_KEY);
  for (const pharmacy of pharmacies) {
    pipeline.geoadd(PHARMACY_GEO_KEY, pharmacy.longitude, pharmacy.latitude, pharmacy.id);
  }
  await pipeline.exec();

  return pharmacies.length;
}

// ── Proximity search ──────────────────────────────────────────────────────

/**
 * Reads pharmacy ids within `radiusKm`, already sorted nearest-first, straight
 * out of Redis. The distance Redis computes is reused verbatim in the response.
 */
async function nearbyPharmacies(
  lat: number,
  lon: number,
  radiusKm: number,
  count: number,
): Promise<NearbyPharmacy[]> {
  const raw = (await redis.geosearch(
    PHARMACY_GEO_KEY,
    'FROMLONLAT',
    lon,
    lat,
    'BYRADIUS',
    radiusKm,
    'km',
    'ASC',
    'COUNT',
    count,
    'WITHDIST',
  )) as unknown as Array<[string, string]>;

  return raw.map((entry) => ({ pharmacyId: entry[0], distanceKm: Number(entry[1]) }));
}

/**
 * Geospatial proximity stock search.
 *
 *  1. Redis GEOSEARCH  -> candidate pharmacy ids + distance (read-heavy offload).
 *  2. One batched raw SQL query  -> availability (`total - held > 0`) plus the
 *     medicine / pharmacy detail needed for the response. The field-to-field
 *     comparison is expressed directly in SQL so the database does the filtering.
 *  3. Merge distances, sort nearest-first, truncate to `limit`.
 */
export async function searchAvailableStock(query: SearchQuery): Promise<StockSearchResult[]> {
  // Over-fetch pharmacy candidates: many nearby pharmacies will not stock the
  // requested medicine, so we widen the net before the SQL availability filter.
  const candidateCount = Math.min(query.limit * 5, 500);
  const nearby = await nearbyPharmacies(query.lat, query.lon, query.radiusKm, candidateCount);
  if (nearby.length === 0) {
    return [];
  }

  const distanceById = new Map(nearby.map((n) => [n.pharmacyId, n.distanceKm]));
  const pharmacyIds = nearby.map((n) => n.pharmacyId);

  const medicineFilter = query.medicineId
    ? Prisma.sql`i."medicineId" = ${query.medicineId}::uuid`
    : Prisma.sql`m."genericFormula" ILIKE ${query.genericFormula}`;

  const rows = await prisma.$queryRaw<RawStockRow[]>(Prisma.sql`
    SELECT
      i.id                              AS "inventoryId",
      i."pharmacyId"                    AS "pharmacyId",
      i."medicineId"                    AS "medicineId",
      i.sku                             AS "sku",
      i."totalStock"                    AS "totalStock",
      i."heldStock"                     AS "heldStock",
      (i."totalStock" - i."heldStock")  AS "availableStock",
      i."priceCents"                    AS "priceCents",
      i.currency                        AS "currency",
      m.name                            AS "medicineName",
      m.brand                           AS "brand",
      m."genericFormula"                AS "genericFormula",
      m.strength                        AS "strength",
      m.form                            AS "form",
      m."isCritical"                    AS "isCritical",
      p.name                            AS "pharmacyName",
      p.address                         AS "address",
      p.phone                           AS "phone",
      p.latitude                        AS "latitude",
      p.longitude                       AS "longitude"
    FROM "Inventory" i
    JOIN "Medicine" m ON m.id = i."medicineId"
    JOIN "Pharmacy" p ON p.id = i."pharmacyId"
    WHERE i."pharmacyId"::text IN (${Prisma.join(pharmacyIds)})
      AND p.status = 'VERIFIED'
      AND (i."totalStock" - i."heldStock") > 0
      AND ${medicineFilter}
  `);

  return rows
    .map<StockSearchResult>((row) => ({
      inventoryId: row.inventoryId,
      distanceKm: Number((distanceById.get(row.pharmacyId) ?? 0).toFixed(3)),
      availableStock: Number(row.availableStock),
      sku: row.sku,
      price: { amountCents: Number(row.priceCents), currency: row.currency },
      medicine: {
        id: row.medicineId,
        name: row.medicineName,
        brand: row.brand || null,
        genericFormula: row.genericFormula,
        strength: row.strength,
        form: row.form,
        isCritical: row.isCritical,
      },
      pharmacy: {
        id: row.pharmacyId,
        name: row.pharmacyName,
        address: row.address,
        phone: row.phone,
        latitude: row.latitude,
        longitude: row.longitude,
      },
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, query.limit);
}
