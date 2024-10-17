// powerConsumptionTracker.ts
import { Logger } from 'homebridge';
import net from 'net';
import { DeviceManager } from './deviceManager';
const QuickChart = require('quickchart-js');

export class PowerConsumptionTracker {
  private powerValues: number[] = [];
  private startThreshold: number | null = null;
  private stopThreshold: number | null = null;

  constructor(
    private deviceManager: DeviceManager,
    private log: Logger
  ) {}

  trackPower(currentDPS: number) {
    this.powerValues.push(currentDPS);
    if (this.powerValues.length > 20) {
      this.powerValues.shift();
    }
    this.calculateThresholds();
  }

  private calculateThresholds() {
    const averagePower =
      this.powerValues.reduce((sum, val) => sum + val, 0) / this.powerValues.length;
    const stdDev = Math.sqrt(
      this.powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) /
        this.powerValues.length
    );
    this.startThreshold = averagePower + stdDev * 2;
    this.stopThreshold = averagePower + stdDev;
    this.log.info(`New thresholds: Start ${this.startThreshold}, Stop ${this.stopThreshold}`);
  }

  generatePowerConsumptionChart(timestamps: string[], powerData: number[], duration: number) {
    this.log.info('Generating power consumption chart...');

    const chartWidth = Math.max(600, duration * 10);
    const chartHeight = Math.max(300, duration * 5);

    this.log.debug(`Setting chart size: width=${chartWidth}, height=${chartHeight}`);

    const chart = new QuickChart();

    chart.setWidth(chartWidth);
    chart.setHeight(chartHeight);

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
              return `${value} W`;
            },
          },
        },
      },
    });
  }

  async trackPowerConsumption(
    deviceId: string,
    localKey: string,
    powerValueId: string,
    connection: net.Socket,
    generateChart: boolean,
    duration: number | null | undefined,
    retryCount: number = 3,
    retryDelay: number = 5000
  ) {
    const powerData: number[] = [];
    const timestamps: string[] = [];
    let stopTracking = false;
    let retries = 0;

    try {
      this.log.info(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration: ${duration}`);
      connection.write(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration ${duration}\n`);

      let selectedDevice: any = null;

      while (retries < retryCount) {
        const localDevices = await this.deviceManager.discoverLocalDevices();
        selectedDevice = localDevices.find((device: any) => device.deviceId === deviceId);

        if (selectedDevice) {
          this.log.info(`Device ${deviceId} found on the network.`);
          selectedDevice.localKey = localKey;
          break;
        } else {
          retries++;
          this.log.warn(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})`);
          connection.write(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})\n`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
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
          const dpsStatus = await this.deviceManager.getLocalDPS(selectedDevice);
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
      this.log.error(`Error tracking power consumption for device ${deviceId}: ${error.message}`);
      connection.write(`Error tracking power consumption for device ${deviceId}: ${error.message}\n`);
    }
  }

  calculateInterval(duration: any): number {
    if (duration <= 60) {
      return 1000;
    } else if (duration <= 300) {
      return 5000;
    } else if (duration <= 1800) {
      return 10000;
    } else {
      return 30000;
    }
  }
}