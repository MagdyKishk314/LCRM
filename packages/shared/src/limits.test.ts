import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_QUOTA_BYTES,
  REQUEST_BODY_LIMIT,
  REQUEST_BODY_LIMIT_BYTES,
  formatBytes,
} from './limits';

const REPO = join(import.meta.dirname, '..', '..', '..');

/**
 * `next.config.ts` cannot import from this package — Next loads its config before workspace
 * packages are transpiled — so the one place the limit has to be duplicated is checked here
 * instead. Without this, raising the limit in `limits.ts` silently leaves Next rejecting at
 * the old value, which is exactly the failure that produced "Body exceeded 1 MB limit".
 */
test('next.config agrees with the shared body limit', () => {
  const config = readFileSync(join(REPO, 'apps/web/next.config.ts'), 'utf8');
  const match = config.match(/bodySizeLimit:\s*'([^']+)'/);

  assert.ok(match, 'next.config.ts does not set serverActions.bodySizeLimit');
  assert.equal(
    match[1],
    REQUEST_BODY_LIMIT,
    `next.config.ts allows ${match[1]} but REQUEST_BODY_LIMIT is ${REQUEST_BODY_LIMIT}`,
  );
});

test('the API body limit comes from the shared constant', () => {
  const app = readFileSync(join(REPO, 'apps/api/src/app.ts'), 'utf8');
  assert.match(
    app,
    /express\.json\(\{\s*limit:\s*REQUEST_BODY_LIMIT\s*\}\)/,
    'apps/api/src/app.ts should pass REQUEST_BODY_LIMIT to express.json',
  );
});

test('the transport allows more than the largest file', () => {
  // A CSV travels as a JSON string; escaping and RSC encoding inflate it past its own size,
  // so a transport sized to exactly the file limit rejects legitimate files at the framework
  // with an error the app cannot explain.
  assert.ok(
    REQUEST_BODY_LIMIT_BYTES > IMPORT_MAX_FILE_BYTES,
    'REQUEST_BODY_LIMIT_BYTES must exceed IMPORT_MAX_FILE_BYTES',
  );
  assert.equal(REQUEST_BODY_LIMIT, `${REQUEST_BODY_LIMIT_BYTES / 1024 / 1024}mb`);
});

test('the hourly quota admits at least one maximum-size file', () => {
  // A quota below the file limit would mean the advertised file size can never be imported.
  assert.ok(
    IMPORT_QUOTA_BYTES >= IMPORT_MAX_FILE_BYTES,
    'the hourly quota must allow at least one file at the maximum size',
  );
});

test('formatBytes reads the way a person would say it', () => {
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
  assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatBytes(0), '0 MB');
});
