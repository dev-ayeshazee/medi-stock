import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { publicMedicine } from '../lib/serializers';
import { searchAvailableStock } from '../services/geo.service';
import {
  createMedicineSchema,
  listMedicinesQuerySchema,
  searchQuerySchema,
} from '../validators/medicine.schema';

export default async function medicineRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Geospatial proximity stock search.
   * `GET /api/v1/medicines/search?lat=&lon=&radiusKm=&medicineId=|genericFormula=`
   */
  app.get('/search', { preHandler: [app.authenticate] }, async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const results = await searchAvailableStock(query);
    return {
      query: {
        lat: query.lat,
        lon: query.lon,
        radiusKm: query.radiusKm,
        medicineId: query.medicineId ?? null,
        genericFormula: query.genericFormula ?? null,
      },
      count: results.length,
      results,
    };
  });

  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const { q, critical, limit } = listMedicinesQuerySchema.parse(request.query);

    const where: Prisma.MedicineWhereInput = {};
    if (critical !== undefined) {
      where.isCritical = critical;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { genericFormula: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }

    const medicines = await prisma.medicine.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit,
    });

    return { count: medicines.length, medicines: medicines.map(publicMedicine) };
  });

  // Catalogue management — ADMIN only.
  app.post(
    '/',
    { preHandler: [app.authenticate, app.authorize(Role.ADMIN)] },
    async (request, reply) => {
      const body = createMedicineSchema.parse(request.body);

      const medicine = await prisma.medicine.create({
        data: {
          name: body.name,
          brand: body.brand ?? '',
          genericFormula: body.genericFormula,
          strength: body.strength,
          form: body.form,
          isCritical: body.isCritical,
        },
      });

      return reply.code(201).send({ medicine: publicMedicine(medicine) });
    },
  );
}
