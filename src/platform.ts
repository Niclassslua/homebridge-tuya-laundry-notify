import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig, TuyaApiCredentials } from './interfaces/notifyConfig'; // Import new config interfaces
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import { ConfigManager } from './lib/configManager';
import { IPCServer } from './lib/ipcServer';
import { SmartPlugService } from './lib/smartPlugService';
import TuyaOpenAPI from './core/TuyaOpenAPI'; // Import TuyaOpenAPI for cloud interactions

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private ipcServer!: IPCServer;
  private smartPlugService!: SmartPlugService;
  private apiInstance: any; // To hold the instance of the Tuya API after authentication

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & NotifyConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialized.');

    // Initialize ConfigManager to extract necessary configuration
    const configManager = new ConfigManager(this.config);
    this.log.info('Configuration Manager initialized. Fetching configuration...');

    const { laundryDevices, tuyaApiCredentials } = configManager.getConfig();  // Fetch the devices and API credentials

    // Debug-Prints für Laundry Devices
    if (laundryDevices && laundryDevices.length > 0) {
      this.log.info(`Laundry Devices Found: ${laundryDevices.length}`);
      laundryDevices.forEach((device, index) => {
        this.log.info(`Device ${index + 1}: Name=${device.name}, ID=${device.id}, IP=${device.ipAddress}`);
      });
    } else {
      this.log.info('No Laundry Devices found.');
    }

    // Debug-Prints für Tuya API Credentials
    if (tuyaApiCredentials) {
      this.log.info(`Tuya API Credentials:`);
      this.log.info(`Access ID: ${tuyaApiCredentials.accessId}`);
      this.log.info(`Access Key: ${tuyaApiCredentials.accessKey}`);
      this.log.info(`Username: ${tuyaApiCredentials.username}`);
      this.log.info(`Country Code: ${tuyaApiCredentials.countryCode}`);
      this.log.info(`App Schema: ${tuyaApiCredentials.appSchema}`);
      this.log.info(`Endpoint: ${tuyaApiCredentials.endpoint}`);
    } else {
      this.log.error('No Tuya API credentials found in configuration.');
    }

    // Initialize laundry devices
    const messageGateway = new MessageGateway(log, this.config, api);
    if (laundryDevices) {
      for (const laundryDevice of laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api));
      }
    }

    // Perform Tuya API authentication on Homebridge launch
    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');

      // Prüfe, ob Tuya API Credentials existieren
      if (!tuyaApiCredentials) {
        this.log.error('Tuya API credentials are missing. Authentication cannot proceed.');
        return;
      }

      // Authenticate with the Tuya API
      this.apiInstance = await this.authenticateTuya(tuyaApiCredentials);

      if (this.apiInstance) {
        this.log.info('Tuya API successfully authenticated.');
        // Initialize SmartPlugService after authentication
        this.smartPlugService = new SmartPlugService(this.apiInstance, this.log);
      } else {
        this.log.error('Failed to authenticate with Tuya API.');
      }

      this.ipcServer = new IPCServer(this.log, this.config, this.smartPlugService);
      this.ipcServer.start();

    });
  }

  // Method to handle Tuya API authentication
  private async authenticateTuya(credentials: TuyaApiCredentials) {
    const { accessId, accessKey, username, password, countryCode, endpoint, appSchema } = credentials;

    const apiInstance = new TuyaOpenAPI(endpoint, accessId, accessKey);  // Use endpoint from credentials

    try {
      const res = await apiInstance.homeLogin(Number(countryCode), username, password, appSchema);  // Use appSchema from credentials
      if (res && res.success) {
        this.log.info('Successfully authenticated with Tuya OpenAPI.');
        return apiInstance;
      } else {
        this.log.error('Authentication failed:', res ? res.msg : 'No response from API');
        return null;
      }
    } catch (error) {
      this.log.error('Error during Tuya API authentication:', error);
      return null;
    }
  }
}