import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import {
  cancelReservation,
  claimReservation,
  getReservationForUser,
  holdReservation,
  listReservationsForUser,
} from '../services/reservation.service';
import {
  cancelReservationSchema,
  claimReservationSchema,
  holdReservationSchema,
  listReservationsQuerySchema,
  reservationIdParamSchema,
} from '../validators/reservation.schema';

export default async function reservationRoutes(app: FastifyInstance): Promise<void> {
  /** Patient places a 30-minute atomic hold. */
  app.post(
    '/hold',
    { preHandler: [app.authenticate, app.authorize(Role.PATIENT)] },
    async (request, reply) => {
      const body = holdReservationSchema.parse(request.body);
      const reservation = await holdReservation({
        patientId: request.currentUser.sub,
        inventoryId: body.inventoryId,
        quantity: body.quantity,
      });
      return reply.code(201).send({ reservation });
    },
  );

  /** Pharmacist fulfils a hold with the patient's OTP. */
  app.post(
    '/claim',
    { preHandler: [app.authenticate, app.authorize(Role.PHARMACIST, Role.ADMIN)] },
    async (request) => {
      const body = claimReservationSchema.parse(request.body);
      const reservation = await claimReservation({
        actor: request.currentUser,
        reservationId: body.reservationId,
        otpCode: body.otpCode,
      });
      return { reservation };
    },
  );

  /** Patient releases their own hold early. */
  app.post(
    '/cancel',
    { preHandler: [app.authenticate, app.authorize(Role.PATIENT)] },
    async (request) => {
      const body = cancelReservationSchema.parse(request.body);
      const outcome = await cancelReservation(body.reservationId, request.currentUser.sub);
      return { outcome };
    },
  );

  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const query = listReservationsQuerySchema.parse(request.query);
    const reservations = await listReservationsForUser(request.currentUser, {
      status: query.status,
      limit: query.limit,
    });
    return { count: reservations.length, reservations };
  });

  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = reservationIdParamSchema.parse(request.params);
    const reservation = await getReservationForUser(id, request.currentUser);
    return { reservation };
  });
}
