import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { TuyaLaundryNotifyPlatform } from './platform';

export class TuyaLaundryNotify {
  private accessories: PlatformAccessory[] = []; // Liste aller Accessoires

  constructor(
    private readonly log: Logger,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => {
      this.log.info('Homebridge ist gestartet.');
      this.startIPCServer();
    });

    api.registerPlatform(PLATFORM_NAME, TuyaLaundryNotifyPlatform);
  }

  /**
   * Startet den IPC-Server für die Kommunikation über Unix-Sockets
   */
  private startIPCServer() {
    // Pfad für den Unix-Socket (nur auf Unix-Systemen)
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');

    // Vorhandene Socket-Datei entfernen
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((connection) => {
      connection.on('data', (data) => {
        const command = data.toString().trim();
        if (command === 'list-smartplugs') {
          const smartPlugs = this.getSmartPlugs();
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
      this.log.error(`IPC-Server Fehler: ${err.message}`);
    });
  }

  /**
   * Gibt eine Liste der gespeicherten Smart Plugs zurück
   */
  private getSmartPlugs() {
    const smartPlugs = this.filterSmartPlugs(this.accessories);

    return smartPlugs.map(plug => ({
      displayName: plug.displayName,
      UUID: plug.UUID,
    }));
  }

  /**
   * Filtert Smart Plugs aus der Liste der Accessoires heraus
   */
  private filterSmartPlugs(accessories: PlatformAccessory[]) {
    return accessories.filter(accessory => this.isSmartPlug(accessory));
  }

  /**
   * Prüft, ob ein Accessoire ein Smart Plug ist
   */
  private isSmartPlug(accessory: PlatformAccessory) {
    return accessory.services.some(service => {
      return service.UUID === this.api.hap.Service.Outlet.UUID;
    });
  }

  /**
   * Speichert Accessoire in der internen Liste, wenn es geladen wird
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(`Zubehör geladen: ${accessory.displayName}`);
    this.accessories.push(accessory); // Accessoire zur Liste hinzufügen
  }
}