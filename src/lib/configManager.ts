import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { laundryDevices, tuyaApiCredentials } = this.config;

    if (!laundryDevices || laundryDevices.length === 0) {
      throw new Error('At least one laundry device must be specified in the configuration.');
    }

    // Überprüfen, ob `tuyaApiCredentials` vorhanden sind
    if (!tuyaApiCredentials || !tuyaApiCredentials.accessId || !tuyaApiCredentials.accessKey ||
      !tuyaApiCredentials.username || !tuyaApiCredentials.password ||
      !tuyaApiCredentials.countryCode || !tuyaApiCredentials.appSchema ||
      !tuyaApiCredentials.endpoint) {
      throw new Error('Tuya API credentials and necessary fields (accessId, accessKey, username, password, countryCode, appSchema, endpoint) must be provided.');
    }

    // Validierung der Gerätedaten
    laundryDevices.forEach((device) => {
      const { id, key, ipAddress } = device;
      if (!id || !key || !ipAddress) {
        throw new Error(`Device ${device.name || id} must have an ID, Key, and IP Address.`);
      }
    });

    return {
      laundryDevices,
      tuyaApiCredentials,  // Gib das gesamte `tuyaApiCredentials`-Objekt zurück
    };
  }
}