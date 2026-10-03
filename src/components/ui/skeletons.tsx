'use client';

import Skeleton from 'react-loading-skeleton';

/**
 * Skeleton screens for route transitions.
 *
 * Each one mirrors the layout it stands in for — same column count, same card grid, same
 * board columns — so the real content lands in place rather than shoving the page around
 * when it arrives. A generic spinner would be less work and noticeably worse: the point
 * of a skeleton is that the eye has already found the row it is waiting for.
 *
 * Colours come from `--base-color` / `--highlight-color`, set from the design tokens in
 * globals.css, so these follow light and dark without any per-component theming.
 */

/** Marks the whole subtree as busy for assistive tech, which sees no visual shimmer. */
function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
      <div className="min-w-0 flex-1">
        <Skeleton height={26} width={220} />
        <div className="mt-1.5">
          <Skeleton height={14} width={320} />
        </div>
      </div>
      {withAction && <Skeleton height={32} width={120} borderRadius={8} />}
    </div>
  );
}

export function TableSkeleton({ rows = 10, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="border-b border-border bg-surface-2 px-3 py-2.5">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="flex-1">
              <Skeleton height={10} width={i === 0 ? '55%' : '70%'} />
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="flex-1">
              {/* First column carries a name over an email, so it gets two lines. */}
              {c === 0 ? (
                <>
                  <Skeleton height={13} width="75%" />
                  <Skeleton height={10} width="55%" />
                </>
              ) : (
                <Skeleton height={13} width={c === columns - 1 ? '45%' : '65%'} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ContactsSkeleton() {
  return (
    <Busy label="Loading contacts">
      <PageHeaderSkeleton />
      <div className="px-6">
        {/* Filter bar: search field plus four selects and the action buttons. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="min-w-[240px] flex-1">
            <Skeleton height={36} borderRadius={8} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={36} width={130} borderRadius={8} />
          ))}
          <div className="ml-auto flex gap-2">
            <Skeleton height={32} width={92} borderRadius={8} />
            <Skeleton height={32} width={92} borderRadius={8} />
            <Skeleton height={32} width={118} borderRadius={8} />
          </div>
        </div>
        <div className="mb-3">
          <Skeleton height={13} width={140} />
        </div>
        <TableSkeleton rows={10} columns={7} />
      </div>
    </Busy>
  );
}

export function DashboardSkeleton() {
  return (
    <Busy label="Loading dashboard">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface p-4">
            <Skeleton height={13} width="55%" />
            <div className="mt-2">
              <Skeleton height={28} width="70%" />
            </div>
            <Skeleton height={11} width="45%" />
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 px-6 lg:grid-cols-3">
        <div className="rounded-card border border-border bg-surface lg:col-span-2">
          <div className="border-b border-border px-5 py-3.5">
            <Skeleton height={14} width={150} />
          </div>
          <div className="space-y-3 px-5 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="mb-1 flex justify-between">
                  <Skeleton height={13} width={110} />
                  <Skeleton height={13} width={90} />
                </div>
                <Skeleton height={6} borderRadius={999} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-5 py-3.5">
            <Skeleton height={14} width={120} />
          </div>
          <div className="space-y-4 px-5 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <Skeleton height={13} width="85%" />
                <Skeleton height={10} width="45%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Busy>
  );
}

export function ContactDetailSkeleton() {
  return (
    <Busy label="Loading contact">
      <div className="border-b border-border bg-surface px-6 pb-5 pt-5">
        <Skeleton height={13} width={100} />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton circle height={44} width={44} />
          <div className="flex-1">
            <Skeleton height={24} width={240} />
            <Skeleton height={16} width={160} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-6 pt-5 lg:grid-cols-3">
        <div className="space-y-4">
          {[5, 4].map((fields, card) => (
            <div key={card} className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-5 py-3.5">
                <Skeleton height={14} width={130} />
              </div>
              <div className="space-y-3 px-5 py-4">
                {Array.from({ length: fields }).map((_, i) => (
                  <div key={i}>
                    <Skeleton height={10} width="40%" />
                    <Skeleton height={13} width="70%" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-card border border-border bg-surface">
            <div className="border-b border-border px-5 py-3.5">
              <Skeleton height={14} width={90} />
            </div>
            <div className="px-5 py-4">
              <Skeleton height={104} borderRadius={8} />
              <div className="mt-5 space-y-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton circle height={26} width={26} />
                    <div className="flex-1">
                      <Skeleton height={13} width="55%" />
                      <Skeleton height={12} width="90%" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Busy>
  );
}

export function BoardSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <Busy label="Loading pipeline">
      <PageHeaderSkeleton withAction />
      <div className="flex gap-3 overflow-hidden px-6 pb-6">
        {Array.from({ length: columns }).map((_, col) => (
          <div
            key={col}
            className="flex w-72 shrink-0 flex-col rounded-card border border-border bg-surface-2"
          >
            <div className="border-b border-border px-3 py-2.5">
              <Skeleton height={13} width="60%" />
              <Skeleton height={11} width="80%" />
            </div>
            <div className="space-y-2 p-2">
              {/* Uneven card counts, because a board is never uniform. */}
              {Array.from({ length: 3 - (col % 2) }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface p-2.5">
                  <Skeleton height={13} width="85%" />
                  <Skeleton height={11} width="55%" />
                  <div className="mt-2">
                    <Skeleton height={13} width="40%" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function CardGridSkeleton({
  label,
  cards = 6,
  columns = 3,
}: {
  label: string;
  cards?: number;
  columns?: 2 | 3;
}) {
  return (
    <Busy label={label}>
      <PageHeaderSkeleton withAction />
      <div
        className={`grid grid-cols-1 gap-4 px-6 md:grid-cols-2 ${
          columns === 3 ? 'xl:grid-cols-3' : ''
        }`}
      >
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <Skeleton height={14} width={150} />
              <Skeleton height={16} width={56} borderRadius={4} />
            </div>
            <Skeleton height={13} width="90%" />
            <div className="mt-3">
              <Skeleton height={12} width="45%" />
            </div>
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function ListRowsSkeleton({ label, rows = 12 }: { label: string; rows?: number }) {
  return (
    <Busy label={label}>
      <PageHeaderSkeleton withAction />
      <div className="px-6">
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
            >
              <div className="w-44 shrink-0">
                <Skeleton height={13} width="80%" />
                <Skeleton height={10} width="50%" />
              </div>
              <div className="min-w-0 flex-1">
                <Skeleton height={13} width="70%" />
                <Skeleton height={12} width="45%" />
              </div>
              <Skeleton height={16} width={64} borderRadius={4} />
              <Skeleton height={11} width={48} />
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

export function SettingsSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Busy label="Loading settings">
      <div className="mx-auto max-w-3xl">
        <PageHeaderSkeleton />
        <div className="px-6">
          <div className="rounded-card border border-border bg-surface">
            <div className="border-b border-border px-5 py-3.5">
              <Skeleton height={14} width={120} />
            </div>
            <div className="space-y-4 px-5 py-4">
              {Array.from({ length: fields }).map((_, i) => (
                <div key={i}>
                  <Skeleton height={12} width={90} />
                  <Skeleton height={36} borderRadius={8} />
                </div>
              ))}
              <div className="flex justify-end">
                <Skeleton height={36} width={130} borderRadius={8} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Busy>
  );
}

/**
 * Rows of icon + text + trailing control — used by both the module toggles and the
 * custom-fields list, hence the caller-supplied label: screen-reader users must hear
 * what is loading, not what the layout happens to resemble.
 */
export function ModuleListSkeleton({
  rows = 9,
  label = 'Loading modules',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <div className="mx-auto max-w-3xl">
        <PageHeaderSkeleton />
        <div className="px-6">
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-3.5 border-b border-border px-4 py-3.5 last:border-0"
              >
                <Skeleton height={32} width={32} borderRadius={8} />
                <div className="min-w-0 flex-1">
                  <Skeleton height={13} width={140} />
                  <Skeleton height={13} width="85%" />
                </div>
                <Skeleton height={20} width={36} borderRadius={999} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Busy>
  );
}
