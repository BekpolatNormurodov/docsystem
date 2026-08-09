import { SkeletonHeader, SkeletonTable } from '@/ui/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="mb-4 h-10 w-full animate-pulse rounded-xl bg-surface-2" />
      <SkeletonTable rows={10} cols={4} />
    </div>
  );
}
