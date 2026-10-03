import { CardGridSkeleton } from '@/components/ui/skeletons';
export default function Loading() {
  return <CardGridSkeleton label="Loading templates" cards={4} columns={2} />;
}
