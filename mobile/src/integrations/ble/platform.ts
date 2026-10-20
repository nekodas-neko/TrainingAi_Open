import type { BleAdapter } from './types';

export const bleAdapter: BleAdapter = {
  available: false,
  radio: async () => 'unsupported',
  onRadioChange: () => () => {},
  permission: async () => 'denied',
  scan: (_onFound, onError) => {
    onError('Pairing needs the TrainingAi app on your phone.');
    return () => {};
  },
  connect: async () => {
    throw new Error('Strap connection needs the TrainingAi app on your phone.');
  },
  connectScale: async () => {
    throw new Error('Scale connection needs the TrainingAi app on your phone.');
  },
};
