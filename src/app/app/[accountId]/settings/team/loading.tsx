import { ListRowsSkeleton } from '@/components/ui/skeletons';
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <ListRowsSkeleton label="Loading team" rows={5} />
    </div>
  );
}
