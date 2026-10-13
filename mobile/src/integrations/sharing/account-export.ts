import type { AccountConnection } from '../../features/account/session';
export async function shareAccountExport(_connection: AccountConnection) {
  throw new Error('Data export is available in the installed app.');
}
