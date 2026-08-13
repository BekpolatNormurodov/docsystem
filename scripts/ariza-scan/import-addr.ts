import 'dotenv/config';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { scanAriza } from './scan';
const prisma = new PrismaClient();
async function main() {
  const files = process.argv.slice(2);
  for (const f of files) {
    const a = scanAriza(fs.readFileSync(f, 'utf8'));
    if (!a.pinfl || !a.address) { console.log(`skip ${f}: no pinfl/address`); continue; }
    const r = await prisma.loan.updateMany({ where: { pinfl: a.pinfl }, data: { postAddressUz: a.address } });
    console.log(`${a.pinfl} → "${a.address.slice(0,55)}…"  (${r.count} loan rows updated)`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
