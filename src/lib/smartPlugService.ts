import { Logger } from 'homebridge';
import net from 'net';
import { table } from 'table';
import TuyaOpenMQ, { TuyaMQTTProtocol } from '../core/TuyaOpenMQ';  // Import TuyaOpenMQ

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

  // Method to calibrate power consumption
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket, washDurationSeconds: number) {
    try {
      connection.write(`Calibration started for ${deviceId}. Duration: ${washDurationSeconds} seconds\n`);

      const activeValues: number[] = [];
      const inactiveMedian = 0;  // Assume no power consumption at the start

      // Use the TuyaOpenMQ instance to listen for MQTT messages
      this.tuyaMQ.addMessageListener((topic: string, protocol: TuyaMQTTProtocol, message: any) => {
        if (protocol === TuyaMQTTProtocol.DEVICE_STATUS_UPDATE) {
          const { devId, status } = message;
          if (devId === deviceId) {
            const currentDPS = status.find((property) => property.code === powerValueId)?.value / 10;
            if (currentDPS !== undefined) {
              activeValues.push(currentDPS);
              this.log.debug(`Calibration data received. Current DPS: ${currentDPS}`);
            }
          }
        }
      });

      // Wait for the washing duration to complete
      setTimeout(() => {
        if (activeValues.length === 0) {
          connection.write(`No power values received for calibration.\n`);
          return;
        }

        const activeMedian = activeValues.sort((a, b) => a - b)[Math.floor(activeValues.length / 2)];
        const bufferFactor = 0.1;
        const newStartThreshold = inactiveMedian + (activeMedian - inactiveMedian) * (1 - bufferFactor);
        const newStopThreshold = inactiveMedian + (activeMedian - inactiveMedian) * bufferFactor;

        connection.write(`Calibration completed. Start threshold: ${newStartThreshold.toFixed(2)} Watt, Stop threshold: ${newStopThreshold.toFixed(2)} Watt\n`);
        this.log.info(`Calibration completed for device ${deviceId}: Start threshold: ${newStartThreshold}, Stop threshold: ${newStopThreshold}`);
      }, washDurationSeconds * 1000);

    } catch (error) {
      this.log.error(`Calibration error for device ${deviceId}: ${error.message}`);
      connection.write(`Calibration error: ${error.message}\n`);
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
      // Use the TuyaOpenMQ instance to listen for MQTT messages
      this.tuyaMQ.addMessageListener((topic: string, protocol: TuyaMQTTProtocol, message: any) => {
        // Filter only relevant messages
        if (protocol === TuyaMQTTProtocol.DEVICE_STATUS_UPDATE) {
          const { devId, status } = message;

          // Ensure the message is for the correct device
          if (devId === deviceId) {

            connection.write(`Raw MQTT message: ${status}`);

            const currentDPS = status.find((property) => property.code === powerValueId)?.value / 10;

            // Check if currentDPS is undefined or NaN
            if (currentDPS === undefined || isNaN(currentDPS)) {
              connection.write(`Invalid power value received: ${currentDPS}. Skipping this entry.\n`);
              return;
            }

            connection.write(`Raw power value (DPS): ${status.find((property) => property.code === powerValueId)?.value}`);
            connection.write(`Received DPS: ${currentDPS.toFixed(2)} Watt\n`);

            // Add the valid power value to the list
            powerValues.push(currentDPS);
            if (powerValues.length > maxPowerValues) {
              powerValues.shift();  // Remove oldest values
            }

            // Calculate average power consumption
            const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;

            // Debugging: Log the calculated average power
            connection.write(`Power values: ${powerValues}`);
            connection.write(`Calculated average power: ${averagePower.toFixed(2)} Watt\n`);

            // Dynamic thresholds and state changes
            if (powerValues.length === maxPowerValues) {
              startThreshold = averagePower + Math.max(...powerValues) * 0.2;
              stopThreshold = averagePower * 0.8;

              connection.write(`Start threshold: ${startThreshold}, Stop threshold: ${stopThreshold}`);

              if (currentState === 'inactive' && currentDPS > startThreshold) {
                currentState = 'active';
                connection.write('Device is now active.\n');
              }

              if (currentState === 'active' && currentDPS < stopThreshold) {
                currentState = 'inactive';
                connection.write('Device is now inactive.\n');
              }
            }
          } else {
            this.log.warn(`Received data for a different device. Expected: ${deviceId}, Received: ${devId}`);
          }
        }
      });
    } catch (error) {
      connection.write(`Error tracking power consumption: ${error.message}\n`);
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