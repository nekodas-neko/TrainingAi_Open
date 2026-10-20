/**
 * Fired on `window` when new Oura data may have reached the app: after a Bluetooth drain settles
 * (`announceOuraSynced`) and after a sync pull that carried Oura-fed rows (`invalidatePulledDomains`).
 * The name predates the Oura API (#3077) and is kept so every listener keeps working.
 */
export const OURA_DATA_CHANGED_EVENT = 'ta:oura-ble-synced'
