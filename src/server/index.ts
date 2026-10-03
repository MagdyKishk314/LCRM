import { IMPORT_REQUEST_TIMEOUT_MS } from '@/shared';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './core/db';

async function main() {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    console.log(`[api] listening on :${env.API_PORT} (${env.NODE_ENV})`);
  });

  /**
   * A large CSV import legitimately holds a request open for minutes.
   *
   * Node's default `requestTimeout` is 5 minutes and would sever it mid-write, leaving the
   * user no result and the file partly applied. `headersTimeout` has to stay above it, or
   * Node ends the connection while the body is still arriving.
   */
  server.requestTimeout = IMPORT_REQUEST_TIMEOUT_MS;
  server.headersTimeout = IMPORT_REQUEST_TIMEOUT_MS + 60_000;

  // Finish in-flight requests before the process exits, so a deploy does not drop
  // a contact save mid-write.
  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
