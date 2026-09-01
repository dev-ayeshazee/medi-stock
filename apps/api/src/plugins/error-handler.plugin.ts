import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Central error funnel. Maps validation, domain and Prisma errors to stable
 * HTTP responses; anything unrecognised becomes an opaque 500 (details logged,
 * never leaked).
 */
export default fp(
  async (app) => {
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.issues,
          },
        });
      }

      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message, details: error.details },
        });
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({
            error: {
              code: 'CONFLICT',
              message: 'Unique constraint violation',
              details: error.meta,
            },
          });
        }
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
        }
        return reply
          .code(400)
          .send({ error: { code: 'DB_ERROR', message: error.message } });
      }

      // Fastify's own schema validation errors.
      if ((error as { validation?: unknown }).validation) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            details: (error as { validation?: unknown }).validation,
          },
        });
      }

      const statusCode = error.statusCode ?? 500;
      if (statusCode < 500) {
        return reply.code(statusCode).send({
          error: { code: error.code ?? 'ERROR', message: error.message },
        });
      }

      request.log.error({ err: error }, 'unhandled error');
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    });

    app.setNotFoundHandler((request, reply) => {
      reply.code(404).send({
        error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
      });
    });
  },
  { name: 'error-handler-plugin' },
);
