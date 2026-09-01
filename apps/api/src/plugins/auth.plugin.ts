import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import type { AuthUser } from '../types/auth';

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: verifies the bearer token and populates `request.currentUser`. */
    authenticate: preHandlerHookHandler;
    /** preHandler factory: `authorize(Role.ADMIN, Role.PHARMACIST)`. */
    authorize: (...roles: Role[]) => preHandlerHookHandler;
  }
  interface FastifyRequest {
    currentUser: AuthUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export default fp(
  async (app) => {
    await app.register(fastifyJwt, {
      secret: env.JWT_SECRET,
      sign: { expiresIn: env.JWT_EXPIRES_IN },
    });

    const unauthorized = (reply: FastifyReply): FastifyReply =>
      reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    app.decorate('authenticate', async function authenticate(request: FastifyRequest, reply) {
      try {
        await request.jwtVerify();
        request.currentUser = request.user;
      } catch {
        return unauthorized(reply);
      }
    });

    app.decorate('authorize', function authorize(...roles: Role[]): preHandlerHookHandler {
      return async function authorizeHandler(request: FastifyRequest, reply) {
        if (!request.currentUser) {
          try {
            await request.jwtVerify();
            request.currentUser = request.user;
          } catch {
            return unauthorized(reply);
          }
        }

        if (roles.length > 0 && !roles.includes(request.currentUser.role)) {
          return reply
            .code(403)
            .send({ error: { code: 'FORBIDDEN', message: 'Insufficient role for this operation' } });
        }
      };
    });
  },
  { name: 'auth-plugin' },
);
