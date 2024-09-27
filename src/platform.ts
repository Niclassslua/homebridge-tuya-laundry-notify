import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import TuyaOpenAPI, { LOGIN_ERROR_MESSAGES } from './core/TuyaOpenAPI';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MQTTHandler } from './lib/mqttHandler';
import { IPCServer } from './lib/ipcServer';
import { SmartPlugService } from './lib/smartPlugService';

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private apiInstance!: TuyaOpenAPI;
  private mqttHandler!: MQTTHandler;
  private ipcServer!: IPCServer;
  private smartPlugService!: SmartPlugService;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialized.');
    this.typedConfig = config as PlatformConfig & NotifyConfig;

    // API-Initialisierung
    const { accessId, accessKey, endpoint, countryCode, username, password, appSchema } = this.typedConfig;
    const effectiveEndpoint = endpoint ?? 'https://openapi.tuyaeu.com';

    if (!accessId || !accessKey || !effectiveEndpoint) {
      throw new Error('Access ID, Access Key, and Endpoint must be specified in the configuration.');
    }

    this.log.info(`Credentials: accessId=${accessId}, accessKey=${accessKey}, endpoint=${effectiveEndpoint}`);

    this.apiInstance = new TuyaOpenAPI(effectiveEndpoint, accessId, accessKey, this.log, 'en', false);
    this.smartPlugService = new SmartPlugService(this.apiInstance, this.log);
    this.ipcServer = new IPCServer(this.log, this.config);

    // Initialisiere Geräte-Tracker
    if (this.typedConfig.laundryDevices) {
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, this.smartPlugService, laundryDevice, api, this.apiInstance));
      }
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');
      await this.connect();
      this.ipcServer.start();  // Starte den IPC-Server
    });
  }

  private async connect() {
    this.log.info('Connecting to Tuya Cloud...');
    const { accessId, accessKey, countryCode, username, password, appSchema, endpoint } = this.typedConfig;

    const effectiveCountryCode = Number(countryCode ?? '49');
    const effectiveUsername = username ?? '';
    const effectivePassword = password ?? '';
    const effectiveAppSchema = appSchema ?? 'tuyaSmart';

    // Login zur Tuya API
    const res = await this.apiInstance.homeLogin(effectiveCountryCode, effectiveUsername, effectivePassword, effectiveAppSchema);
    if (!res.success) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      if (LOGIN_ERROR_MESSAGES[res.code]) {
        this.log.error(LOGIN_ERROR_MESSAGES[res.code]);
      }
      setTimeout(() => this.connect(), 5000);
      return;
    }

    this.log.info('Connected to Tuya Cloud.');

    // MQTT-Handler initialisieren
    this.initializeMQTTListeners();

    // Laundry-Geräte verbinden
    await this.connectLaundryDevices();
  }

  private async connectLaundryDevices() {
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

  private initializeMQTTListeners() {
    this.mqttHandler = new MQTTHandler(this.log, this.apiInstance);
    this.mqttHandler.startListening();
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