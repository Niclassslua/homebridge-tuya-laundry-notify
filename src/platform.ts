import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MessageGateway } from './lib/messageGateway';
import TuyaOpenAPI from './core/TuyaOpenAPI';

import fs from 'fs';
import path from 'path';
import { table } from 'table';
import { DateTime } from 'luxon'; // Import Luxon for timestamps
import net from 'net';
import os from 'os';

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  private apiInstance!: TuyaOpenAPI;
  private tokenInfo = { access_token: '', refresh_token: '', expire: 0 };

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialized.');
    this.typedConfig = config as PlatformConfig & NotifyConfig;

    const { accessId, accessKey, endpoint, countryCode, username, password, appSchema } = this.typedConfig;

    const effectiveEndpoint = endpoint ?? 'https://openapi.tuyaeu.com';

    if (!accessId || !accessKey || !effectiveEndpoint) {
      throw new Error('Access ID, Access Key, and Endpoint must be specified in the configuration.');
    }

    this.log.info(`Credentials: accessId=${accessId}, accessKey=${accessKey}, endpoint=${effectiveEndpoint}`);

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');
      this.startIPCServer();  // Start IPC server
    });
  }

  // Modified calibration function with custom wash cycle duration
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection?: net.Socket, washDurationSeconds = 600) {
    const writeToConnection = (message: string) => {
      if (connection) {
        connection.write(message + '\n');
      } else {
        console.log(message);
      }
    };

    writeToConnection(`Calibration mode started. Washing cycle duration is set to ${washDurationSeconds} seconds.`);
    writeToConnection('Please start the appliance and let it run. Press Enter when the appliance is active.');

    connection?.once('data', async () => {
      const activeValues: number[] = [];
      writeToConnection('Collecting data for active state...');
      const activeSampleTime = Date.now() + washDurationSeconds * 1000;

      while (Date.now() < activeSampleTime) {
        const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
        const currentDPS = (statusResponse.result.find((dps: any) => dps.code === powerValueId)?.value) / 10;
        if (currentDPS !== undefined) {
          activeValues.push(currentDPS);
          writeToConnection(`Active power value: ${currentDPS} Watt`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Sample every 2 seconds
      }

      writeToConnection('Please turn off the appliance now. Press Enter when the appliance is inactive.');

      connection?.once('data', async () => {
        const inactiveValues: number[] = [];
        writeToConnection('Collecting data for inactive state...');
        const inactiveSampleTime = Date.now() + washDurationSeconds * 1000;

        while (Date.now() < inactiveSampleTime) {
          const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
          const currentDPS = (statusResponse.result.find((dps: any) => dps.code === powerValueId)?.value) / 10;
          if (currentDPS !== undefined) {
            inactiveValues.push(currentDPS);
            writeToConnection(`Inactive power value: ${currentDPS} Watt`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000)); // Sample every 2 seconds
        }

        const activeMedian = activeValues.sort((a, b) => a - b)[Math.floor(activeValues.length / 2)];
        const inactiveMedian = inactiveValues.sort((a, b) => a - b)[Math.floor(inactiveValues.length / 2)];

        // Apply a buffer to better separate the active and inactive thresholds
        const bufferFactor = 0.1; // 10% buffer

        const newStartThreshold = inactiveMedian + (activeMedian - inactiveMedian) * (1 - bufferFactor); // Closer to active state
        const newStopThreshold = inactiveMedian + (activeMedian - inactiveMedian) * bufferFactor; // Closer to inactive state

        writeToConnection('Calibration completed.');
        writeToConnection(`New start threshold: ${newStartThreshold.toFixed(2)} Watt`);
        writeToConnection(`New stop threshold: ${newStopThreshold.toFixed(2)} Watt`);
      });
    });
  }

  async getSmartPlugs() {
    this.log.info('Fetching Tuya smart plugs...');
    const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
    if (!devicesResponse.success) {
      this.log.error(`Fetching smart plugs failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
      return [];
    }

    const deviceList = devicesResponse.result?.devices ?? [];

    return deviceList.filter(device => device.category === 'cz').map(device => ({
      displayName: device.name,
      UUID: device.id,
      deviceId: device.id,
      deviceKey: device.local_key
    }));
  }

  async trackPowerConsumption(deviceId: string, deviceKey: string, powerValueId: string, margin?: number, connection?: net.Socket) {
    let currentState: 'inactive' | 'starting' | 'active' | 'ending' = 'inactive';
    let startThreshold: number | null = null;
    let stopThreshold: number | null = null;
    const stableTimeRequired = 10;
    let stateChangeTime: DateTime | null = null;
    const powerValues: number[] = [];
    const maxPowerValues = 20;
    const hysteresisFactor = 0.2;

    const writeToConnection = (message: string) => {
      if (connection) {
        connection.write(message + '\n');
      } else {
        console.log(message);
      }
    };

    writeToConnection(`Starting power consumption tracking for device ID: ${deviceId}, PowerValueID: ${powerValueId}`);

    setInterval(async () => {
      try {
        const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
        if (!statusResponse.success) {
          writeToConnection(`Error retrieving status: ${statusResponse.msg} (Code: ${statusResponse.code})`);
          return;
        }

        const allDPS = statusResponse.result;
        const currentDPS = (allDPS.find((dps: any) => dps.code === powerValueId)?.value) / 10;

        if (currentDPS !== undefined) {
          writeToConnection(`Current power value: ${currentDPS} Watt`);

          powerValues.push(currentDPS);
          if (powerValues.length > maxPowerValues) {
            powerValues.shift();
          }

          const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;
          const variance = powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) / powerValues.length;
          const stdDev = Math.sqrt(variance);

          writeToConnection(`Average consumption: ${averagePower.toFixed(2)} Watt, Standard deviation: ${stdDev.toFixed(2)} Watt`);

          if (powerValues.length === maxPowerValues) {
            startThreshold = averagePower + stdDev * 2;
            stopThreshold = averagePower + stdDev;

            writeToConnection(`Dynamic start threshold: ${startThreshold.toFixed(2)} Watt`);
            writeToConnection(`Dynamic stop threshold: ${stopThreshold.toFixed(2)} Watt`);
          }

          switch (currentState) {
            case 'inactive':
              if (startThreshold !== null && currentDPS > startThreshold) {
                if (!stateChangeTime) {
                  stateChangeTime = DateTime.now();
                  writeToConnection('Increase detected, starting wait period...');
                } else {
                  const duration = DateTime.now().diff(stateChangeTime, 'seconds').seconds;
                  if (duration >= stableTimeRequired) {
                    currentState = 'active';
                    writeToConnection('Device is now active.');
                    stateChangeTime = null;
                  }
                }
              } else {
                stateChangeTime = null;
              }
              break;

            case 'active':
              if (stopThreshold !== null && currentDPS < stopThreshold) {
                if (!stateChangeTime) {
                  stateChangeTime = DateTime.now();
                  writeToConnection('Decrease detected, starting wait period...');
                } else {
                  const duration = DateTime.now().diff(stateChangeTime, 'seconds').seconds;
                  if (duration >= stableTimeRequired) {
                    currentState = 'inactive';
                    writeToConnection('Device is now inactive.');
                    stateChangeTime = null;
                  }
                }
              } else {
                stateChangeTime = null;
              }
              break;
          }
        } else {
          writeToConnection('Unable to retrieve current power value.');
        }
      } catch (error) {
        writeToConnection(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 5000);
  }

  async identifyPowerValue(deviceId: string, deviceKey: string, connection: net.Socket) {
    const log = this.log;
    const config = { id: deviceId, key: deviceKey, name: 'Smart Plug' };
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
      connection.write('Make sure plugged in appliance is consuming power (operating).');
      connection.write('\nOne of the values above will represent power consumption.\n');
    }, 5000);
  }

  private startIPCServer() {
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');
    this.log.info(`Starting IPC server at ${socketPath}`);

    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((connection) => {
      this.log.info('Connection received via IPC server');
      connection.write('> ');

      connection.setEncoding('utf8');

      let selectedCommand = ''; // Variable for the current command
      let selectedPlug: any = null; // The selected device
      let smartPlugsCache: any[] = []; // Cache for smart plugs

      connection.on('data', async (data: string | Buffer) => {
        const input = data.toString().trim();

        // If the input is empty (i.e., Enter key was pressed), we skip any further command checks
        if (input === '') {
          this.log.info('Empty input received, proceeding to the next step if applicable.');
          return; // Skip processing unknown command and let calibration continue
        }

        this.log.info(`Command received via IPC: "${input}"`);

        // Combined flow with list-smartplugs before identify, track, or calibrate
        if (input === 'identify' || input === 'track' || input === 'calibrate') {
          selectedCommand = input;

          // First, list the smart plugs
          const smartPlugs = await this.getSmartPlugs();

          if (smartPlugs.length === 0) {
            connection.write('No smart plugs found.\n');
            connection.end();
            return;
          }

          smartPlugsCache = smartPlugs; // Store smart plugs in cache
          let response = 'Available smart plugs:\n';
          smartPlugs.forEach((plug, index) => {
            response += `${index + 1}: Name: ${plug.displayName}, UUID: ${plug.UUID}\n`;
          });

          connection.write(response + 'Select the device number: \n');
        } else if (selectedCommand && /^\d+$/.test(input) && selectedCommand !== 'awaitingWashDuration') {
          // Check if the input is a number and a smart plug is selected
          const index = parseInt(input, 10) - 1;
          if (index >= 0 && index < smartPlugsCache.length) {
            selectedPlug = smartPlugsCache[index];

            if (selectedCommand === 'identify') {
              await this.identifyPowerValue(selectedPlug.deviceId, selectedPlug.deviceKey, connection);
              selectedCommand = ''; // Reset command
            } else if (selectedCommand === 'track') {
              connection.write('Please enter the PowerValueID: \n');
              selectedCommand = 'awaitingPowerValueId'; // Set the state to PowerValueID query
            } else if (selectedCommand === 'calibrate') {
              // Now we correctly move to the 'awaitingWashDuration' state
              connection.write('Please enter the washing cycle duration in seconds: \n');
              selectedCommand = 'awaitingWashDuration'; // Awaiting wash duration input
            }
          } else {
            connection.write('Invalid selection.\n');
          }
        } else if (selectedCommand === 'awaitingWashDuration') {
          // Handle wash duration input and start calibration
          const washDurationSeconds = parseInt(input, 10);
          if (isNaN(washDurationSeconds) || washDurationSeconds <= 0) {
            connection.write('Invalid duration. Please enter a valid number of seconds.\n');
          } else {
            await this.calibratePowerConsumption(selectedPlug.deviceId, 'cur_power', connection, washDurationSeconds);
            selectedCommand = ''; // Reset command after calibration
          }
        } else if (selectedCommand === 'awaitingPowerValueId') {
          // Process the PowerValueID after selecting the device
          const powerValueId = input;
          if (selectedPlug) {
            await this.trackPowerConsumption(selectedPlug.deviceId, selectedPlug.deviceKey, powerValueId, undefined, connection);
            selectedCommand = ''; // Reset command
          } else {
            connection.write('No valid device selected.\n');
          }
        } else {
          connection.write('Unknown command\n');
        }
      });
    });

    server.listen(socketPath, () => {
      this.log.info(`IPC server listening at ${socketPath}`);
    });

    server.on('error', (err: Error) => {
      this.log.error(`Error with IPC server: ${err.message}`);
    });
  }
}