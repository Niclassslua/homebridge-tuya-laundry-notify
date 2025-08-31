import { Logger } from 'homebridge';
import net from 'net';
import { DeviceManager } from './deviceManager';
import { errorMessage } from './errors';

const QuickChart = require('quickchart-js');

class Color {
  static reset = '\x1b[0m';
  static red = '\x1b[31m';
  static green = '\x1b[32m';
  static yellow = '\x1b[33m';
  static blue = '\x1b[34m';
  static magenta = '\x1b[35m';
  static cyan = '\x1b[36m';

  static colorize(text: string, color: string): string {
    return `${color}${text}${this.reset}`;
  }

  static info(text: string): string {
    return this.colorize(text, this.cyan);
  }

  static success(text: string): string {
    return this.colorize(text, this.green);
  }

  static warning(text: string): string {
    return this.colorize(text, this.yellow);
  }

  static error(text: string): string {
    return this.colorize(text, this.red);
  }
}

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
    const averagePower = this.powerValues.reduce((sum, val) => sum + val, 0) / this.powerValues.length;
    const stdDev = Math.sqrt(
      this.powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) /
        this.powerValues.length
    );
    this.startThreshold = averagePower + stdDev * 2;
    this.stopThreshold = averagePower + stdDev;
    this.log.info(Color.info(`New thresholds: Start ${this.startThreshold}, Stop ${this.stopThreshold}`));
  }

  async generatePowerConsumptionChart(timestamps: string[], powerData: number[], duration: number) {
    this.log.info(Color.info('Generating power consumption chart with sliding window...'));
  
    const chartWidth = Math.max(600, duration * 10);
    const chartHeight = Math.max(300, duration * 5);
  
    this.log.debug(Color.info(`Setting chart size: width=${chartWidth}, height=${chartHeight}`));
  
    const chart = new QuickChart();
    chart.setWidth(chartWidth);
    chart.setHeight(chartHeight);
  
    const windowSize = Math.min(powerData.length, 100);
    const displayedPowerData = powerData.slice(-windowSize);
    const displayedTimestamps = timestamps.slice(-windowSize);
  
    chart.setConfig({
      type: 'line',
      data: {
        labels: displayedTimestamps,
        datasets: [
          {
            label: 'Power Consumption (Watts)',
            data: displayedPowerData,
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
          text: 'Power Consumption Over Time (Sliding Window)',
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
  
    this.log.debug(Color.info(`Displaying last ${windowSize} data points in chart`));
  
    // Verwenden Sie die POST-Methode mit `getShortUrl`
    try {
      const shortUrl = await chart.getShortUrl(); // Hier await verwenden
      this.log.info(Color.success(`Shortened Chart URL: ${shortUrl}`));
      return shortUrl;
    } catch (error) {
      this.log.error(Color.error(`Error generating shortened chart URL: ${errorMessage(error)}`));
      return null;
    }
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
      this.log.info(Color.info(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration: ${duration}`));
      connection.write(Color.info(`Starting to track power consumption for device ${deviceId} with PowerValueId ${powerValueId}. Will generate chart: ${generateChart} for duration ${duration}\n`));
  
      let selectedDevice: any = null;
  
      while (retries < retryCount) {
        const localDevices = await this.deviceManager.discoverLocalDevices();
        selectedDevice = localDevices.find((device: any) => device.deviceId === deviceId);
  
        if (selectedDevice) {
          this.log.info(Color.success(`Device ${deviceId} found on the network.`));
          selectedDevice.localKey = localKey;
          break;
        } else {
          retries++;
          this.log.warn(Color.warning(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})`));
          connection.write(Color.warning(`Device with ID ${deviceId} not found, retrying... (${retries}/${retryCount})\n`));
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
  
      if (!selectedDevice) {
        this.log.error(Color.error(`Device with ID ${deviceId} not found after ${retryCount} attempts.`));
        connection.write(Color.error(`Device with ID ${deviceId} not found after ${retryCount} attempts.\n`));
        return;
      }
  
      const trackingInterval = setInterval(async () => {
        if (stopTracking) return;
  
        try {
          const dpsStatus = await this.deviceManager.getLocalDPS(selectedDevice);
          if (!dpsStatus) {
            this.log.error(Color.error('Failed to retrieve DPS Status.'));
            connection.write(Color.error('Failed to retrieve DPS Status.\n'));
            return;
          }
  
          if (!dpsStatus.dps.hasOwnProperty(powerValueId)) {
            this.log.error(Color.error(`PowerValueId ${powerValueId} not found in DPS data.`));
            connection.write(Color.error(`PowerValueId ${powerValueId} not found in DPS data.\n`));
            return;
          }
  
          const powerValue = dpsStatus.dps[powerValueId];
          const currentTime = new Date().toLocaleTimeString();
          powerData.push(powerValue);
          timestamps.push(currentTime);
  
          this.log.info(Color.info(`Power consumption value for PowerValueId ${powerValueId}: ${powerValue}.`));
          connection.write(Color.info(`Power consumption for device ${deviceId} (PowerValueId ${powerValueId}): ${powerValue} at ${currentTime}.\n`));
        } catch (error) {
          const msg = errorMessage(error);
          this.log.error(Color.error(`Error tracking power consumption for device ${deviceId}: ${msg}`));
          connection.write(Color.error(`Error tracking power consumption for device ${deviceId}: ${msg}\n`));
          clearInterval(trackingInterval);
        }
      }, this.calculateInterval(duration));
  
      if (duration !== null && duration !== undefined) {
        setTimeout(async () => {
          stopTracking = true;
          clearInterval(trackingInterval);
          this.log.info(Color.info(`Stopped tracking power consumption for device ${deviceId} after ${duration} seconds.`));
          if (generateChart) {
            const chartUrl = await this.generatePowerConsumptionChart(timestamps, powerData, duration); // await hinzufügen
            connection.write(Color.success(`Power consumption chart generated. View it here: ${chartUrl}\n`));
          }
        }, duration * 1000);
      }
    } catch (error) {
      const msg = errorMessage(error);
      this.log.error(Color.error(`Error tracking power consumption for device ${deviceId}: ${msg}`));
      connection.write(Color.error(`Error tracking power consumption for device ${deviceId}: ${msg}\n`));
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