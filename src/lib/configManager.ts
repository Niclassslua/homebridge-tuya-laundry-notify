import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { laundryDevices, tuyaApiCredentials } = this.config;

    if (!laundryDevices || laundryDevices.length === 0) {
      throw new Error('At least one laundry device must be specified in the configuration.');
    }

    // Prüfe, ob die Tuya-API-Zugangsdaten definiert sind
    if (!tuyaApiCredentials) {
      throw new Error('Tuya API credentials must be provided.');
    }

    // Validate Tuya API Credentials
    const { accessId, accessKey, username, password, countryCode } = tuyaApiCredentials;
    if (!accessId || !accessKey || !username || !password || !countryCode) {
      throw new Error('Tuya API credentials (Access ID, Access Key, Username, Password, and Country Code) must be provided.');
    }

    // Validate each device's required fields (deviceId, localKey, ipAddress)
    laundryDevices.forEach((device) => {
      const { id, key, ipAddress } = device; // Verwende id statt deviceId
      if (!id || !key || !ipAddress) {
        throw new Error(`Device ${device.name || id} must have an ID, Key, and IP Address.`);
      }
    });

    return {
      laundryDevices,
      tuyaApiCredentials,  // Return the API credentials along with the devices
    };
  }
}