import {API, Logger, PlatformAccessory, PlatformConfig} from 'homebridge';
import {NotifyConfig} from './interfaces/notifyConfig';
import {IndependentPlatformPlugin} from 'homebridge/lib/api';
import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import TuyaOpenAPI, {LOGIN_ERROR_MESSAGES} from './core/TuyaOpenAPI';
import {LaundryDeviceTracker} from './lib/laundryDeviceTracker';
import {MessageGateway} from './lib/messageGateway';
import TuyaOpenMQ from './core/TuyaOpenMQ';

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
      TuyaOpenAPI.getDefaultEndpoint(countryCode ?? 0),
      accessId || '',
      accessKey || '',
      this.log,
      'en',
      false);

    if (this.typedConfig.laundryDevices && this.typedConfig.laundryDevices.length > 0) {
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, tuyaAPI));
      }
    } else {
      this.log.warn('Keine Wäschegeräte konfiguriert. Bitte füge "laundryDevices" zu deiner Konfiguration hinzu.');
    }

    this.api.on('didFinishLaunching', async () => {
      await this.connect(tuyaAPI);
    });
  }

  private async connect(tuyaAPI: TuyaOpenAPI) {
    this.log.info('Verbinde mit der Tuya Cloud...');

    let { countryCode} = this.typedConfig;
    const { username, password } = this.typedConfig;

    if (!username || !password) {
      this.log.warn('Tuya Cloud-Zugangsdaten fehlen (username oder password). Bitte aktualisiere deine Konfiguration.');
      return; // Beende die Verbindungsmethode
    }

    // Absicherung des countryCode
    countryCode = countryCode ?? 1; // Verwende 1 als Standardwert, falls countryCode undefined ist.

    const res = await tuyaAPI.homeLogin(countryCode, username, password, 'tuyaSmart');
    if (!res.success) {
      this.log.error(`Anmeldung fehlgeschlagen. code=${res.code}, msg=${res.msg}`);
      if (LOGIN_ERROR_MESSAGES[res.code]) {
        this.log.error(LOGIN_ERROR_MESSAGES[res.code]);
      }
      setTimeout(() => this.connect(tuyaAPI), 5000);
      return;
    }

    const mq = new TuyaOpenMQ(tuyaAPI, this.log);

    this.log.info('Verbinde mit Wäschegeräten...');

    if (this.laundryDevices.length > 0) {
      for (const laundryDevice of this.laundryDevices) {
        mq.addMessageListener(laundryDevice.onMQTTMessage.bind(laundryDevice));
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
          await laundryDevice.init();
        } catch (error) {
          this.log.error(`Fehler beim Initialisieren von ${laundryDevice.config.name}`, error);
        }
      }
    } else {
      this.log.warn('Keine Wäschegeräte zum Verbinden vorhanden.');
    }

    this.log.info('Starte MQTT...');
    mq.start();
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
