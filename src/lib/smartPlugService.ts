import { Logger } from 'homebridge';
import TuyAPI from 'tuyapi';
import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';

export class SmartPlugService {
  private devicesSeen = new Set<string>();

  constructor(private apiInstance: any, private log: Logger) {}

  // Methode zum Abrufen der Smart Plugs aus dem lokalen Netzwerk und anschließendes Abgleichen mit der Cloud
  async discoverSmartPlugs() {
    try {
      this.log.info('Starting device discovery from local network...');

      // Lokale Geräteentdeckung starten
      const localDevices = await this.discoverDevices(6666);
      const moreLocalDevices = await this.discoverDevices(6667);

      const allLocalDevices = [...localDevices, ...moreLocalDevices];

      if (allLocalDevices.length === 0) {
        this.log.warn('No devices found in the local network.');
      } else {
        this.log.info(`Local devices discovered: ${allLocalDevices.length}`);
      }

      // Abrufen von Cloud-Geräten und Abgleich
      this.log.info('Fetching devices from Tuya Cloud for comparison...');
      const cloudDevices = await this.getCloudDevices();

      const matchedDevices = allLocalDevices.map((localDevice) => {
        const cloudDevice = cloudDevices.find(device => device.deviceId === localDevice.deviceId);
        if (cloudDevice) {
          this.log.info(`Matched local device ${localDevice.deviceId} with cloud device ${cloudDevice.deviceId}.`);
          return { ...localDevice, ...cloudDevice };
        }
        return localDevice; // Falls keine Übereinstimmung gefunden wurde, wird nur das lokale Gerät verwendet
      });

      return matchedDevices;
    } catch (error) {
      this.log.error(`Error discovering smart plugs: ${error.message}`);
      return [];
    }
  }

  // Lokale Geräte im Netzwerk erkennen
  private async discoverDevices(port: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const discoveredDevices: any[] = [];

      socket.on('message', async (msg, rinfo) => {
        if (this.devicesSeen.has(msg.toString('hex'))) return;
        this.devicesSeen.add(msg.toString('hex'));

        let data = msg.slice(20, -8);

        try {
          data = Buffer.from(this.decryptUDP(data));
        } catch (e) {
          data = Buffer.from(data.toString());
        }

        try {
          const jsonData = JSON.parse(data.toString());
          discoveredDevices.push({
            deviceId: jsonData.gwId,
            ip: rinfo.address,
            version: jsonData.version,
          });
        } catch (err) {
          this.log.error('Error parsing device data:', err.message);
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

  // Method to calibrate power consumption
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket, washDurationSeconds: number) {
    // Implement calibration logic here
  }

  // Method to track power consumption
  async trackPowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket) {
    // Implement tracking logic here
  }

  // Method to identify power value
  async identifyPowerValue(deviceId: string, connection: net.Socket) {
    // Implement identification logic here
  }
}