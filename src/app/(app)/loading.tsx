import { SkeletonHeader, SkeletonTable } from '@/ui/Skeleton';

// Generic fallback for any (app) route without its own loading.tsx — shows an instant shimmer during
// navigation instead of a blank screen while the server component fetches.
export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonTable rows={8} cols={4} />
    </div>
  );
}
