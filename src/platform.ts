import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import TuyaOpenAPI, { LOGIN_ERROR_MESSAGES } from './core/TuyaOpenAPI';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import TuyaOpenMQ from './core/TuyaOpenMQ';

// IPC-related imports
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

let Accessory: typeof PlatformAccessory;

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];

  // Tuya API als Instanzvariable hinzufügen
  private tuyaAPI: TuyaOpenAPI;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialisiert.');
    this.typedConfig = config as PlatformConfig & NotifyConfig;
    Accessory = api.platformAccessory;

    const messageGateway = new MessageGateway(log, this.typedConfig, api);

    const { accessId, accessKey, countryCode } = this.typedConfig;
    this.log.info(`Zugangsdaten: accessId=${accessId}, accessKey=${accessKey}, countryCode=${countryCode}`);

    // Tuya API initialisieren und als Instanzvariable speichern
    this.tuyaAPI = new TuyaOpenAPI(
      TuyaOpenAPI.getDefaultEndpoint(countryCode ?? 0),
      accessId || '',
      accessKey || '',
      this.log,
      'en',
      false,
    );

    if (this.typedConfig.laundryDevices && this.typedConfig.laundryDevices.length > 0) {
      this.log.info('Wäschegeräte gefunden.');
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, this.tuyaAPI));
        this.log.info(`Wäschegerät hinzugefügt: ${laundryDevice.name}`);
      }
    } else {
      this.log.warn('Keine Wäschegeräte konfiguriert. Bitte füge "laundryDevices" zu deiner Konfiguration hinzu.');
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge ist gestartet, beginne Verbindung zu Tuya.');
      await this.connect();
      this.startIPCServer();
    });
  }

  private async connect() {
    this.log.info('Verbinde mit der Tuya Cloud...');

    let { countryCode } = this.typedConfig;
    const { username, password } = this.typedConfig;

    if (!username || !password) {
      this.log.warn('Tuya Cloud-Zugangsdaten fehlen (username oder password). Bitte aktualisiere deine Konfiguration.');
      return; // Beende die Verbindungsmethode
    }

    // Absicherung des countryCode
    countryCode = countryCode ?? 1; // Verwende 1 als Standardwert, falls countryCode undefined ist.

    const res = await this.tuyaAPI.homeLogin(countryCode, username, password, 'tuyaSmart');
    if (!res.success) {
      this.log.error(`Anmeldung fehlgeschlagen. code=${res.code}, msg=${res.msg}`);
      if (LOGIN_ERROR_MESSAGES[res.code]) {
        this.log.error(LOGIN_ERROR_MESSAGES[res.code]);
      }
      setTimeout(() => this.connect(), 5000);
      return;
    }

    const mq = new TuyaOpenMQ(this.tuyaAPI, this.log);

    this.log.info('Verbinde mit Wäschegeräten...');

    if (this.laundryDevices.length > 0) {
      for (const laundryDevice of this.laundryDevices) {
        mq.addMessageListener(laundryDevice.onMQTTMessage.bind(laundryDevice));
        try {
          const uuid = this.api.hap.uuid.generate(laundryDevice.config.name);
          const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
          if (laundryDevice.config.exposeStateSwitch) {
            if (!cachedAccessory) {
              this.log.info(`Neues Accessoire wird erstellt für: ${laundryDevice.config.name}`);
              laundryDevice.accessory = new Accessory(laundryDevice.config.name, uuid);
              laundryDevice.accessory.addService(this.api.hap.Service.Outlet, laundryDevice.config.name);
              this.accessories.push(laundryDevice.accessory);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
            } else {
              laundryDevice.accessory = cachedAccessory;
              this.log.info(`Accessoire aus Cache geladen: ${cachedAccessory.displayName}`);
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
    this.log.info(`Accessoire geladen: ${accessory.displayName}`);
    this.accessories.push(accessory);
    this.log.info(`Accessoire hinzugefügt: ${accessory.displayName}`);
  }

  private startIPCServer() {
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');

    // Füge hier zusätzliche Logs hinzu, um zu sehen, ob der IPC-Server startet
    this.log.info(`Starte den IPC-Server auf ${socketPath}`);

    // Vorhandene Socket-Datei entfernen
    if (fs.existsSync(socketPath)) {
      this.log.info(`Entferne vorhandene Socket-Datei: ${socketPath}`);
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((connection) => {
      this.log.info('Verbindung über den IPC-Server erhalten');

      connection.on('data', async (data) => {
        const command = data.toString().trim();
        this.log.info(`Empfangener Befehl über IPC: ${command}`);

        if (command === 'list-smartplugs') {
          const smartPlugs = await this.getSmartPlugs();
          this.log.info(`Gefundene Smart Plugs: ${JSON.stringify(smartPlugs)}`);
          connection.write(JSON.stringify(smartPlugs));
          connection.end();
        } else {
          connection.write('Unbekannter Befehl');
          connection.end();
        }
      });
    });

    server.listen(socketPath, () => {
      this.log.info(`IPC-Server hört auf ${socketPath}`);
    });

    server.on('error', (err: Error) => {
      this.log.error(`Fehler beim IPC-Server: ${err.message}`);
    });
  }

  private async getSmartPlugs() {
    this.log.info('Hole Geräte von Tuya Cloud...');
    try {
      const response = await this.tuyaAPI.getDevices();
      if (response.success) {
        const devices = response.result;
        // Filtere die Geräte nach Smart Plugs
        const smartPlugs = devices.filter(device => {
          // Hier filtern wir nach der Kategorie 'cz', die für Steckdosen steht
          return device.category === 'cz';
        });
        return smartPlugs.map(plug => ({
          name: plug.name,
          id: plug.id,
        }));
      } else {
        this.log.error(`Fehler beim Abrufen der Geräte: ${response.msg}`);
        return [];
      }
    } catch (error) {
      this.log.error(`Exception beim Abrufen der Geräte: ${error}`);
      return [];
    }
  }

  private filterSmartPlugs(accessories: PlatformAccessory[]) {
    return accessories.filter(accessory => this.isSmartPlug(accessory));
  }

  private isSmartPlug(accessory: PlatformAccessory) {
    this.log.info(`Prüfe Accessoire: ${accessory.displayName}`);
    return accessory.services.some(service => {
      this.log.info(`Service UUID: ${service.UUID}, Name: ${service.displayName}`);
      return service.UUID === this.api.hap.Service.Outlet.UUID;
    });
  }
}