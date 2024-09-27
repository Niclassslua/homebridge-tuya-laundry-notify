import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import TuyaOpenAPI from './core/TuyaOpenAPI';
import TuyaOpenMQ from './core/TuyaOpenMQ';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import { MQTTHandler } from './lib/mqttHandler';
import { IPCServer } from './lib/ipcServer';
import { SmartPlugService } from './lib/smartPlugService';
import { ConfigManager } from './lib/configManager';

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private apiInstance!: TuyaOpenAPI;
  private mqttHandler!: MQTTHandler;
  private ipcServer!: IPCServer;
  private smartPlugService!: SmartPlugService;
  private tuyaMQ!: TuyaOpenMQ;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & NotifyConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialized.');

    // Initialize ConfigManager to extract necessary configuration
    const configManager = new ConfigManager(this.config);
    const { accessId, accessKey, endpoint, countryCode, username, password, appSchema } = configManager.getConfig();

    // Tuya API initialization
    this.apiInstance = new TuyaOpenAPI(endpoint, accessId, accessKey, this.log, 'en', false);

    // Initialize TuyaOpenMQ for MQTT handling
    this.tuyaMQ = new TuyaOpenMQ(this.apiInstance, this.log);

    // Start MQTT connection
    this.tuyaMQ.start();

    // Initialize services with shared TuyaOpenMQ instance
    this.smartPlugService = new SmartPlugService(this.apiInstance, this.log, this.tuyaMQ);
    this.ipcServer = new IPCServer(this.log, this.config, this.smartPlugService);

    const messageGateway = new MessageGateway(log, this.config, api);

    // Initialize laundry devices
    if (this.config.laundryDevices) {
      for (const laundryDevice of this.config.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, this.apiInstance));
      }
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');
      await this.connect();
      this.ipcServer.start();  // Start the IPC server
    });
  }

  private async connect() {
    this.log.info('Starting connection to Tuya Cloud...');
    const { accessId, accessKey, countryCode, username, password, appSchema } = this.config;

    // Tuya API Login
    try {
      this.log.debug(`Attempting to log in with AccessId: ${accessId}, Username: ${username}, CountryCode: ${countryCode}`);
      const res = await this.apiInstance.homeLogin(
        Number(countryCode),
        username ?? '',
        password ?? '',
        appSchema ?? 'tuyaSmart'
      );

      if (!res.success) {
        this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
        this.log.debug('Retrying login in 5 seconds due to failure.');
        setTimeout(() => this.connect(), 5000);  // Retry after 5 seconds
        return;
      }

      this.log.info('Login to Tuya Cloud successful.');
      this.log.debug(`Login response: ${JSON.stringify(res)}`);

      // MQTT connection setup
      this.log.info('Starting MQTT connection for message handling...');
      this.mqttHandler = new MQTTHandler(this.log, this.tuyaMQ);
      this.mqttHandler.startListening();
    } catch (error) {
      this.log.error(`Error during Tuya Cloud login: ${error.message}`);
      this.log.debug(`Stack trace: ${error.stack}`);
    }

    this.log.info('Connecting to Laundry Devices...');
    for (const laundryDevice of this.laundryDevices) {
      try {
        const uuid = this.api.hap.uuid.generate(laundryDevice.config.name);
        const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
        if (laundryDevice.config.exposeStateSwitch) {
          if (!cachedAccessory) {
            this.log.debug(`Registering new accessory for ${laundryDevice.config.name}`);
            laundryDevice.accessory = new this.api.platformAccessory(laundryDevice.config.name, uuid);
            laundryDevice.accessory.addService(this.api.hap.Service.Switch, laundryDevice.config.name);
            this.accessories.push(laundryDevice.accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
          } else {
            this.log.debug(`Found cached accessory for ${laundryDevice.config.name}`);
            laundryDevice.accessory = cachedAccessory;
          }
        }
        await laundryDevice.init();
        this.log.info(`Successfully connected to device: ${laundryDevice.config.name}`);
      } catch (error) {
        this.log.error(`Failed to connect to ${laundryDevice.config.name}: ${error.message}`);
        this.log.debug(`Stack trace: ${error.stack}`);
      }
    }
  }

  configureAccessory(accessory: PlatformAccessory): void {
    const existingDevice = this.laundryDevices.find(laundryDevice =>
      this.api.hap.uuid.generate(laundryDevice.config.name) === accessory.UUID
    );

    if (!existingDevice || !existingDevice.config.exposeStateSwitch) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.accessories.push(accessory);
    }
  }
}