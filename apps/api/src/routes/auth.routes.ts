import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { hashPassword, verifyPassword } from '../lib/password';
import { publicUser } from '../lib/serializers';
import { ConflictError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { loginSchema, registerSchema } from '../validators/auth.schema';
import type { AuthUser } from '../types/auth';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const signToken = (user: {
    id: string;
    email: string;
    role: Role;
    pharmacyId: string | null;
  }): string => {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      pharmacyId: user.pharmacyId,
    };
    return app.jwt.sign(payload);
  };

  // Public self-service registration — PATIENT only.
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ConflictError('Email is already registered');
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName,
        phone: body.phone ?? null,
        role: Role.PATIENT,
      },
    });

    const token = await signToken(user);
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = await signToken(user);
    return reply.send({ token, user: publicUser(user) });
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.currentUser.sub } });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return { user: publicUser(user) };
  });
}
