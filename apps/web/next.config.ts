import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share `.next` by default, so a verification build run
  // while a dev server is up overwrites its chunks and the running app starts 404ing its
  // own CSS. Set NEXT_DIST_DIR to build somewhere else instead.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // The shared package ships TypeScript source rather than a build step, so Next
  // has to compile it alongside the app.
  /**
   * Both workspace packages ship TypeScript source rather than a build step, so Next
   * compiles them alongside the app. `@landcaller/api` is here because the API is served
   * by this deployment — see src/app/api/v1/[...path]/route.ts.
   */
  transpilePackages: ['@landcaller/shared', '@landcaller/api'],
  /** Mongoose and the Google client are Node libraries; do not try to bundle them. */
  serverExternalPackages: ['mongoose', 'bcryptjs', 'google-auth-library', 'nodemailer'],
  experimental: {
    /**
     * A CSV import posts the file's text through a server action, and the default limit
     * here is 1 MB — which is what users actually hit, well before the app's own 50 MB
     * check could explain it.
     *
     * Keep in step with REQUEST_BODY_LIMIT in @landcaller/shared. This file cannot import
     * it (next.config is loaded before workspace packages are transpiled), so
     * packages/shared/src/limits.test.ts asserts the two agree.
     */
    /**
     * Only reachable when self-hosting. Vercel caps request bodies well below this at the
     * platform edge, which is why the CSV import parses in the browser and uploads in
     * chunks instead of posting the whole file — see IMP-09 in THE-PLAN.md.
     */
    serverActions: { bodySizeLimit: '72mb' },
  },
  /**
   * `standalone` produces the self-contained server the Dockerfile and the VPS use.
   *
   * Vercel builds its own output and does not want it, so it is opted into rather than
   * always on — `VERCEL` is set for us in that environment.
   */
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
