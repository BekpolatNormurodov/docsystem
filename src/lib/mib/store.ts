// Disk layout for uploaded HISOBOT files (the DB row keeps the path).
import path from 'node:path';

export const MIB_ROOT = path.join(process.cwd(), 'storage', 'mib-reports');
export const mibReportDir = (id: number) => path.join(MIB_ROOT, String(id));
export const mibSourceXlsxPath = (id: number) => path.join(mibReportDir(id), 'source.xlsx');
