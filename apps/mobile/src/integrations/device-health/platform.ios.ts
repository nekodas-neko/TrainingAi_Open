import { isRunningInExpoGo } from 'expo';
export const deviceHealthName = 'Apple Health';
export const deviceHealthAvailable = () => !isRunningInExpoGo();
export const openDeviceHealthSettings = async () => {};
