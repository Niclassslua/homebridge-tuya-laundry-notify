import {API, Logger, PlatformAccessory, PlatformConfig} from 'homebridge';
import {NotifyConfig} from './interfaces/notifyConfig';
import {IndependentPlatformPlugin} from 'homebridge/lib/api';
import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import TuyaOpenAPI, {LOGIN_ERROR_MESSAGES} from './core/TuyaOpenAPI';
import {LaundryDeviceTracker} from './lib/laundryDeviceTracker';
import {MessageGateway} from './lib/messageGateway';

let Accessory: typeof PlatformAccessory;

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.typedConfig = config as PlatformConfig & NotifyConfig;
    Accessory = api.platformAccessory;

    const messageGateway = new MessageGateway(log, this.typedConfig, api);

    const {accessId, accessKey, countryCode} = this.typedConfig;
    const tuyaAPI = new TuyaOpenAPI(
      TuyaOpenAPI.getDefaultEndpoint(countryCode),
      accessId,
      accessKey,
      this.log,
      'en',
      false);

    if (this.typedConfig.laundryDevices) {
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, tuyaAPI));
      }
    }

    this.api.on('didFinishLaunching', async () => {
      await this.connect(tuyaAPI);
    });
  }

  private async connect(tuyaAPI: TuyaOpenAPI) {
    this.log.info('Connecting to Tuya Cloud...');

    const {countryCode, username, password} = this.typedConfig;

    const res = await tuyaAPI.homeLogin(countryCode, username, password, 'tuyaSmart');
    if (!res.success) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      if (LOGIN_ERROR_MESSAGES[res.code]) {
        this.log.error(LOGIN_ERROR_MESSAGES[res.code]);
      }
      setTimeout(() => this.connect(tuyaAPI), 5000);
      return;
    }

    this.log.info('Connecting to Laundry Devices...');

    if (this.typedConfig.laundryDevices) {
      for (const laundryDevice of this.laundryDevices) {
        try {
          const uuid = this.api.hap.uuid.generate(laundryDevice.config.name);
          const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
          if (laundryDevice.config.exposeStateSwitch) {
            if (!cachedAccessory) {
              laundryDevice.accessory = new Accessory(laundryDevice.config.name, uuid);
              laundryDevice.accessory.addService(this.api.hap.Service.Switch, laundryDevice.config.name);
              this.accessories.push(laundryDevice.accessory);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
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
  }

  configureAccessory(accessory: PlatformAccessory): void {
    const existingDevice = this.laundryDevices.find((laundryDevice) =>
      this.api.hap.uuid.generate(laundryDevice.config.name) === accessory.UUID);
    if (!existingDevice || !existingDevice.config.exposeStateSwitch) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.accessories.push(accessory);
    }
  }
}
