import TuyAPI from 'tuyapi';
import { Logger } from 'homebridge';
import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';
const Chart = require('chart.js');
const { createCanvas } = require('canvas');
const fs = require('fs');

export class SmartPlugService {
  private devicesSeen = new Set<string>();
  private cachedDevices: any[] = [];  // Cache for previously discovered devices

  constructor(private apiInstance: any, private log: Logger) {}

  async getLocalDPS(device: any, log: any): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const plug = new TuyAPI({
          id: device.deviceId,
          key: device.localKey,
          ip: device.ip,
          version: device.version,
          issueGetOnConnect: true,
        });

        plug.find().then(() => {
          plug.connect();
        });

        plug.on('connected', () => {
          log.debug('Connected to device.');
        });

        plug.on('disconnected', () => {
          log.debug('Disconnected from device.');
        });

        plug.on('error', (error) => {
          log.error(`Error occurred: ${error.message}`);
          reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${error.message}`));
        });

        plug.on('data', (data) => {
          log.debug(`Data from device: ${JSON.stringify(data)}`);
          plug.disconnect(); // Optionally disconnect after receiving the data
          resolve(data); // Return the DPS data
        });

        plug.refresh({ schema: true });

        setTimeout(() => {
          plug.disconnect();
          reject(new Error(`Timeout: No DPS data received for device ${device.deviceId}`));
        }, 10000);
      } catch (error) {
        log.error(`Error retrieving status for device ${device.deviceId}: ${error.message}`);
        reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${error.message}`));
      }
    });
  }

  // Method to discover local devices
  async discoverLocalDevices(): Promise<any[]> {
    try {
      this.log.info('Starting LAN discovery...');
      const localDevicesPort2 = await this.discoverDevices(6667);
      const localDevicesPort1 = await this.discoverDevices(6666);

      const allLocalDevices = [...localDevicesPort1, ...localDevicesPort2];

      if (allLocalDevices.length === 0) {
        this.log.warn('No devices found in the local network.');

        if (this.cachedDevices.length > 0) {
          this.log.info('Returning cached devices.');
          return this.cachedDevices;  // If no new devices are found, return cached devices
        }

        return [];
      }

      this.log.info(`Discovered ${allLocalDevices.length} local devices.`);
      this.cachedDevices = allLocalDevices;  // Update the cache

      return allLocalDevices;
    } catch (error) {
      this.log.error(`Error discovering local devices: ${error.message}`);

      if (this.cachedDevices.length > 0) {
        this.log.info('Returning cached devices after error.');
        return this.cachedDevices;  // If an error occurs, use the cache
      }

      return [];
    }
  }

  // Method to match local devices with cloud devices
  async matchLocalWithCloudDevices(localDevices: any[]): Promise<any[]> {
    try {
      this.log.info('Fetching devices from Tuya Cloud for comparison...');

      const cloudDevices = await this.getCloudDevices();
      if (cloudDevices.length === 0) {
        this.log.warn('No devices found in Tuya Cloud.');
        return [];
      }

      // Match local devices with cloud devices
      const matchedDevices = localDevices
        .map((localDevice) => {
          const cloudDevice = cloudDevices.find((device) => device.deviceId === localDevice.deviceId);
          if (cloudDevice) {
            this.log.info(`Matched local device ${localDevice.deviceId} with cloud device ${cloudDevice.deviceId}.`);
            return { ...localDevice, ...cloudDevice };
          }
          return null;
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

  // Discover devices on the local network
  async discoverDevices(port: number): Promise<any[]> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const discoveredDevices: any[] = [];

      socket.on('message', async (msg, rinfo) => {
        if (this.devicesSeen.has(msg.toString('hex'))) return;
        this.devicesSeen.add(msg.toString('hex'));

        this.log.info('Raw UDP data:', msg.toString('hex'));

        let data = msg.slice(20, -8);  // Remove the header and signature
        this.log.info('Received message length after trim:', data.length);

        try {
          data = Buffer.from(this.decryptUDP(data));
          this.log.info('Decrypted data:', data.toString('hex'));
        } catch (e) {
          this.log.error('Error decrypting UDP message:', e.message);
          return;
        }

        let dataString;

        try {
          dataString = data.toString('utf8').trim();
          dataString = dataString.replace(/[^\x20-\x7E]/g, '');  // Remove non-printable characters

          const jsonData = JSON.parse(dataString);
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
        }, 5000);  // Wait for 5 seconds for broadcasts, then close
      });
    });
  }

  // Fetch devices from the Tuya Cloud API
  private async getCloudDevices(): Promise<any[]> {
    try {
      const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
      if (!devicesResponse.success) {
        this.log.error(`Fetching cloud devices failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
        return [];
      }

      return devicesResponse.result.devices.filter((device: any) => device.category === 'cz').map((device: any) => ({
        displayName: device.name,
        deviceId: device.id,
        localKey: device.local_key || null,
        category: device.category,
      }));
    } catch (error) {
      this.log.error('Error fetching cloud devices:', error);
      return [];
    }
  }

  // AES-ECB decryption for UDP messages
  private decryptUDP(msg: Buffer): string {
    const udpkey = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();
    const decipher = crypto.createDecipheriv('aes-128-ecb', udpkey, Buffer.alloc(0));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(msg), decipher.final()]);
    return decrypted.toString();
  }

  // Track power consumption and generate a chart
  async trackPowerConsumption(
    deviceId: string,
    localKey: string,
    powerValueId: string,
    connection: net.Socket,
    interval: number = 10000,
    generateChart: boolean = false,
    duration: number | null | undefined = undefined  // Accept number, null, or undefined
  ) {
    const powerData: number[] = [];
    const timestamps: string[] = [];

    try {
      this.log.info(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}.`);
      connection.write(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}.\n`);

      const localDevices = await this.discoverLocalDevices();
      const selectedDevice = localDevices.find((device) => device.deviceId === deviceId);
      if (!selectedDevice) {
        this.log.error(`Device with ID ${deviceId} not found on the network.`);
        connection.write(`Device with ID ${deviceId} not found on the network.\n`);
        return;
      }
      selectedDevice.localKey = localKey;

      this.log.info(`Discovered and selected device: ${JSON.stringify(selectedDevice)}.`);

      const trackingInterval = setInterval(async () => {
        try {
          const dpsStatus = await this.getLocalDPS(selectedDevice, this.log);
          if (!dpsStatus) {
            this.log.error('Failed to retrieve DPS Status.');
            connection.write('Failed to retrieve DPS Status.\n');
            return;
          }

          if (!dpsStatus.dps.hasOwnProperty(powerValueId)) {
            this.log.error(`PowerValueId ${powerValueId} not found in DPS data.`);
            connection.write(`PowerValueId ${powerValueId} not found in DPS data.\n`);
            return;
          }

          const powerValue = dpsStatus.dps[powerValueId];
          const currentTime = new Date().toLocaleTimeString();

          powerData.push(powerValue);
          timestamps.push(currentTime);

          this.log.info(`Power consumption value for PowerValueId ${powerValueId}: ${powerValue}.`);
          connection.write(`Power consumption for device ${deviceId} (PowerValueId ${powerValueId}): ${powerValue} at ${currentTime}.\n`);
        } catch (error) {
          this.log.error(`Error tracking power consumption for device ${deviceId}: ${error.message}`);
          connection.write(`Error tracking power consumption for device ${deviceId}: ${error.message}\n`);
          clearInterval(trackingInterval);
        }
      }, interval);

      if (duration !== null && duration !== undefined) {
        setTimeout(() => {
          clearInterval(trackingInterval);
          if (generateChart) {
            this.generatePowerConsumptionChart(timestamps, powerData);
          }
        }, duration! * 1000);  // Multiply only if duration is valid
      }
    } catch (error) {
      this.log.error(`Error tracking power consumption for device ${deviceId}: ${error.message}`);
      connection.write(`Error tracking power consumption for device ${deviceId}: ${error.message}\n`);
    }
  }

  // Function to generate a chart with Chart.js
  generatePowerConsumptionChart(timestamps: string[], powerData: number[]) {
    const width = 800;  // Width of the canvas
    const height = 400;  // Height of the canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: timestamps,
        datasets: [{
          label: 'Power Consumption (W)',
          data: powerData,
          fill: false,
          borderColor: 'blue',
          tension: 0.1
        }]
      },
      options: {
        responsive: false,
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Power (W)'
            }
          }
        }
      }
    });

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('./power_consumption_chart.png', buffer);
    this.log.info('Chart saved as power_consumption_chart.png');
  }

  // Method to identify a smart plug using its power value
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