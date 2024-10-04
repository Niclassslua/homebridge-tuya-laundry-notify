import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { laundryDevices, tuyaApiCredentials } = this.config;

    // Optional: Falls keine laundryDevices vorhanden sind, geben wir eine Warnung aus, brechen aber nicht ab
    if (!laundryDevices || laundryDevices.length === 0) {
      // Warnung ausgeben, aber keinen Fehler werfen
      console.warn('No laundry devices specified in the configuration. The plugin will start without monitoring any devices.');
    }

    // Überprüfen, ob die Tuya API-Anmeldeinformationen vorhanden sind
    if (!tuyaApiCredentials || !tuyaApiCredentials.accessId || !tuyaApiCredentials.accessKey ||
      !tuyaApiCredentials.username || !tuyaApiCredentials.password ||
      !tuyaApiCredentials.countryCode || !tuyaApiCredentials.appSchema ||
      !tuyaApiCredentials.endpoint) {
      throw new Error('Tuya API credentials and necessary fields (accessId, accessKey, username, password, countryCode, appSchema, endpoint) must be provided.');
    }

    console.log('Laundry Device Config:', this.config.laundryDevices);

    // Validierung der vorhandenen Gerätedaten, falls vorhanden
    if (laundryDevices && laundryDevices.length > 0) {
      laundryDevices.forEach((device) => {
        const { deviceId, localKey, ipAddress } = device;
        if (!deviceId || !localKey || !ipAddress) {
          console.warn(`Device ${device.name || deviceId} is missing ID, Key, or IP Address and will not be monitored.`);
          return;
        }
      });
    }

    return {
      laundryDevices: laundryDevices || [],  // Gebe ein leeres Array zurück, falls keine Geräte definiert sind
      tuyaApiCredentials,
    };
  }
}