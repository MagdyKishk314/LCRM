import { TableSkeleton, PageHeaderSkeleton } from '@/components/ui/skeletons';
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading roles">
      <span className="sr-only">Loading roles</span>
      <PageHeaderSkeleton />
      <div className="px-6">
        <TableSkeleton rows={10} columns={4} />
      </div>
    </div>
  );
}
