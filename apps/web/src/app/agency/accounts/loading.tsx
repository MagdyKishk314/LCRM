import { ListRowsSkeleton } from '@/components/ui/skeletons';
export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas pt-6">
      <ListRowsSkeleton label="Loading sub-accounts" rows={4} />
    </div>
  );
}
