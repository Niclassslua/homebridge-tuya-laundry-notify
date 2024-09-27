import { Logger } from 'homebridge';
import TuyAPI from 'tuyapi';
import { TuyaDiscovery } from 'tuyapi';  // Import TuyaDiscovery for device discovery
import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';

export class SmartPlugService {
  private devicesSeen = new Set<string>();

  constructor(private apiInstance: any, private log: Logger) {}

  // Methode zum Abrufen der Smart Plugs aus der Cloud und vom lokalen Netzwerk
  async discoverSmartPlugs() {
    try {
      this.log.info('Starting Tuya device discovery from cloud and local network...');

      // Abrufen von Cloud-Geräten
      const cloudDevices = await this.getCloudDevices();
      this.log.info(`Cloud devices discovered: ${cloudDevices.length}`);

      // Lokale Geräteentdeckung starten
      await this.discoverDevices(6666, cloudDevices, this.apiInstance);
      await this.discoverDevices(6667, cloudDevices, this.apiInstance);

      return cloudDevices;
    } catch (error) {
      this.log.error(`Error discovering smart plugs: ${error.message}`);
      return [];
    }
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

  // Lokale Geräte im Netzwerk erkennen
  private async discoverDevices(port: number, cloudDevices: any[], apiInstance: any) {
    const socket = dgram.createSocket('udp4');
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

        // Cloud-Gerät in der Liste finden
        const cloudDevice = cloudDevices.find(device => device.deviceId === jsonData.gwId);

        if (cloudDevice) {
          const deviceDetails = await this.getDeviceDetails(apiInstance, cloudDevice.deviceId);
          const localKey = deviceDetails.local_key || cloudDevice.localKey;

          if (localKey) {
            this.log.info(`Local Key for ${cloudDevice.displayName} received: ${localKey}`);
            await this.getDeviceInfo(jsonData.ip, jsonData.gwId, jsonData.version, localKey, cloudDevice.displayName, deviceDetails.mac);
          } else {
            this.log.error(`No Local Key available for ${cloudDevice.displayName}.`);
          }
        } else {
          this.log.warn(`Device ${jsonData.gwId} not found in cloud devices.`);
        }
      } catch (err) {
        this.log.error('Error parsing device data:', err.message);
      }
    });

    socket.bind(port, () => {
      this.log.info(`Listening on UDP port ${port} for Tuya broadcasts.`);
    });
  }

  // Funktion zum Abrufen des Local Keys und zusätzlicher Infos von der Tuya Cloud API
  private async getDeviceDetails(apiInstance: any, deviceId: string): Promise<any> {
    try {
      const deviceResponse = await apiInstance.get(`/v1.0/devices/${deviceId}`);
      if (!deviceResponse.result) {
        throw new Error('Error fetching device details.');
      }
      return deviceResponse.result;
    } catch (error) {
      this.log.error('Error fetching device details:', error);
      throw error;
    }
  }

  // Funktion zum Abrufen von Geräteinformationen bei bekanntem Local Key
  private async getDeviceInfo(ip: string, gwId: string, version: string, localKey: string, displayName: string, mac: string) {
    const device = new TuyAPI({
      id: gwId,
      key: localKey,
      ip: ip,
      version: version
    });

    try {
      await device.find();
      await device.connect();
      this.log.info(`Connected to device: ${displayName} (ID: ${gwId}, IP: ${ip}, MAC: ${mac}, Version: ${version})`);

      const status = await device.get({ dps: 1 });
      this.log.debug(`Device "${displayName}" status: ${status}`);
    } catch (err) {
      this.log.error(`Error fetching info for "${displayName}" (ID: ${gwId}):`, err);
    } finally {
      device.disconnect();
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

  }

  // Method to track power consumption
  async trackPowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket) {

  }
  // Method to identify power value
  async identifyPowerValue(deviceId: string, connection: net.Socket) {

  }
}