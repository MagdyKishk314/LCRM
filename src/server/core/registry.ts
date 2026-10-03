import type { Router } from 'express';
import { getModule, type ModuleKey } from '@/shared';
import { authenticate, requireModule, resolveTenant } from './auth/middleware';

export interface ApiModule {
  key: ModuleKey;
  router: Router;
  /**
   * Skips the whole prefix chain, leaving the module to guard its own routes.
   *
   * Only `core` uses this: it serves the login and refresh endpoints, which by
   * definition cannot sit behind authentication.
   */
  selfGuarded?: boolean;
}

/**
 * Mount every registered module under `/api/v1/<key>` behind the full guard chain.
 *
 * The chain is assembled here, once, rather than inside each module — so a new module
 * cannot ship without it, and the stages cannot end up in the wrong order.
 *
 * Order is load-bearing:
 *   authenticate    — establishes who is calling
 *   resolveTenant   — proves membership, resolves modules + permissions into context
 *   requireModule   — rejects a module this sub-account has switched off
 *
 * `requireModule` reads the effective module set that `resolveTenant` computes, so it
 * must come after it. Running the gate first sees an empty context and fails every
 * request with a misleading 401.
 */
export function mountModules(app: Router, modules: ApiModule[]): void {
  for (const mod of modules) {
    const manifest = getModule(mod.key);
    if (!manifest) {
      throw new Error(
        `Module "${mod.key}" has no manifest in the shared catalog. ` +
          'Add it to src/shared/modules/catalog.ts first.',
      );
    }

    if (mod.selfGuarded) {
      app.use(`/${mod.key}`, mod.router);
    } else {
      app.use(`/${mod.key}`, authenticate, resolveTenant, requireModule(mod.key), mod.router);
    }

    console.log(`[modules] mounted ${mod.key} at /api/v1/${mod.key}`);
  }
}
