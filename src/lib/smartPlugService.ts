import { Logger } from 'homebridge';
import net from 'net';

export class SmartPlugService {
  constructor(private apiInstance: any, private log: Logger) {}

  // Methode zum Abrufen der Smart Plugs
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
        deviceId: device.id,
        deviceKey: device.local_key
      }));
    } catch (error) {
      this.log.error(`Error fetching smart plugs: ${error.message}`);
      return [];
    }
  }

  // Methode zur Verfolgung des Stromverbrauchs
  async trackPowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket) {
    let currentState: 'inactive' | 'starting' | 'active' | 'ending' = 'inactive';
    let startThreshold: number | null = null;
    let stopThreshold: number | null = null;
    const stableTimeRequired = 10;
    const stateChangeTime: any = null;
    const powerValues: number[] = [];
    const maxPowerValues = 20;

    connection.write('Tracking power consumption...\n');

    try {
      this.apiInstance.subscribeToMQTTMessages(async (message: any) => {
        const currentDPS = message?.status?.find((dps: any) => dps.code === powerValueId)?.value / 10;
        if (currentDPS !== undefined) {
          powerValues.push(currentDPS);
          if (powerValues.length > maxPowerValues) {
            powerValues.shift();
          }

          const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;
          connection.write(`Current power: ${averagePower.toFixed(2)} Watt\n`);

          // Dynamische Schwellenwerte und Statusänderungen
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

  // Methode zur Kalibrierung des Stromverbrauchs
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection: net.Socket, washDurationSeconds: number = 600) {
    try {
      connection.write(`Calibration started for ${deviceId}. Duration: ${washDurationSeconds} seconds\n`);

      const activeValues: number[] = [];
      const inactiveMedian = 0;  // Annahme: kein Stromverbrauch zu Beginn

      this.apiInstance.subscribeToMQTTMessages(async (message: any) => {
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