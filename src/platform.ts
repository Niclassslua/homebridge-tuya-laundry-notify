import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import TuyaOpenAPI from './core/TuyaOpenAPI'; // Nutze den vorhandenen Tuya API Manager

import fs from 'fs';
import path from 'path';
import * as Crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import net from 'net';
import os from 'os';

let Accessory: typeof PlatformAccessory;

interface TokenResponse {
  success: boolean;
  result: {
    access_token: string;
    refresh_token: string;
    expire_time: number;
  };
}

interface DevicesResponse {
  success: boolean;
  result: Array<{
    category: string;
    name: string;
    id: string;
    local_key: string;  // Device Key von Tuya
  }>;
}

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private tokenInfo = { access_token: '', refresh_token: '', expire: 0 };

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialisiert.');
    this.typedConfig = config as PlatformConfig & NotifyConfig;
    Accessory = api.platformAccessory;

    const messageGateway = new MessageGateway(this.log, this.typedConfig, this.api);
    const { accessId, accessKey, endpoint, countryCode, username, password, appSchema } = this.typedConfig;

    // Fallback für Werte
    const effectiveEndpoint = endpoint ?? 'https://openapi.tuyaeu.com';

    if (!accessId || !accessKey || !effectiveEndpoint) {
      throw new Error('Access ID, Access Key und Endpoint müssen in der Konfiguration angegeben werden.');
    }

    this.log.info(`Zugangsdaten: accessId=${accessId}, accessKey=${accessKey}, endpoint=${effectiveEndpoint}`);

    if (this.typedConfig.laundryDevices && this.typedConfig.laundryDevices.length > 0) {
      this.log.info('Wäschegeräte gefunden.');
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(
          log,
          messageGateway,
          laundryDevice,
          api,
          new TuyaOpenAPI(effectiveEndpoint, accessId, accessKey, log)
        ));
        this.log.info(`Wäschegerät hinzugefügt: ${laundryDevice.name}`);
      }
    } else {
      this.log.warn('Keine Wäschegeräte konfiguriert. Bitte füge "laundryDevices" zu deiner Konfiguration hinzu.');
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge ist gestartet, beginne mit der Initialisierung.');
      await this.initDevices();
      this.startIPCServer();  // Starte IPC-Server
    });
  }

  // Neue configureAccessory Methode hinzufügen
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);
    this.accessories.push(accessory);  // Füge das Accessoire zum internen Array hinzu
  }

  /**
   * Initialisiert die Tuya-Geräte.
   */
  async initDevices() {
    const { accessId, accessKey, countryCode, username, password, appSchema, endpoint } = this.typedConfig;

    const effectiveCountryCode = Number(countryCode ?? '49');
    const effectiveUsername = username ?? '';
    const effectivePassword = password ?? '';
    const effectiveAppSchema = appSchema ?? 'tuyaSmart';

    const api = new TuyaOpenAPI(endpoint ?? 'https://openapi.tuyaeu.com', accessId ?? '', accessKey ?? '', this.log);
    this.log.info('Log in to Tuya Cloud.');

    const res = await api.homeLogin(effectiveCountryCode, effectiveUsername, effectivePassword, effectiveAppSchema);
    if (res.success === false) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      return;
    }

    this.log.info('Fetching device list.');
    const devicesResponse = await api.get('/v1.0/iot-01/associated-users/devices');

    if (!devicesResponse.success) {
      this.log.error(`Fetching device list failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
      return;
    }

    const deviceList = devicesResponse.result?.devices;

    // Überprüfe, ob deviceList ein Array ist
    if (!Array.isArray(deviceList)) {
      this.log.error('deviceList is not an array');
      return;
    }

    if (deviceList.length === 0) {
      this.log.warn('No devices found.');
      return;
    }

    // Speichere die Geräteliste
    const filePath = path.join(this.api.user.persistPath(), 'TuyaDeviceList.json');
    this.log.info('Geräteliste gespeichert unter:', filePath);
    await fs.promises.writeFile(filePath, JSON.stringify(deviceList, null, 2));

    // Registriere Geräte
    for (const device of deviceList) {
      this.addAccessory(device);
    }
  }

  /**
   * Registriert ein Gerät in Homebridge.
   */
  addAccessory(device: any) {
    const uuid = this.api.hap.uuid.generate(device.id);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
    } else {
      this.log.info('Adding new accessory:', device.name);

      const accessory = new this.api.platformAccessory(device.name, uuid);
      accessory.context.deviceID = device.id;
      accessory.context.deviceKey = device.local_key;  // Speichere den Device Key im Kontext
      this.accessories.push(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  /**
   * Funktion zum Abrufen von Smart-Plugs mit Tuya-API (verwendet in IPC-Server)
   */
  async getSmartPlugs() {
    const { accessId, accessKey, endpoint } = this.typedConfig;
    const api = new TuyaOpenAPI(endpoint ?? 'https://openapi.tuyaeu.com', accessId ?? '', accessKey ?? '', this.log);

    this.log.info('Fetching Tuya smart plugs...');

    const devicesResponse = await api.get('/v1.0/iot-01/associated-users/devices');
    if (!devicesResponse.success) {
      this.log.error(`Fetching smart plugs failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
      return [];
    }

    const deviceList = devicesResponse.result?.devices ?? [];

    return deviceList.filter(device => device.category === 'cz').map(device => ({
      displayName: device.name,
      UUID: device.id,
      deviceId: device.id,
      deviceKey: device.local_key  // Device Key zurückgeben
    }));
  }

  // Funktion, um den IPC-Server zu starten (wie zuvor beschrieben)
  private startIPCServer() {
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');

    this.log.info(`Starte den IPC-Server auf ${socketPath}`);

    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((connection) => {
      this.log.info('Verbindung über den IPC-Server erhalten');

      connection.on('data', async (data) => {
        const command = data.toString().trim();
        this.log.info(`Empfangener Befehl über IPC: ${command}`);

        if (command === 'list-smartplugs') {
          const smartPlugs = await this.getSmartPlugs();
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
}