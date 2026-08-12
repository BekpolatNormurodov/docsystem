import { requireAdmin } from '@/lib/auth';
import { ConnectionStatus } from '../konveyer/ConnectionStatus';

export const dynamic = 'force-dynamic';

// E-IMZO connections (xat.hippo + adolat/cabinet.sud.uz), moved out of the konveyer header into a
// dedicated bottom-sidebar page. Renders the connections grid inline (no pill/modal wrapper).
export default async function UlanishlarPage() {
  await requireAdmin();
  return <ConnectionStatus inline />;
}
