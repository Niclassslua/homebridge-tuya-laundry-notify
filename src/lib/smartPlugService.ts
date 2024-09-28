import { Logger } from 'homebridge';
import TuyAPI from 'tuyapi';
import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';

export class SmartPlugService {
  private devicesSeen = new Set<string>();

  constructor(private apiInstance: any, private log: Logger) {}

  // Methode zur Entdeckung von Geräten im lokalen Netzwerk
  async discoverLocalDevices(): Promise<any[]> {
    try {
      this.log.info('Starting LAN discovery...');

      // Lokale Geräteentdeckung über verschiedene Ports starten
      const localDevicesPort2 = await this.discoverDevices(6667);
      const localDevicesPort1 = await this.discoverDevices(6666);

      const allLocalDevices = [...localDevicesPort1, ...localDevicesPort2];

      if (allLocalDevices.length === 0) {
        this.log.warn('No devices found in the local network.');
        return [];
      }

      this.log.info(`Discovered ${allLocalDevices.length} local devices.`);
      return allLocalDevices;
    } catch (error) {
      this.log.error(`Error discovering local devices: ${error.message}`);
      return [];
    }
  }

  // Methode zum Abgleich lokaler Geräte mit Cloud-Geräten
  async matchLocalWithCloudDevices(localDevices: any[]): Promise<any[]> {
    try {
      this.log.info('Fetching devices from Tuya Cloud for comparison...');

      // Abrufen der Cloud-Geräte
      const cloudDevices = await this.getCloudDevices();
      if (cloudDevices.length === 0) {
        this.log.warn('No devices found in Tuya Cloud.');
        return [];
      }

      // Abgleichen der lokalen Geräte mit Cloud-Geräten und filtert nicht gematchte Geräte aus
      const matchedDevices = localDevices
        .map((localDevice) => {
          const cloudDevice = cloudDevices.find((device) => device.deviceId === localDevice.deviceId);
          if (cloudDevice) {
            this.log.info(`Matched local device ${localDevice.deviceId} with cloud device ${cloudDevice.deviceId}.`);
            return { ...localDevice, ...cloudDevice };
          }
          return null; // Falls keine Übereinstimmung gefunden wurde
        })
        .filter((device) => device !== null);

      if (matchedDevices.length === 0) {
        this.log.info('No matching devices found.');
      } else {
        this.log.info(`Matched ${matchedDevices.length} devices with the Tuya Cloud.`);
      }

      return matchedDevices;
    } catch (error) {
      this.log.error(`Error matching devices with Tuya Cloud: ${error.message}`);
      return [];
    }
  }

  // Lokale Geräte im Netzwerk erkennen
  private async discoverDevices(port: number): Promise<any[]> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const discoveredDevices: any[] = [];

      socket.on('message', async (msg, rinfo) => {
        // Überprüfen auf doppelte Nachrichten
        if (this.devicesSeen.has(msg.toString('hex'))) return;
        this.devicesSeen.add(msg.toString('hex'));

        this.log.info('Raw UDP data:', msg.toString('hex'));
        this.log.info('Received message length:', msg.length);

        let data = msg.slice(20, -8); // Entfernt den Header und die Signatur
        this.log.info('Received message length after trim:', data.length);

        try {
          // Versuche, die Nachricht zu entschlüsseln
          data = Buffer.from(this.decryptUDP(data));
          this.log.info('Decrypted data:', data.toString('hex'));
        } catch (e) {
          this.log.error('Error decrypting UDP message:', e.message);
          return;
        }

        let dataString;

        try {
          dataString = data.toString('utf8').trim();
          this.log.info('Received message length after toString:', dataString.length);

          // Entferne nicht-druckbare Zeichen (z.B. Steuerzeichen)
          dataString = dataString.replace(/[^\x20-\x7E]/g, '');
          this.log.info('Cleaned dataString:', dataString);

          // Versuch, den JSON-String zu parsen
          const jsonData = JSON.parse(dataString);
          discoveredDevices.push({
            deviceId: jsonData.gwId,
            ip: rinfo.address,
            version: jsonData.version,
          });
        } catch (err) {
          this.log.error('Error parsing device data:', err.message);

          // Debugging: zeige das problematische Zeichen
          const position = err.message.match(/at position (\d+)/);
          if (position) {
            const pos = parseInt(position[1], 10);
            const faultyChar = dataString.charAt(pos);
            this.log.error(`Problematisches Zeichen bei Position ${pos}: "${faultyChar}" (Unicode: ${faultyChar.charCodeAt(0)})`);
          }
        }
      });

      socket.bind(port, () => {
        this.log.info(`Listening on UDP port ${port} for Tuya broadcasts.`);
        setTimeout(() => {
          socket.close();
          resolve(discoveredDevices);
        }, 5000); // Warten für 5 Sekunden auf Broadcasts, dann beenden
      });
    });
  }

  // Funktion zum Abrufen von Geräten aus der Tuya Cloud API
  private async getCloudDevices(): Promise<any[]> {
    try {
      const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
      if (!devicesResponse.success) {
        this.log.error(`Fetching cloud devices failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
        return [];
      }

      return devicesResponse.result.devices.filter((device: any) => device.category === 'cz').map((device: any) => ({
        displayName: device.name,
        UUID: device.id,
        deviceId: device.id,
        localKey: device.local_key || null,
        category: device.category,
      }));
    } catch (error) {
      this.log.error('Error fetching cloud devices:', error);
      return [];
    }
  }

  // AES-ECB Entschlüsselung für UDP-Nachrichten
  private decryptUDP(msg: Buffer): string {
    const udpkey = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();
    const decipher = crypto.createDecipheriv('aes-128-ecb', udpkey, Buffer.alloc(0));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(msg), decipher.final()]);
    return decrypted.toString();
  }

  // Methode zum Kalibrieren des Stromverbrauchs
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket, washDurationSeconds: number) {
    try {
      this.log.info(`Starting calibration for device ${deviceId} with duration ${washDurationSeconds} seconds.`);
      connection.write(`Calibration started for device ${deviceId}. Duration: ${washDurationSeconds} seconds.\n`);
      setTimeout(() => {
        connection.write(`Calibration completed for device ${deviceId}.\n`);
      }, washDurationSeconds * 1000);
    } catch (error) {
      this.log.error(`Calibration failed for device ${deviceId}: ${error.message}`);
      connection.write(`Calibration failed for device ${deviceId}.\n`);
    }
  }

  // Methode zum Verfolgen des Stromverbrauchs
  async trackPowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket) {
    try {
      this.log.info(`Tracking power consumption for device ${deviceId} with PowerValueId ${powerValueId}.`);
      connection.write(`Tracking power consumption for device ${deviceId} with PowerValueId ${powerValueId}.\n`);
    } catch (error) {
      this.log.error(`Error tracking power consumption for device ${deviceId}: ${error.message}`);
      connection.write(`Error tracking power consumption for device ${deviceId}.\n`);
    }
  }

  // Methode zur Identifizierung eines Smart Plug über den Stromwert
  async identifyPowerValue(deviceId: string, connection: net.Socket) {
    try {
      this.log.info(`Identifying power value for device ${deviceId}.`);
      connection.write(`Power value identification started for device ${deviceId}.\n`);
    } catch (error) {
      this.log.error(`Power value identification failed for device ${deviceId}: ${error.message}`);
      connection.write(`Power value identification failed for device ${deviceId}.\n`);
    }
  }
}