import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Application } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { REQUEST_BODY_LIMIT } from '@/shared';
import { env } from './config/env';
import { errorHandler } from './core/errors';
import { mountModules } from './core/registry';
import { contactsModule } from './modules/contacts';
import { coreModule } from './modules/core';
import { emailModule } from './modules/email';
import { pipelinesModule } from './modules/pipelines';

/**
 * Every module the API can serve.
 *
 * Adding a module here plus a manifest in the shared catalog is the whole wiring —
 * the registry handles mounting and the enable/disable gate.
 */
const MODULES = [coreModule, contactsModule, pipelinesModule, emailModule];

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1); // Behind nginx on the VPS — needed for correct req.ip.
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Account-Id'],
    }),
  );
  // Sized for CSV imports of skip-traced owner lists, which routinely run to several
  // megabytes. Matches `client_max_body_size` in the nginx config.
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(cookieParser());
  if (env.NODE_ENV === 'development') app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  const v1 = Router();
  mountModules(v1, MODULES);
  app.use('/api/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  app.use(errorHandler);

  return app;
}
