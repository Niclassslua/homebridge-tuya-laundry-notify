import TuyAPI from 'tuyapi';
import { Logger } from 'homebridge';
import dgram from 'dgram';
import crypto from 'crypto';
import { errorMessage } from './errors';

export class DeviceManager {
  private devicesSeen = new Set<string>();
  private cachedDevices: any[] = [];

  constructor(private apiInstance: any, private log: Logger) {}

  async discoverLocalDevices(): Promise<any[]> {
    try {
      // Reset seen devices before each discovery to allow multiple
      // sequential discovery runs. Previously, repeated calls would
      // return no devices because broadcasts from earlier runs were
      // cached in the set, preventing processing of the same devices
      // again.
      this.devicesSeen.clear();

      this.log.info('Starting LAN discovery...');
      const localDevicesPort2 = await this.discoverDevices(6667);
      const localDevicesPort1 = await this.discoverDevices(6666);

      const allLocalDevices = [...localDevicesPort1, ...localDevicesPort2];

      if (allLocalDevices.length === 0) {
        this.log.warn('No devices found in the local network.');

        if (this.cachedDevices.length > 0) {
          this.log.info('Returning cached devices.');
          return this.cachedDevices;
        }

        return [];
      }

      this.log.info(`Discovered ${allLocalDevices.length} local devices.`);
      this.cachedDevices = allLocalDevices;

      return allLocalDevices;
    } catch (error) {
      this.log.error(`Error discovering local devices: ${errorMessage(error)}`);

      if (this.cachedDevices.length > 0) {
        this.log.info('Returning cached devices after error.');
        return this.cachedDevices;
      }

      return [];
    }
  }

  private async discoverDevices(port: number): Promise<any[]> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const discoveredDevices: any[] = [];

      socket.on('message', async (msg, rinfo) => {
        if (this.devicesSeen.has(msg.toString('hex'))) return;
        this.devicesSeen.add(msg.toString('hex'));

        let data = msg.slice(20, -8);

        try {
          data = Buffer.from(this.decryptUDP(data));
        } catch (e) {
          this.log.error(`Error decrypting UDP message: ${errorMessage(e)}`);
          return;
        }

        try {
          const jsonData = JSON.parse(data.toString());
          discoveredDevices.push({
            deviceId: jsonData.gwId,
            ip: rinfo.address,
            version: jsonData.version,
          });
        } catch (err) {
          this.log.error(`Error parsing device data: ${errorMessage(err)}`);
        }
      });

      socket.bind(port, () => {
        this.log.info(`Listening on UDP port ${port} for Tuya broadcasts.`);
        setTimeout(() => {
          socket.close();
          resolve(discoveredDevices);
        }, 5000);
      });
    });
  }

  // Method to match local devices with cloud devices
  async matchLocalWithCloudDevices(localDevices: any[]): Promise<any[]> {
    try {
      this.log.info('Fetching devices from Tuya Cloud for comparison...');

      // Fetch cloud devices
      const cloudDevices = await this.getCloudDevices();
      if (cloudDevices.length === 0) {
        this.log.warn('No devices found in Tuya Cloud.');
        return [];
      }

      // Match local devices with cloud devices by their deviceId
      const matchedDevices = localDevices
        .map((localDevice) => {
          const cloudDevice = cloudDevices.find((device) => device.deviceId === localDevice.deviceId);
          if (cloudDevice) {
            this.log.info(`Matched local device ${localDevice.deviceId} with cloud device ${cloudDevice.deviceId}.`);
            return { ...localDevice, ...cloudDevice }; // Merge local and cloud data
          }
          return null;
        })
        .filter((device) => device !== null); // Remove null entries

      if (matchedDevices.length === 0) {
        this.log.info('No matching devices found.');
      } else {
        this.log.info(`Matched ${matchedDevices.length} devices with the Tuya Cloud.`);
      }

      return matchedDevices;
    } catch (error) {
      this.log.error(`Error matching devices with Tuya Cloud: ${errorMessage(error)}`);
      return [];
    }
  }

  private async getCloudDevices(): Promise<any[]> {
    try {
      this.log.debug('Starting to fetch cloud devices from Tuya API...');

      const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
      this.log.debug('Response from Tuya API received:', devicesResponse);

      if (!devicesResponse.success) {
        this.log.error(`Fetching cloud devices failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
        return [];
      }

      this.log.debug(`Total devices received from cloud: ${devicesResponse.result.devices.length}`);

      const filteredDevices = devicesResponse.result.devices
        .filter((device: any) => {
          const isCategoryCZ = device.category === 'cz';
          this.log.debug(`Device ${device.id} category=${device.category}, isCategoryCZ=${isCategoryCZ}`);
          return isCategoryCZ;
        })
        .map((device: any) => {
          const deviceInfo = {
            displayName: device.name,
            deviceId: device.id,
            localKey: device.local_key,
            category: device.category,
          };
          this.log.debug(`Mapped device info: ${JSON.stringify(deviceInfo)}`);
          return deviceInfo;
        });

      this.log.debug(`Filtered and mapped ${filteredDevices.length} devices from the cloud.`);
      return filteredDevices;

    } catch (error) {
      this.log.error(`Error fetching cloud devices: ${errorMessage(error)}`);
      return [];
    }
  }

  private decryptUDP(msg: Buffer): string {
    const udpkey = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();
    const decipher = crypto.createDecipheriv('aes-128-ecb', udpkey, Buffer.alloc(0));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(msg), decipher.final()]).toString('utf8').trim().replace(/[^\x20-\x7E]/g, '');

    return decrypted;
  }

  async getLocalDPS(device: any): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const plug = new TuyAPI({
          id: device.deviceId,
          key: device.localKey,
          ip: device.ip,
          version: device.version,
          issueGetOnConnect: true,
          issueRefreshOnConnect: true,
          issueRefreshOnPing: true,
          nullPayloadOnJSONError: true
        });

        plug.find().then(() => {
          plug.connect();
        });

        plug.on('connected', () => {
          this.log.debug('Connected to device.');
        });

        plug.on('disconnected', () => {
          this.log.debug('Disconnected from device.');
        });

        plug.on('error', (error: unknown) => {
          const msg = errorMessage(error);
          this.log.error(`Error occurred: ${msg}`);
          reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${msg}`));
        });

        plug.on('data', (data) => {
          this.log.debug(`Data from device: ${JSON.stringify(data)}`);
          plug.disconnect();
          resolve(data);
        });

        plug.refresh({ schema: true });

        setTimeout(() => {
          plug.disconnect();
          reject(new Error(`Timeout: No DPS data received for device ${device.deviceId}`));
        }, 10000);
      } catch (error) {
        const msg = errorMessage(error);
        this.log.error(`Error retrieving status for device ${device.deviceId}: ${msg}`);
        reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${msg}`));
      }
    });
  }
}
