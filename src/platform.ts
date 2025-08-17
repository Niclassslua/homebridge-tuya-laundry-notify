import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import { ConfigManager } from './lib/configManager';
import { IPCServer } from './lib/ipcServer';
import { TuyaApiService } from './lib/tuyaApiService';
import { SmartPlugService } from './lib/smartPlugService';

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private ipcServer!: IPCServer;
  private tuyaApiService!: TuyaApiService;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & NotifyConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialized.');

    const configManager = new ConfigManager(this.config);
    this.log.info('Configuration Manager initialized. Fetching configuration...');

    const { laundryDevices, tuyaApiCredentials } = configManager.getConfig();

    if (laundryDevices && laundryDevices.length > 0) {
      this.log.info(`Laundry Devices Found: ${laundryDevices.length}`);
      laundryDevices.forEach((device, index) => {
        this.log.info(`Device ${index + 1}: Name=${device.name}, ID=${device.deviceId}, IP=${device.ipAddress}`);
      });
    } else {
      this.log.info('No Laundry Devices found.');
    }

    if (tuyaApiCredentials) {
      this.log.info('Tuya API Credentials:');
      this.log.info(`Access ID: ${tuyaApiCredentials.accessId}`);
      this.log.info(`Access Key: ${tuyaApiCredentials.accessKey}`);
      this.log.info(`Username: ${tuyaApiCredentials.username}`);
      this.log.info(`Country Code: ${tuyaApiCredentials.countryCode}`);
      this.log.info(`App Schema: ${tuyaApiCredentials.appSchema}`);
      this.log.info(`Endpoint: ${tuyaApiCredentials.endpoint}`);
    } else {
      this.log.error('No Tuya API credentials found in configuration.');
    }

    const messageGateway = new MessageGateway(log, this.config, api);

    const smartPlugService = new SmartPlugService(this.tuyaApiService, log);

    if (laundryDevices) {
      for (const laundryDevice of laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, smartPlugService));
      }
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');

      if (!tuyaApiCredentials) {
        this.log.error('Tuya API credentials are missing. Authentication cannot proceed.');
        return;
      }

      this.tuyaApiService = TuyaApiService.getInstance(tuyaApiCredentials, this.log);
      await this.tuyaApiService.authenticate();

      const apiInstance = this.tuyaApiService.getApiInstance();

      if (apiInstance) {
        this.log.info('Tuya API successfully authenticated.');
      } else {
        this.log.error('Failed to authenticate with Tuya API.');
        return;
      }

      this.ipcServer = new IPCServer(this.log, this.config, this.tuyaApiService);
      this.ipcServer.start();

      if (this.config.laundryDevices) {
        for (const laundryDevice of this.laundryDevices) {
          try {
            const uuid = this.api.hap.uuid.generate(laundryDevice.config.name || laundryDevice.config.deviceId);
            const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

            if (laundryDevice.config.exposeStateSwitch) {
              if (!cachedAccessory) {
                const accessory = new this.api.platformAccessory(laundryDevice.config.name || laundryDevice.config.deviceId, uuid);
                laundryDevice.accessory = accessory;
                if (laundryDevice.accessory) {
                  laundryDevice.accessory.addService(this.api.hap.Service.Switch, laundryDevice.config.name);
                  this.accessories.push(laundryDevice.accessory);
                  this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
                }
              } else {
                laundryDevice.accessory = cachedAccessory;
              }
            }

            laundryDevice.init();
          } catch (error) {
            this.log.error(`Failed to init ${laundryDevice.config.name}`, error);
          }
        }
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    const existingDevice = this.laundryDevices.find(laundryDevice =>
      this.api.hap.uuid.generate(laundryDevice.config.name || laundryDevice.config.deviceId) === accessory.UUID,
    );

    if (!existingDevice || !existingDevice.config.exposeStateSwitch) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.accessories.push(accessory);
    }
  }
}