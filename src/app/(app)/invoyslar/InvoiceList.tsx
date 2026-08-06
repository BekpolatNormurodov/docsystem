'use client';

import { DocumentDownload } from 'iconsax-react';

export interface InvoiceRow {
  id: number; invoiceNo: string; firmName: string; paymentType: string;
  amount: string; createdLabel: string; hasPdf: boolean;
}

export function InvoiceList({ rows }: { rows: InvoiceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card mt-6 overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">Yaratilgan invoyslar ({rows.length})</div>
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">№</th>
            <th className="px-4 py-2 font-medium">Firma</th>
            <th className="px-4 py-2 font-medium">Toʻlov turi</th>
            <th className="px-4 py-2 text-right font-medium">Summa</th>
            <th className="px-4 py-2 font-medium">Sana</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-4 py-2 font-mono text-xs">{r.invoiceNo}</td>
              <td className="px-4 py-2">{r.firmName}</td>
              <td className="px-4 py-2 text-muted">{r.paymentType}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.amount}</td>
              <td className="px-4 py-2 text-xs text-muted">{r.createdLabel}</td>
              <td className="px-4 py-2 text-right">
                {r.hasPdf ? (
                  <a href={`/api/invoices/${r.id}/download`} className="btn-primary px-3 py-1.5 text-xs">
                    <DocumentDownload size={14} /> PDF
                  </a>
                ) : <span className="text-xs text-muted">PDF yoʻq</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
