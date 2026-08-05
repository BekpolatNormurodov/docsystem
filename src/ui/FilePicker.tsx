'use client';

import React, { useRef, useState } from 'react';
import { Ico } from './icons';
import { ACCEPT_ATTR, attachmentError, isImageMime, MAX_PER_ARIZA } from '../attachments/rules';

const KB = 1024;
const fileSize = (b: number) =>
  b < KB ? `${b} B` : b < KB * KB ? `${Math.round(b / KB)} KB` : `${(b / KB / KB).toFixed(1)} MB`;

/**
 * Pick files to attach to a workflow step. Validates with the same pure rules the route uses,
 * so a 10 MB file that will be refused is refused here — before the upload, not after it.
 */
export function FilePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');

  function add(picked: FileList | null) {
    if (!picked?.length) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      const bad = attachmentError({ name: f.name, type: f.type, size: f.size });
      if (bad) {
        setErr(bad);
        continue;
      }
      if (next.length >= MAX_PER_ARIZA) {
        setErr(`Eng koʻpi ${MAX_PER_ARIZA} ta fayl`);
        break;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onChange(next);
    // Let the same file be picked again after it is removed.
    if (input.current) input.current.value = '';
  }

  const remove = (i: number) => {
    setErr('');
    onChange(files.filter((_, j) => j !== i));
  };

  return (
    <div>
      <span className="field-label">Fayllar</span>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => add(e.target.files)}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        className="btn-ghost w-full justify-center py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Ico.add size={16} /> Fayl biriktirish
      </button>
      <p className="mt-1.5 text-xs text-muted">Rasm, PDF, Word yoki Excel · har biri 10 MB gacha</p>

      {err && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-300">{err}</p>}

      {!!files.length && (
        <ul className="mt-3 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line p-2">
              {isImageMime(f.type) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={URL.createObjectURL(f)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-surface-2 text-[10px] font-bold uppercase text-muted">
                  {(f.name.split('.').pop() ?? '?').slice(0, 4)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{f.name}</span>
                <span className="block text-[11px] text-muted">{fileSize(f.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                className="shrink-0 cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
                aria-label={`${f.name} — olib tashlash`}
              >
                <Ico.close size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
