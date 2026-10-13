import {
  NATIVE_TRANSACTION_COOKIE,
  NATIVE_TRANSACTION_MAX_AGE,
  NATIVE_STATE_RE,
  signNativeTransaction,
  readNativeTransaction,
  nativeBridgePath,
  nativeReturnUrl,
  nativeLoginContinuation,
} from './native-transaction';
export const IOS_TRANSACTION_COOKIE = NATIVE_TRANSACTION_COOKIE;
export const IOS_TRANSACTION_MAX_AGE = NATIVE_TRANSACTION_MAX_AGE;
export const IOS_STATE_RE = NATIVE_STATE_RE;
export type IosTransaction = { challenge: string; state: string };
export const signIosTransaction = (transaction: IosTransaction) =>
  signNativeTransaction({ ...transaction, client: 'ios' });
export async function readIosTransaction(store: Parameters<typeof readNativeTransaction>[0]) {
  const transaction = await readNativeTransaction(store);
  return transaction?.client === 'ios'
    ? { challenge: transaction.challenge, state: transaction.state }
    : null;
}
export const iosBridgePath = (transaction: IosTransaction) =>
  nativeBridgePath({ ...transaction, client: 'ios' });
export const iosReturnUrl = (
  transaction: IosTransaction,
  result: Parameters<typeof nativeReturnUrl>[1],
) => nativeReturnUrl({ ...transaction, client: 'ios' }, result);
export async function iosLoginContinuation(
  store: Parameters<typeof nativeLoginContinuation>[0],
) {
  const transaction = await nativeLoginContinuation(store);
  return transaction?.client === 'ios'
    ? { challenge: transaction.challenge, state: transaction.state }
    : null;
}
