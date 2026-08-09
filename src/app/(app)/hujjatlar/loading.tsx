import { SkeletonHeader, SkeletonCards } from '@/ui/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonCards count={3} />
    </div>
  );
}
