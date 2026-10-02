import { ServerResponse, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type { Application } from 'express';

/**
 * Run an Express app from inside a Next route handler.
 *
 * Next speaks the Web `Request`/`Response` API; Express speaks Node's `IncomingMessage`/
 * `ServerResponse`. This translates between them so the API can be served by the same
 * deployment as the web app — one Vercel project, one origin, no CORS between them.
 *
 * The Express app is untouched: it is still `createApp()`, still mounted at `/api/v1`, and
 * still the thing `src/index.ts` serves on a VPS. Only the transport differs.
 */

/** Node's IncomingMessage is a Readable with request metadata bolted on. */
function toNodeRequest(request: Request, body: Buffer): IncomingMessage {
  const url = new URL(request.url);
  const stream = Readable.from(body.length > 0 ? [body] : []) as unknown as IncomingMessage;

  stream.method = request.method;
  // Express routes on the path as the client sent it, including the /api/v1 mount point.
  stream.url = url.pathname + url.search;
  stream.httpVersion = '1.1';
  stream.httpVersionMajor = 1;
  stream.httpVersionMinor = 1;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  stream.headers = headers;

  /**
   * Express reads `req.ip` from the socket, and the audit trail records it.
   *
   * There is no real socket here, and behind a platform proxy the client's address arrives
   * in `x-forwarded-for` anyway — so the first entry in that chain is presented as the peer
   * address. Without a socket at all, `req.ip` throws before any handler runs.
   */
  Object.defineProperty(stream, 'socket', {
    value: { remoteAddress: headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '127.0.0.1' },
    writable: true,
  });

  return stream;
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.alloc(0);
}

/**
 * Hand one request to Express and wait for the response it writes.
 *
 * A real `ServerResponse` is used rather than a hand-rolled stand-in, so everything Express
 * expects — `writeHead`, `getHeaders`, `headersSent`, the cookie helpers — behaves exactly
 * as it does in production. Only `write` and `end` are intercepted, to collect the body
 * instead of pushing it at a socket that does not exist here.
 */
export function handleWithExpress(app: Application, request: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    request
      .arrayBuffer()
      .then((raw) => {
        const req = toNodeRequest(request, Buffer.from(raw));
        const res = new ServerResponse(req);
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;

          const headers = new Headers();
          for (const [key, value] of Object.entries(res.getHeaders())) {
            if (value === undefined) continue;
            // Set-Cookie is the one header that legitimately repeats, and collapsing it
            // into a single comma-joined value would break every cookie after the first.
            if (Array.isArray(value)) for (const v of value) headers.append(key, String(v));
            else headers.set(key, String(value));
          }

          const body = Buffer.concat(chunks);
          const bodyless = res.statusCode === 204 || res.statusCode === 304;

          resolve(
            new Response(bodyless || body.length === 0 ? null : new Uint8Array(body), {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers,
            }),
          );
        };

        res.write = function write(chunk: unknown, ...rest: unknown[]) {
          chunks.push(asBuffer(chunk));
          const done = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
          done?.();
          return true;
        } as typeof res.write;

        res.end = function end(chunk: unknown, ...rest: unknown[]) {
          if (chunk && typeof chunk !== 'function') chunks.push(asBuffer(chunk));
          const done = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
          done?.();
          finish();
          return res;
        } as typeof res.end;

        // A handler that throws after headers are sent, or a stream that errors, must not
        // leave the promise pending — that would hang the request until the platform kills it.
        res.on('error', reject);
        req.on('error', reject);

        app(req, res);
      })
      .catch(reject);
  });
}
