import { Logger } from 'homebridge';
import net from 'net';
import { table } from 'table';
import TuyaOpenMQ from '../core/TuyaOpenMQ';  // Import TuyaOpenMQ

export class SmartPlugService {
  constructor(private apiInstance: any, private log: Logger, private tuyaMQ: TuyaOpenMQ) {
    // Use the TuyaOpenMQ instance that is passed in from the platform class
  }

  // Method to fetch Smart Plugs
  async getSmartPlugs() {
    try {
      const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
      if (!devicesResponse.success) {
        this.log.error(`Fetching smart plugs failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
        return [];
      }

      return devicesResponse.result?.devices.filter(device => device.category === 'cz').map(device => ({
        displayName: device.name,
        UUID: device.id,
        deviceId: device.id
      }));
    } catch (error) {
      this.log.error(`Error fetching smart plugs: ${error.message}`);
      return [];
    }
  }

  // Method to track power consumption
  async trackPowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket) {
    let currentState: 'inactive' | 'starting' | 'active' | 'ending' = 'inactive';
    let startThreshold: number | null = null;
    let stopThreshold: number | null = null;
    const stableTimeRequired = 10;
    const powerValues: number[] = [];
    const maxPowerValues = 20;

    connection.write('Tracking power consumption...\n');

    try {
      // Use the shared TuyaOpenMQ instance to listen for MQTT messages
      this.tuyaMQ.addMessageListener(async (message: any) => {
        const currentDPS = message?.status?.find((dps: any) => dps.code === powerValueId)?.value / 10;
        if (currentDPS !== undefined) {
          powerValues.push(currentDPS);
          if (powerValues.length > maxPowerValues) {
            powerValues.shift();
          }

          const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;
          connection.write(`Current power: ${averagePower.toFixed(2)} Watt\n`);

          // Dynamic thresholds and state changes
          if (powerValues.length === maxPowerValues) {
            startThreshold = averagePower + Math.max(...powerValues) * 0.2;
            stopThreshold = averagePower * 0.8;

            if (currentState === 'inactive' && currentDPS > startThreshold) {
              currentState = 'active';
              connection.write('Device is now active.\n');
            }

            if (currentState === 'active' && currentDPS < stopThreshold) {
              currentState = 'inactive';
              connection.write('Device is now inactive.\n');
            }
          }
        }
      });
    } catch (error) {
      this.log.error(`Error tracking power consumption: ${error.message}`);
      connection.write(`Error: ${error.message}\n`);
    }
  }

  // Method to calibrate power consumption
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket, washDurationSeconds: number) {
    try {
      connection.write(`Calibration started for ${deviceId}. Duration: ${washDurationSeconds} seconds\n`);

      const activeValues: number[] = [];
      const inactiveMedian = 0;  // Assume no power consumption at the start

      // Use the shared TuyaOpenMQ for MQTT messages
      this.tuyaMQ.addMessageListener(async (message: any) => {
        const currentDPS = message?.status?.find((dps: any) => dps.code === powerValueId)?.value / 10;
        if (currentDPS !== undefined) {
          activeValues.push(currentDPS);
        }
      });

      setTimeout(() => {
        const activeMedian = activeValues.sort((a, b) => a - b)[Math.floor(activeValues.length / 2)];
        const bufferFactor = 0.1;
        const newStartThreshold = inactiveMedian + (activeMedian - inactiveMedian) * (1 - bufferFactor);
        const newStopThreshold = inactiveMedian + (activeMedian - inactiveMedian) * bufferFactor;

        connection.write(`Calibration completed. Start threshold: ${newStartThreshold.toFixed(2)} Watt, Stop threshold: ${newStopThreshold.toFixed(2)} Watt\n`);
      }, washDurationSeconds * 1000);

    } catch (error) {
      this.log.error(`Calibration error: ${error.message}`);
      connection.write(`Calibration error: ${error.message}\n`);
    }
  }

  // Method to identify power value
  async identifyPowerValue(deviceId: string, connection: net.Socket) {
    const log = this.log;
    const existingDPS: { [key: string]: string } = {};

    log.info(`Starting identification for device: ${deviceId}`);

    const response = await this.apiInstance.get(`/v1.0/devices/${deviceId}`);
    if (!response.success) {
      log.error(`Failed to retrieve device ${deviceId}: ${response.msg}`);
      return;
    }

    log.info('Power on your appliance to observe the values.');
    setInterval(async () => {
      const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
      if (!statusResponse.success) {
        log.error(`Error retrieving status: ${statusResponse.msg}`);
        return;
      }

      Object.assign(existingDPS, statusResponse.result);
      const tableData: string[][] = [['Property ID', 'Value']];
      for (const [key, value] of Object.entries(existingDPS)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        tableData.push([key, displayValue]);
      }

      connection.write(table(tableData));
      connection.write('Make sure the plugged-in appliance is consuming power (operating).');
      connection.write('\nOne of the values above will represent power consumption.\n');
    }, 5000);
  }
}