import { Logger } from 'homebridge';
import net from 'net';
import { table } from 'table';
import TuyaOpenMQ from '../core/TuyaOpenMQ';  // Import TuyaOpenMQ

export class SmartPlugService {
  private tuyaMQ: TuyaOpenMQ;  // Declare the TuyaOpenMQ instance

  constructor(private apiInstance: any, private log: Logger) {
    this.tuyaMQ = new TuyaOpenMQ(apiInstance, log);  // Initialize TuyaOpenMQ
    this.tuyaMQ.start();  // Start the MQTT listener
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
      // Use TuyaOpenMQ to listen for MQTT messages
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

      // Use TuyaOpenMQ for MQTT messages
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
}