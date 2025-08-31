import TuyAPI from 'tuyapi';
import { Logger } from 'homebridge';
import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';
import { errorMessage } from './errors';

const QuickChart = require('quickchart-js');
const fs = require('fs');

export class SmartPlugService {
  private devicesSeen = new Set<string>();
  private cachedDevices: any[] = [];

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
          issueRefreshOnConnect: true,
          issueRefreshOnPing: true,
          nullPayloadOnJSONError: true
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

        plug.on('error', (error: unknown) => {
          const msg = errorMessage(error);
          log.error(`Error occurred: ${msg}`);
          reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${msg}`));
        });

        plug.on('data', (data) => {
          log.debug(`Data from device: ${JSON.stringify(data)}`);
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
        log.error(`Error retrieving status for device ${device.deviceId}: ${msg}`);
        reject(new Error(`Failed to fetch DPS for device ${device.deviceId}: ${msg}`));
      }
    });
  }

  async discoverLocalDevices(): Promise<any[]> {
    try {
      // Reset seen devices for each discovery run so multiple calls can
      // discover the same devices independently. Without clearing this set,
      // subsequent discovery attempts would return no results because the
      // broadcast messages were cached from previous runs.
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

  async discoverDevices(port: number): Promise<any[]> {
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

  private decryptUDP(msg: Buffer): string {
    const udpkey = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();
    const decipher = crypto.createDecipheriv('aes-128-ecb', udpkey, Buffer.alloc(0));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(msg), decipher.final()]).toString('utf8').trim().replace(/[^\x20-\x7E]/g, '');

    return decrypted;
  }

  calculateInterval(duration: any): number {
    if (duration <= 60) {
      // For durations up to 1 minute, query every 1 second
      return 1000;
    } else if (duration <= 300) {
      // For durations between 1 and 5 minutes, query every 5 seconds
      return 5000;
    } else if (duration <= 1800) {
      // For durations between 5 and 30 minutes, query every 10 seconds
      return 10000;
    } else {
      // For durations longer than 30 minutes, query every 30 seconds
      return 30000;
    }
  }

  // Using quickchart-js for chart generation
  async trackPowerConsumption(
    deviceId: string,
    localKey: string,
    powerValueId: string,
    connection: net.Socket,
    generateChart: boolean,
    duration: number | null | undefined,
    retryCount: number = 3,  // Add retry count
    retryDelay: number = 5000 // Retry delay in milliseconds
  ) {
    const powerData: number[] = [];
    const timestamps: string[] = [];
    let stopTracking = false;
    let retries = 0;

    try {
      this.log.info(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration: ${duration}`);
      connection.write(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration ${duration}\n`);

      let selectedDevice: any = null;  // Use 'any' type or a more specific type if known

      // Retry discovery loop
      while (retries < retryCount) {
        const localDevices = await this.discoverLocalDevices();
        selectedDevice = localDevices.find((device: any) => device.deviceId === deviceId);

        if (selectedDevice) {
          this.log.info(`Device ${deviceId} found on the network.`);
          selectedDevice.localKey = localKey;  // This should now work since selectedDevice is an object
          break;
        } else {
          retries++;
          this.log.warn(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})`);
          connection.write(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})\n`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));  // Wait before retrying
        }
      }


      if (!selectedDevice) {
        this.log.error(`Device with ID ${deviceId} not found after ${retryCount} attempts.`);
        connection.write(`Device with ID ${deviceId} not found after ${retryCount} attempts.\n`);
        return;
      }

      const trackingInterval = setInterval(async () => {
        if (stopTracking) return;

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
          const msg = errorMessage(error);
          this.log.error(`Error tracking power consumption for device ${deviceId}: ${msg}`);
          connection.write(`Error tracking power consumption for device ${deviceId}: ${msg}\n`);
          clearInterval(trackingInterval);
        }
      }, this.calculateInterval(duration));

      if (duration !== null && duration !== undefined) {
        setTimeout(() => {
          stopTracking = true;
          clearInterval(trackingInterval);
          this.log.info(`Stopped tracking power consumption for device ${deviceId} after ${duration} seconds.`);
          if (generateChart) {
            this.generatePowerConsumptionChart(timestamps, powerData, duration);
            connection.write('Power consumption chart generated.\n');
          }
        }, duration * 1000);
      }
    } catch (error) {
      const msg = errorMessage(error);
      this.log.error(`Error tracking power consumption for device ${deviceId}: ${msg}`);
      connection.write(`Error tracking power consumption for device ${deviceId}: ${msg}\n`);
    }
  }

  generatePowerConsumptionChart(timestamps: string[], powerData: number[], duration: number) {
    this.log.info('Generating power consumption chart...');

    // Dynamically adjust chart size based on duration without limiting the maximum size
    const chartWidth = Math.max(600, duration * 10);  // Set a width proportional to duration
    const chartHeight = Math.max(300, duration * 5); // Set a height proportional to duration

    this.log.debug(`Setting chart size: width=${chartWidth}, height=${chartHeight}`);

    // Instantiate QuickChart object
    const chart = new QuickChart();

    // Set dynamic chart size based on tracking duration
    chart.setWidth(chartWidth);  // Dynamically adjust width
    chart.setHeight(chartHeight);  // Dynamically adjust height

    // Build chart data
    chart.setConfig({
      type: 'line',
      data: {
        labels: timestamps,
        datasets: [
          {
            label: 'Power Consumption (Watts)',
            data: powerData,
            fill: false,
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(75, 192, 192, 1)',
          },
        ],
      },
      options: {
        responsive: true,
        title: {
          display: true,
          text: 'Power Consumption Over Time',
        },
        tooltips: {
          enabled: true,
          callbacks: {
            label: function (tooltipItem: any) {
              return `Power: ${tooltipItem.yLabel} W`;
            },
          },
        },
        scales: {
          xAxes: [
            {
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Time',
              },
            },
          ],
          yAxes: [
            {
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Power (Watts)',
              },
            },
          ],
        },
        plugins: {
          datalabels: {
            display: true,
            align: 'top',
            backgroundColor: 'rgba(75, 192, 192, 0.8)',
            borderRadius: 3,
            color: 'white',
            font: {
              size: 6,
              weight: 'bold',
            },
            formatter: function (value: any) {
              return `${value} W`; // Format the label to show power in Watts
            },
          },
        },
      },
    });
  }
}