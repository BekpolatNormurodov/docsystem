import { SkeletonHeader, SkeletonTable } from '@/ui/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-surface-2" />
        ))}
      </div>
      <SkeletonTable rows={10} cols={4} />
    </div>
  );
}
