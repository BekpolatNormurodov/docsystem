import { prisma } from '../src/lib/db';

async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM arizacase');
  console.log('arizacase columns:');
  cols.forEach((c) => console.log('  ' + c.Field + '  ' + c.Type));
  const cnt: any[] = await prisma.$queryRawUnsafe('SELECT COUNT(*) c FROM arizacase');
  console.log('\narizacase rows:', Number(cnt[0].c));
  const sample: any[] = await prisma.$queryRawUnsafe('SELECT * FROM arizacase LIMIT 2');
  console.log('sample:', JSON.stringify(sample, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)).slice(0, 700));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
