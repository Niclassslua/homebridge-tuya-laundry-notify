import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { laundryDevices, accessId, accessKey, username, password, countryCode, appSchema, endpoint } = this.config;

    if (!laundryDevices || laundryDevices.length === 0) {
      throw new Error('At least one laundry device must be specified in the configuration.');
    }

    if (!accessId || !accessKey || !username || !password || !countryCode || !appSchema || !endpoint) {
      throw new Error('Tuya API credentials and necessary fields (accessId, accessKey, username, password, countryCode, appSchema, endpoint) must be provided.');
    }

    // Validate each device's required fields (id, key, ipAddress)
    laundryDevices.forEach((device) => {
      const { id, key, ipAddress } = device;
      if (!id || !key || !ipAddress) {
        throw new Error(`Device ${device.name || id} must have an ID, Key, and IP Address.`);
      }
    });

    return {
      laundryDevices,
      tuyaApiCredentials: {
        accessId,
        accessKey,
        username,
        password,
        countryCode,
        appSchema,
        endpoint,
      },
    };
  }
}