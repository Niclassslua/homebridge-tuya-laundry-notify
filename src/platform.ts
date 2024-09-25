import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';

// Importiere den TuyaContext aus dem richtigen Paket
import { TuyaContext } from '@tuya/tuya-connector-nodejs';

// Weitere Importe
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

let Accessory: typeof PlatformAccessory;

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];

  // TuyaContext als Instanzvariable hinzufügen
  private tuyaContext: TuyaContext;

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

    // TuyaContext initialisieren
    this.tuyaContext = new TuyaContext({
      baseUrl: TuyaOpenAPI.getDefaultEndpoint(countryCode ?? 0),
      accessKey: accessId || '',
      secretKey: accessKey || '',
    });

    if (this.typedConfig.laundryDevices && this.typedConfig.laundryDevices.length > 0) {
      this.log.info('Wäschegeräte gefunden.');
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, this.tuyaContext));
        this.log.info(`Wäschegerät hinzugefügt: ${laundryDevice.name}`);
      }
    } else {
      this.log.warn('Keine Wäschegeräte konfiguriert. Bitte füge "laundryDevices" zu deiner Konfiguration hinzu.');
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge ist gestartet, beginne mit der Initialisierung.');
      await this.connect();
      this.startIPCServer();
    });
  }

  private async connect() {
    // Hier können wir die Authentifizierung mit der Tuya Cloud durchführen, falls erforderlich
    // `@tuya/tuya-connector-nodejs` kümmert sich um die Token-Verwaltung
    this.log.info('Verbinde mit der Tuya Cloud...');
    // Keine zusätzliche Aktion erforderlich
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Accessoire geladen: ${accessory.displayName}`);
    this.accessories.push(accessory);
    this.log.info(`Accessoire hinzugefügt: ${accessory.displayName}`);
  }

  private startIPCServer() {
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');

    this.log.info(`Starte den IPC-Server auf ${socketPath}`);

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
    this.log.info('Hole Geräte von der Tuya Cloud...');
    try {
      const response = await this.tuyaContext.request({
        path: '/v1.0/iot-01/associated-users/devices',
        method: 'GET',
      });

      if (response.success) {
        const devices = response.result;
        // Alle Geräte ausgeben, um die verfügbaren Kategorien zu prüfen
        this.log.info(`Alle Geräte: ${JSON.stringify(devices)}`);

        // Filtere die Geräte nach Smart Plugs
        const smartPlugs = devices.filter((device: any) => {
          // Hier filtern wir nach der Kategorie 'cz', die für Steckdosen steht
          // Passe die Kategorie an, falls deine Geräte eine andere Kategorie haben
          return device.category === 'cz';
        });

        return smartPlugs.map((plug: any) => ({
          name: plug.name,
          id: plug.id,
        }));
      } else {
        this.log.error(`Fehler beim Abrufen der Geräte: ${response.msg}`);
        return [];
      }
    } catch (error) {
      this.log.error(`Exception beim Abrufen der Geräte: ${error.message}`);
      return [];
    }
  }
}