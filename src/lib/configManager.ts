import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { laundryDevices, tuyaApiCredentials, notifications } = this.config;

    // Optional: Log a warning if no laundry devices are specified, but continue
    if (!laundryDevices || laundryDevices.length === 0) {
      console.warn('No laundry devices specified in the configuration. The plugin will start without monitoring any devices.');
    }

    // Check if Tuya API credentials are provided and contain necessary fields
    if (!tuyaApiCredentials || !tuyaApiCredentials.accessId || !tuyaApiCredentials.accessKey ||
      !tuyaApiCredentials.username || !tuyaApiCredentials.password ||
      !tuyaApiCredentials.countryCode || !tuyaApiCredentials.appSchema ||
      !tuyaApiCredentials.endpoint) {
      throw new Error('Tuya API credentials and necessary fields (accessId, accessKey, username, password, countryCode, appSchema, endpoint) must be provided.');
    }

    console.log('Laundry Device Config:', this.config.laundryDevices);

    // Validate device data if available
    if (laundryDevices && laundryDevices.length > 0) {
      laundryDevices.forEach((device) => {
        const { deviceId, localKey, ipAddress } = device;
        if (!deviceId || !localKey || !ipAddress) {
          console.warn(`Device ${device.name || deviceId} is missing ID, Key, or IP Address and will not be monitored.`);
          return;
        }
      });
    }

    // Return the configuration, including notifications if configured
    return {
      laundryDevices: laundryDevices || [],  // Return an empty array if no devices are defined
      tuyaApiCredentials,
      notifications: notifications || {},  // Include notifications or default to an empty object if not provided
    };
  }
}