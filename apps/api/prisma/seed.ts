/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient, PharmacyStatus, ReservationStatus, Role } from '@prisma/client';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const PHARMACY_GEO_KEY = 'medistock:pharmacy:geo';
const stockKey = (inventoryId: string): string => `medistock:stock:${inventoryId}`;

// ── Deterministic PRNG so re-runs produce the same dataset ────────────────
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260831);
const between = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const chance = (p: number): boolean => rnd() < p;
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}
const otp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// ── Catalogue: [name, brand, genericFormula, strength, form, isCritical] ──
type MedTuple = [string, string, string, string, string, boolean];

const MEDICINES: MedTuple[] = [
  // Antibiotics
  ['Amoxicillin', 'Amoxil', 'amoxicillin', '500mg', 'capsule', true],
  ['Amoxicillin', 'Kamox', 'amoxicillin', '500mg', 'capsule', true],
  ['Amoxicillin', 'Amoxil', 'amoxicillin', '250mg', 'capsule', true],
  ['Amoxicillin', 'Amoxil', 'amoxicillin', '125mg/5ml', 'suspension', true],
  ['Co-Amoxiclav', 'Augmentin', 'amoxicillin-clavulanate', '625mg', 'tablet', true],
  ['Co-Amoxiclav', 'Augmentin', 'amoxicillin-clavulanate', '1g', 'tablet', true],
  ['Azithromycin', 'Zithromax', 'azithromycin', '500mg', 'tablet', true],
  ['Azithromycin', 'Azomax', 'azithromycin', '250mg', 'tablet', true],
  ['Ciprofloxacin', 'Cipro', 'ciprofloxacin', '500mg', 'tablet', true],
  ['Levofloxacin', 'Tavanic', 'levofloxacin', '500mg', 'tablet', true],
  ['Ceftriaxone', 'Rocephin', 'ceftriaxone', '1g', 'injection', true],
  ['Cefuroxime', 'Zinnat', 'cefuroxime', '500mg', 'tablet', true],
  ['Doxycycline', 'Vibramycin', 'doxycycline', '100mg', 'capsule', true],
  ['Metronidazole', 'Flagyl', 'metronidazole', '400mg', 'tablet', true],
  ['Cephradine', 'Velosef', 'cephradine', '500mg', 'capsule', true],
  ['Clarithromycin', 'Klacid', 'clarithromycin', '500mg', 'tablet', true],
  ['Trimethoprim-Sulfamethoxazole', 'Septrin', 'co-trimoxazole', '960mg', 'tablet', true],

  // Respiratory
  ['Salbutamol', 'Ventolin', 'salbutamol', '100mcg', 'inhaler', true],
  ['Salbutamol', 'Airomir', 'salbutamol', '100mcg', 'inhaler', true],
  ['Salbutamol', 'Ventolin', 'salbutamol', '5mg/ml', 'nebuliser solution', true],
  ['Budesonide-Formoterol', 'Symbicort', 'budesonide-formoterol', '160/4.5mcg', 'inhaler', true],
  ['Fluticasone-Salmeterol', 'Seretide', 'fluticasone-salmeterol', '250/25mcg', 'inhaler', true],
  ['Ipratropium', 'Atrovent', 'ipratropium', '20mcg', 'inhaler', true],
  ['Montelukast', 'Singulair', 'montelukast', '10mg', 'tablet', false],
  ['Prednisolone', 'Deltacortril', 'prednisolone', '5mg', 'tablet', true],

  // Cardiovascular
  ['Atorvastatin', 'Lipitor', 'atorvastatin', '20mg', 'tablet', false],
  ['Atorvastatin', 'Lipitor', 'atorvastatin', '40mg', 'tablet', false],
  ['Rosuvastatin', 'Crestor', 'rosuvastatin', '10mg', 'tablet', false],
  ['Amlodipine', 'Norvasc', 'amlodipine', '5mg', 'tablet', false],
  ['Amlodipine', 'Norvasc', 'amlodipine', '10mg', 'tablet', false],
  ['Bisoprolol', 'Concor', 'bisoprolol', '5mg', 'tablet', false],
  ['Losartan', 'Cozaar', 'losartan', '50mg', 'tablet', false],
  ['Lisinopril', 'Zestril', 'lisinopril', '10mg', 'tablet', false],
  ['Clopidogrel', 'Plavix', 'clopidogrel', '75mg', 'tablet', true],
  ['Warfarin', 'Marevan', 'warfarin', '5mg', 'tablet', true],
  ['Furosemide', 'Lasix', 'furosemide', '40mg', 'tablet', true],
  ['Glyceryl Trinitrate', 'Nitrolingual', 'glyceryl-trinitrate', '400mcg/dose', 'spray', true],
  ['Digoxin', 'Lanoxin', 'digoxin', '250mcg', 'tablet', true],

  // Diabetes
  ['Metformin', 'Glucophage', 'metformin', '500mg', 'tablet', false],
  ['Metformin', 'Glucophage', 'metformin', '1000mg', 'tablet', false],
  ['Insulin Glargine', 'Lantus', 'insulin-glargine', '100IU/ml', 'injection', true],
  ['Insulin Aspart', 'NovoRapid', 'insulin-aspart', '100IU/ml', 'injection', true],
  ['Gliclazide', 'Diamicron', 'gliclazide', '60mg', 'modified-release tablet', false],
  ['Empagliflozin', 'Jardiance', 'empagliflozin', '10mg', 'tablet', false],
  ['Sitagliptin', 'Januvia', 'sitagliptin', '100mg', 'tablet', false],

  // Analgesics / antipyretics
  ['Paracetamol', 'Panadol', 'paracetamol', '500mg', 'tablet', false],
  ['Paracetamol', 'Panadol', 'paracetamol', '1g', 'tablet', false],
  ['Paracetamol', 'Calpol', 'paracetamol', '500mg', 'tablet', false],
  ['Paracetamol', 'Panadol', 'paracetamol', '120mg/5ml', 'syrup', false],
  ['Ibuprofen', 'Brufen', 'ibuprofen', '400mg', 'tablet', false],
  ['Ibuprofen', 'Advil', 'ibuprofen', '200mg', 'tablet', false],
  ['Diclofenac', 'Voltaren', 'diclofenac', '50mg', 'tablet', false],
  ['Naproxen', 'Naprosyn', 'naproxen', '500mg', 'tablet', false],
  ['Aspirin', 'Loprin', 'acetylsalicylic-acid', '75mg', 'tablet', false],
  ['Tramadol', 'Tramal', 'tramadol', '50mg', 'capsule', true],
  ['Morphine Sulfate', 'MST Continus', 'morphine-sulfate', '10mg', 'modified-release tablet', true],

  // GI
  ['Omeprazole', 'Risek', 'omeprazole', '20mg', 'capsule', false],
  ['Esomeprazole', 'Nexum', 'esomeprazole', '40mg', 'tablet', false],
  ['Pantoprazole', 'Controloc', 'pantoprazole', '40mg', 'tablet', false],
  ['Ondansetron', 'Zofran', 'ondansetron', '4mg', 'tablet', true],
  ['Domperidone', 'Motilium', 'domperidone', '10mg', 'tablet', false],
  ['Loperamide', 'Imodium', 'loperamide', '2mg', 'capsule', false],
  ['Oral Rehydration Salts', 'Rehydran', 'oral-rehydration-salts', 'sachet', 'powder', true],

  // Allergy / emergency / endocrine / neuro
  ['Cetirizine', 'Zyrtec', 'cetirizine', '10mg', 'tablet', false],
  ['Loratadine', 'Claritine', 'loratadine', '10mg', 'tablet', false],
  ['Adrenaline Auto-Injector', 'EpiPen', 'adrenaline', '300mcg', 'injection', true],
  ['Hydrocortisone', 'Solu-Cortef', 'hydrocortisone', '100mg', 'injection', true],
  ['Levothyroxine', 'Eltroxin', 'levothyroxine', '100mcg', 'tablet', true],
  ['Diazepam', 'Valium', 'diazepam', '5mg', 'tablet', true],
  ['Phenytoin', 'Epanutin', 'phenytoin', '100mg', 'capsule', true],
  ['Sodium Valproate', 'Depakine', 'sodium-valproate', '500mg', 'tablet', true],
  ['Carbamazepine', 'Tegretol', 'carbamazepine', '200mg', 'tablet', true],
];

// ── Pharmacies around Lahore, Pakistan (base 31.5204, 74.3587) ──────────
interface PharmacySeed {
  name: string;
  licenseNo: string;
  address: string;
  dLat: number;
  dLon: number;
  status: PharmacyStatus;
}

const PHARMACIES: PharmacySeed[] = [
  { name: 'Gulberg Care Pharmacy', licenseNo: 'PH-0001', address: 'Main Boulevard, Gulberg III, Lahore', dLat: -0.0035, dLon: -0.0103, status: PharmacyStatus.VERIFIED },
  { name: 'DHA Phase 5 Pharmacy', licenseNo: 'PH-0002', address: 'Sector H, DHA Phase 5, Lahore', dLat: -0.0507, dLon: 0.0527, status: PharmacyStatus.VERIFIED },
  { name: 'Model Town Family Pharmacy', licenseNo: 'PH-0003', address: 'Model Town Link Rd, Lahore', dLat: -0.0357, dLon: -0.0404, status: PharmacyStatus.VERIFIED },
  { name: 'Johar Town Medical Store', licenseNo: 'PH-0004', address: 'Khokhar Chowk, Johar Town, Lahore', dLat: -0.0507, dLon: -0.0859, status: PharmacyStatus.VERIFIED },
  { name: 'Faisal Town Pharmacy', licenseNo: 'PH-0005', address: 'Akbar Chowk, Faisal Town, Lahore', dLat: -0.0399, dLon: -0.0537, status: PharmacyStatus.VERIFIED },
  { name: 'Garden Town 24h Pharmacy', licenseNo: 'PH-0006', address: 'Barkat Market, Garden Town, Lahore', dLat: -0.0289, dLon: -0.0467, status: PharmacyStatus.VERIFIED },
  { name: 'Allama Iqbal Town Pharmacy', licenseNo: 'PH-0007', address: 'Karim Block, Allama Iqbal Town, Lahore', dLat: -0.0104, dLon: -0.0727, status: PharmacyStatus.VERIFIED },
  { name: 'Cantt Medicos', licenseNo: 'PH-0008', address: 'Saddar Bazaar, Lahore Cantt', dLat: 0.0046, dLon: 0.0173, status: PharmacyStatus.VERIFIED },
  { name: 'Shadman Community Pharmacy', licenseNo: 'PH-0009', address: 'Shadman Market, Lahore', dLat: 0.0212, dLon: -0.0327, status: PharmacyStatus.VERIFIED },
  { name: 'Township Neighborhood Pharmacy', licenseNo: 'PH-0010', address: 'Sector C1, Township, Lahore', dLat: -0.0584, dLon: -0.0477, status: PharmacyStatus.VERIFIED },
  { name: 'Bahria Town Central Pharmacy', licenseNo: 'PH-0011', address: 'Sector C, Bahria Town, Lahore', dLat: -0.1520, dLon: -0.1777, status: PharmacyStatus.VERIFIED },
  { name: 'Wapda Town Pharmacy', licenseNo: 'PH-0012', address: 'Wapda Town Roundabout, Lahore', dLat: -0.0904, dLon: -0.1087, status: PharmacyStatus.PENDING },
  { name: 'Samanabad New Pharmacy (pending review)', licenseNo: 'PH-0013', address: 'Samanabad More, Lahore', dLat: 0.0256, dLon: -0.0627, status: PharmacyStatus.PENDING },
  { name: 'Anarkali Old Bazaar Pharmacy (suspended)', licenseNo: 'PH-0014', address: 'Anarkali Bazaar, Mall Road, Lahore', dLat: 0.0476, dLon: -0.0467, status: PharmacyStatus.SUSPENDED },
];

const BASE_LAT = 31.5204;
const BASE_LON = 74.3587;

async function main(): Promise<void> {
  console.log('▶ Seeding MediStock…');
  const passwordHash = await bcrypt.hash('Password123!', 12);

  // ── Fixed accounts (upsert heals password + role on every run) ─────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@medistock.dev' },
    update: { passwordHash, fullName: 'Platform Admin', role: Role.ADMIN, pharmacyId: null },
    create: { email: 'admin@medistock.dev', passwordHash, fullName: 'Platform Admin', role: Role.ADMIN },
  });

  const patientEmails = [
    'patient@medistock.dev',
    'patient2@medistock.dev',
    'patient3@medistock.dev',
    'patient4@medistock.dev',
  ];
  const patients = [];
  for (let i = 0; i < patientEmails.length; i += 1) {
    const email = patientEmails[i] as string;
    patients.push(
      await prisma.user.upsert({
        where: { email },
        update: { passwordHash, role: Role.PATIENT, pharmacyId: null },
        create: { email, passwordHash, fullName: `Test Patient ${i + 1}`, role: Role.PATIENT },
      }),
    );
  }

  // ── Medicines ─────────────────────────────────────────────────────────
  const medicines = [];
  for (const [name, brand, genericFormula, strength, form, isCritical] of MEDICINES) {
    medicines.push(
      await prisma.medicine.upsert({
        where: { name_strength_form_brand: { name, strength, form, brand } },
        update: { genericFormula, isCritical },
        create: { name, brand, genericFormula, strength, form, isCritical },
      }),
    );
  }
  console.log(`  • ${medicines.length} medicines`);

  // ── Pharmacies + one pharmacist each ──────────────────────────────────
  const pharmacies = [];
  for (const seed of PHARMACIES) {
    const location = {
      name: seed.name,
      address: seed.address,
      phone: `+92-42-3${seed.licenseNo.replace('PH-', '')}-0000`,
      latitude: Number((BASE_LAT + seed.dLat).toFixed(6)),
      longitude: Number((BASE_LON + seed.dLon).toFixed(6)),
      status: seed.status,
    };
    const pharmacy = await prisma.pharmacy.upsert({
      where: { licenseNo: seed.licenseNo },
      // Relocate existing seed pharmacies on re-run, not just their status.
      update: location,
      create: { licenseNo: seed.licenseNo, ...location },
    });
    pharmacies.push(pharmacy);

    const email = `pharmacist.${seed.licenseNo.toLowerCase()}@medistock.dev`;
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: Role.PHARMACIST, pharmacyId: pharmacy.id },
      create: {
        email,
        passwordHash,
        fullName: `${pharmacy.name} Pharmacist`,
        role: Role.PHARMACIST,
        pharmacyId: pharmacy.id,
      },
    });
  }
  console.log(`  • ${pharmacies.length} pharmacies (+ pharmacists)`);

  // ── Reset demo transactional state (full rebuild) ────────────────────
  await prisma.reservation.deleteMany({});
  await prisma.inventorySyncBatch.deleteMany({});
  await prisma.inventory.deleteMany({});

  // ── Inventory: each pharmacy stocks a random slice of the catalogue ───
  let inventoryCount = 0;
  for (const pharmacy of pharmacies) {
    const slice = shuffle(medicines).slice(0, between(20, 40));
    for (const medicine of slice) {
      const totalStock = chance(0.12) ? 0 : between(3, 95);
      // PKR paisa (100 paisa = ₨1): roughly ₨25 – ₨3,600 per pack.
      const priceCents = between(2500, 360000);
      await prisma.inventory.create({
        data: {
          pharmacyId: pharmacy.id,
          medicineId: medicine.id,
          sku: `${pharmacy.licenseNo}-${slug(`${medicine.name} ${medicine.strength} ${medicine.form} ${medicine.brand}`)}`.slice(0, 78),
          totalStock,
          heldStock: 0,
          priceCents,
          currency: 'PKR',
        },
      });
      inventoryCount += 1;
    }
  }
  console.log(`  • ${inventoryCount} inventory lines`);

  // ── Reservations across every status (for filters / pagination) ───────
  const verifiedPharmacyIds = new Set(
    pharmacies.filter((p) => p.status === PharmacyStatus.VERIFIED).map((p) => p.id),
  );
  const candidates = await prisma.inventory.findMany({
    where: { pharmacyId: { in: [...verifiedPharmacyIds] }, totalStock: { gt: 0 } },
  });
  const pool = shuffle(candidates);
  let cursor = 0;
  const nextInv = () => pool[cursor++ % pool.length]!;

  const plan: Array<[ReservationStatus, number]> = [
    [ReservationStatus.PENDING, 9],
    [ReservationStatus.CLAIMED, 7],
    [ReservationStatus.EXPIRED, 6],
    [ReservationStatus.CANCELLED, 5],
  ];

  let reservationCount = 0;
  for (const [status, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      const inv = nextInv();
      const patient = patients[between(0, patients.length - 1)]!;
      const quantity = Math.max(1, Math.min(between(1, 3), inv.totalStock));
      const now = Date.now();

      let expiresAt: Date;
      let claimedAt: Date | null = null;
      let releasedAt: Date | null = null;

      if (status === ReservationStatus.PENDING) {
        expiresAt = new Date(now + between(3, 29) * 60_000);
        await prisma.inventory.update({
          where: { id: inv.id },
          data: { heldStock: { increment: quantity } },
        });
      } else if (status === ReservationStatus.CLAIMED) {
        claimedAt = new Date(now - between(1, 96) * 3_600_000);
        expiresAt = new Date(claimedAt.getTime() + 30 * 60_000);
        await prisma.inventory.update({
          where: { id: inv.id },
          data: { totalStock: { decrement: Math.min(quantity, inv.totalStock) } },
        });
      } else if (status === ReservationStatus.EXPIRED) {
        expiresAt = new Date(now - between(1, 72) * 3_600_000);
        releasedAt = expiresAt;
      } else {
        releasedAt = new Date(now - between(1, 72) * 3_600_000);
        expiresAt = new Date(releasedAt.getTime() - between(1, 20) * 60_000);
      }

      await prisma.reservation.create({
        data: {
          code: otp(),
          status,
          quantity,
          patientId: patient.id,
          pharmacyId: inv.pharmacyId,
          medicineId: inv.medicineId,
          inventoryId: inv.id,
          expiresAt,
          claimedAt,
          releasedAt,
          createdAt: new Date(now - between(1, 120) * 3_600_000),
        },
      });
      reservationCount += 1;
    }
  }
  console.log(`  • ${reservationCount} reservations (PENDING / CLAIMED / EXPIRED / CANCELLED)`);

  // ── Drop catalogue entries left with no stock and no history ─────────
  // (e.g. brands replaced between seed runs). Keeps the demo catalogue tidy
  // without touching anything a user actually references.
  const pruned = await prisma.medicine.deleteMany({
    where: { inventory: { none: {} }, reservations: { none: {} } },
  });
  if (pruned.count > 0) console.log(`  • pruned ${pruned.count} unused medicines`);

  // ── Prime Redis: GEO index + stock hashes from the DB truth ───────────
  const allInventory = await prisma.inventory.findMany({
    select: { id: true, totalStock: true, heldStock: true },
  });
  const staleKeys = await redis.keys('medistock:stock:*');
  const pipeline = redis.pipeline();
  if (staleKeys.length > 0) pipeline.del(...staleKeys);
  for (const inv of allInventory) {
    pipeline.hset(stockKey(inv.id), 'total', inv.totalStock, 'held', inv.heldStock);
  }
  pipeline.del(PHARMACY_GEO_KEY);
  for (const pharmacy of pharmacies) {
    if (pharmacy.status === PharmacyStatus.VERIFIED) {
      pipeline.geoadd(PHARMACY_GEO_KEY, pharmacy.longitude, pharmacy.latitude, pharmacy.id);
    }
  }
  await pipeline.exec();
  console.log(`  • Redis primed: ${allInventory.length} stock hashes, ${verifiedPharmacyIds.size} geo points`);

  console.log('\n✔ Seed complete');
  console.log('  Logins — password for ALL accounts: Password123!');
  console.log('   ADMIN      admin@medistock.dev');
  console.log('   PATIENT    patient@medistock.dev  (also patient2/3/4@medistock.dev)');
  console.log('   PHARMACIST pharmacist.ph-0001@medistock.dev … pharmacist.ph-0014@medistock.dev');
  console.log(`  (admin id ${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
