import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

export const errorPlugin = fp(async (app) => {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: { code: 'validation_error', message: 'Some fields are invalid.', details: err.validation.map((v: any) => ({ path: v.instancePath || v.params?.issue?.path?.join('.') || '', message: v.message })) } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'validation_error', message: 'Some fields are invalid.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response serialization failed');
      return reply.status(500).send({ error: { code: 'internal', message: 'The server produced an invalid response.' } });
    }
    if (err.statusCode === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
    if (err.statusCode === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: { code: 'payload_too_large', message: 'That file is too large.' } });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong on our side. Your data has not been lost; please try again.' } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} does not exist.` } }));
});
