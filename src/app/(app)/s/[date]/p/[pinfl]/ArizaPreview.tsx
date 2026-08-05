'use client';

import { useState } from 'react';
import { CourtArizaDocument } from '@/ui';
import type { LoanArizaProps } from '@/core/ariza';

/**
 * Toggles a single loan's ariza preview. Props are computed server-side by `loanToAriza` (the
 * exact mapping the .docx export in Plan 4 will reuse) and handed down already serialized —
 * Dates and plain strings only, no QR.
 */
export function ArizaPreview({ props }: { props: LoanArizaProps }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn-ghost text-xs">
        {open ? 'Arizani yashirish' : 'Arizani koʻrish'}
      </button>
      {open && (
        <div className="cert-frame mt-3">
          <CourtArizaDocument {...props} />
        </div>
      )}
    </div>
  );
}
