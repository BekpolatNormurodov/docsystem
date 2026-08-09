import { Skeleton } from '@/ui';

// Mirrors the real page: a header row (title + snapshot/sync/connection controls),
// then Explorer's space-y-4 stack — one tall rail card + one Mijozlar list card.
// Matching the shape means no layout reflow when the data arrives.
export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-44 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-[340px] w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    </div>
  );
}
