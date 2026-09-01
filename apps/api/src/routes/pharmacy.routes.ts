import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { hashPassword } from '../lib/password';
import { publicPharmacy, publicUser } from '../lib/serializers';
import { ConflictError, NotFoundError } from '../lib/errors';
import {
  indexPharmacyLocation,
  rebuildPharmacyGeoIndex,
  removePharmacyLocation,
} from '../services/geo.service';
import {
  createPharmacistSchema,
  createPharmacySchema,
  pharmacyIdParamSchema,
  updatePharmacyStatusSchema,
} from '../validators/pharmacy.schema';

/**
 * Pharmacy + pharmacist administration. Every route is ADMIN-only.
 * Verifying a pharmacy (status -> VERIFIED) adds it to the Redis GEO index;
 * suspending it removes it.
 */
export default async function pharmacyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.authorize(Role.ADMIN));

  app.post('/', async (request, reply) => {
    const body = createPharmacySchema.parse(request.body);

    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: body.name,
        licenseNo: body.licenseNo,
        address: body.address,
        phone: body.phone,
        latitude: body.latitude,
        longitude: body.longitude,
        status: body.status ?? 'PENDING',
      },
    });

    if (pharmacy.status === 'VERIFIED') {
      await indexPharmacyLocation(pharmacy);
    }

    return reply.code(201).send({ pharmacy: publicPharmacy(pharmacy) });
  });

  app.get('/', async (request) => {
    const pharmacies = await prisma.pharmacy.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return { count: pharmacies.length, pharmacies: pharmacies.map(publicPharmacy) };
  });

  app.patch('/:id/status', async (request) => {
    const { id } = pharmacyIdParamSchema.parse(request.params);
    const { status } = updatePharmacyStatusSchema.parse(request.body);

    const pharmacy = await prisma.pharmacy.update({ where: { id }, data: { status } });

    if (status === 'VERIFIED') {
      await indexPharmacyLocation(pharmacy);
    } else {
      await removePharmacyLocation(pharmacy.id);
    }

    return { pharmacy: publicPharmacy(pharmacy) };
  });

  app.post('/:id/staff', async (request, reply) => {
    const { id } = pharmacyIdParamSchema.parse(request.params);
    const body = createPharmacistSchema.parse(request.body);

    const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
    if (!pharmacy) {
      throw new NotFoundError('Pharmacy not found');
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ConflictError('Email is already registered');
    }

    const staff = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName,
        phone: body.phone ?? null,
        role: Role.PHARMACIST,
        pharmacyId: id,
      },
    });

    return reply.code(201).send({ user: publicUser(staff) });
  });

  /** Operational: full rebuild of the Redis GEO index from Postgres. */
  app.post('/geo/rebuild', async () => {
    const indexed = await rebuildPharmacyGeoIndex();
    return { indexed };
  });
}
