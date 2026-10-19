import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share `.next` by default, so a verification build run
  // while a dev server is up overwrites its chunks and the running app starts 404ing its
  // own CSS. Set NEXT_DIST_DIR to build somewhere else instead.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  /** Mongoose and the Google client are Node libraries; do not try to bundle them. */
  serverExternalPackages: ['mongoose', 'bcryptjs', 'google-auth-library', 'nodemailer'],
  experimental: {
    /**
     * Only reachable when self-hosting. Vercel caps request bodies well below this at the
     * platform edge, which is why the CSV import parses in the browser and uploads in
     * chunks instead of posting the whole file — see IMP-09 in THE-PLAN.md.
     *
     * Keep in step with REQUEST_BODY_LIMIT in src/shared/limits.ts. This file cannot
     * import it (Next loads its config before compiling the app), so
     * src/shared/limits.test.ts asserts the two agree.
     */
    serverActions: { bodySizeLimit: '72mb' },
    /**
     * Keep a visited page in the browser for half a minute.
     *
     * Every page here is dynamic, and by default Next refetches a dynamic page on each
     * visit — going back to a list you left five seconds ago waited on the server again.
     * With this, returning within the window is instant. Server actions that change data
     * call `revalidatePath`, which clears this cache, so an edit is never hidden by it.
     */
    staleTimes: { dynamic: 30, static: 180 },
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
