import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import TuyaOpenAPI from './core/TuyaOpenAPI';
import TuyaOpenMQ from './core/TuyaOpenMQ';  // Import TuyaOpenMQ for MQTT handling
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
  private tuyaMQ!: TuyaOpenMQ;  // Declare TuyaOpenMQ for MQTT

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

    // Initialize services
    this.smartPlugService = new SmartPlugService(this.apiInstance, this.log);
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
    this.log.info('Connecting to Tuya Cloud...');
    const { accessId, accessKey, countryCode, username, password, appSchema } = this.config;

    // Login to Tuya API
    const res = await this.apiInstance.homeLogin(
      Number(countryCode),
      username ?? '',
      password ?? '',
      appSchema ?? 'tuyaSmart'
    );

    if (!res.success) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      setTimeout(() => this.connect(), 5000);
      return;
    }

    this.log.info('Login to Tuya Cloud successful.');

    // Initialize MQTT for message handling
    this.mqttHandler = new MQTTHandler(this.log, this.tuyaMQ);  // Use TuyaOpenMQ
    this.mqttHandler.startListening();

    this.log.info('Connecting to Laundry Devices...');
    for (const laundryDevice of this.laundryDevices) {
      try {
        const uuid = this.api.hap.uuid.generate(laundryDevice.config.name);
        const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
        if (laundryDevice.config.exposeStateSwitch) {
          if (!cachedAccessory) {
            laundryDevice.accessory = new this.api.platformAccessory(laundryDevice.config.name, uuid);
            laundryDevice.accessory.addService(this.api.hap.Service.Switch, laundryDevice.config.name);
            this.accessories.push(laundryDevice.accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
          } else {
            laundryDevice.accessory = cachedAccessory;
          }
        }
        await laundryDevice.init();
      } catch (error) {
        this.log.error(`Failed to init ${laundryDevice.config.name}`, error);
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