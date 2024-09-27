import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import TuyaOpenAPI, { LOGIN_ERROR_MESSAGES } from './core/TuyaOpenAPI';
import { LaundryDeviceTracker } from './lib/laundryDeviceTracker';
import { MessageGateway } from './lib/messageGateway';
import TuyaOpenMQ from './core/TuyaOpenMQ';
import { MQTTHandler } from './lib/mqttHandler';  // Import the MQTTHandler

import fs from 'fs';
import path from 'path';
import { table } from 'table';
import { DateTime } from 'luxon';
import net from 'net';
import os from 'os';

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly laundryDevices: LaundryDeviceTracker[] = [];
  private apiInstance!: TuyaOpenAPI;
  private mq!: TuyaOpenMQ;  // Declare the 'mq' property
  private mqttHandler!: MQTTHandler;  // Declare the MQTTHandler property

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

    this.apiInstance = new TuyaOpenAPI(effectiveEndpoint, accessId, accessKey, this.log, 'en', false);

    const messageGateway = new MessageGateway(log, this.typedConfig, api);

    // Initialize laundry devices
    if (this.typedConfig.laundryDevices) {
      for (const laundryDevice of this.typedConfig.laundryDevices) {
        this.laundryDevices.push(new LaundryDeviceTracker(log, messageGateway, laundryDevice, api, this.apiInstance));
      }
    }

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge has started, beginning initialization.');
      await this.connect();
      this.startIPCServer();  // Start IPC server for power monitoring
    });
  }

  private async connect() {
    this.log.info('Connecting to Tuya Cloud...');
    const { accessId, accessKey, countryCode, username, password, appSchema, endpoint } = this.typedConfig;

    const effectiveCountryCode = Number(countryCode ?? '49');
    const effectiveUsername = username ?? '';
    const effectivePassword = password ?? '';
    const effectiveAppSchema = appSchema ?? 'tuyaSmart';

    // Login to Tuya API
    const res = await this.apiInstance.homeLogin(effectiveCountryCode, effectiveUsername, effectivePassword, effectiveAppSchema);
    if (!res.success) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      if (LOGIN_ERROR_MESSAGES[res.code]) {
        this.log.error(LOGIN_ERROR_MESSAGES[res.code]);
      }
      setTimeout(() => this.connect(), 5000);
      return;
    }

    // Initialize MQTT for message handling
    this.mq = new TuyaOpenMQ(this.apiInstance, this.log);

    // Use the encapsulated MQTTHandler to listen for messages
    this.initializeMQTTListeners();

    this.log.info('Connecting to Laundry Devices...');
    for (const laundryDevice of this.laundryDevices) {
      try {
        const uuid = this.api.hap.uuid.generate(laundryDevice.config.name);
        const cachedAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
        if (laundryDevice.config.exposeStateSwitch) {
          if (!cachedAccessory) {
            laundryDevice.accessory = new this.api.platformAccessory(laundryDevice.config.name, uuid);
            laundryDevice.accessory.addService(this.api.hap.Service.Switch, laundryDevice.config.name);
            this.accessories.push(laundryDevice.accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [laundryDevice.accessory]);
          } else {
            laundryDevice.accessory = cachedAccessory;
          }
        }
        await laundryDevice.init();
      } catch (error) {
        this.log.error(`Failed to init ${laundryDevice.config.name}`, error);
      }
    }

    this.log.info('Starting MQTT...');
    this.mq.start();
  }

  private initializeMQTTListeners() {
    // Create a new instance of the MQTTHandler and start listening for messages
    this.mqttHandler = new MQTTHandler(this.log, this.mq);
    this.mqttHandler.startListening();
  }

  // Helper method to check if a string is valid JSON
  private isValidJson(message: string): boolean {
    try {
      JSON.parse(message);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Function to handle power consumption calibration
  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection?: net.Socket, washDurationSeconds = 600) {
    const writeToConnection = (message: string) => {
      if (connection) {
        connection.write(message + '\n');
      } else {
        console.log(message);
      }
    };

    writeToConnection(`Calibration mode started. Washing cycle duration is set to ${washDurationSeconds} seconds.`);
    writeToConnection('Please start the appliance and let it run. Waiting for MQTT updates...');

    // Instead of polling, wait for MQTT message indicating start
    this.mq.addMessageListener(async (message) => {
      if (this.isValidJson(message)) {
        const parsedMessage = JSON.parse(message); // Parse the string into an object
        const { deviceId: msgDeviceId, status } = parsedMessage; // Destructure the parsed object

        if (msgDeviceId === deviceId) {
          const currentDPS = status.find((dps: any) => dps.code === powerValueId)?.value / 10;
          if (currentDPS !== undefined) {
            writeToConnection(`Real-time power value: ${currentDPS} Watt`);

            const activeValues: number[] = [];
            activeValues.push(currentDPS);

            // After receiving real-time data, compute calibration values and thresholds
            if (activeValues.length > 0) {
              const activeMedian = activeValues.sort((a, b) => a - b)[Math.floor(activeValues.length / 2)];
              const bufferFactor = 0.1;
              const inactiveMedian = 0; // Assume no power consumption initially

              const newStartThreshold = inactiveMedian + (activeMedian - inactiveMedian) * (1 - bufferFactor);
              const newStopThreshold = inactiveMedian + (activeMedian - inactiveMedian) * bufferFactor;

              writeToConnection('Calibration completed.');
              writeToConnection(`New start threshold: ${newStartThreshold.toFixed(2)} Watt`);
              writeToConnection(`New stop threshold: ${newStopThreshold.toFixed(2)} Watt`);
            }
          }
        }
      }
    });
  }

  // Additional code for smart plug fetching and tracking
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

    // Use MQTT for real-time tracking instead of polling
    this.mq.addMessageListener((message) => {
      try {
        if (this.isValidJson(message)) {
          const parsedMessage = JSON.parse(message); // Parse the string into an object
          const { deviceId: msgDeviceId, status } = parsedMessage; // Destructure the parsed object

          if (msgDeviceId === deviceId) {
            const currentDPS = status.find((dps: any) => dps.code === powerValueId)?.value / 10;

            if (currentDPS !== undefined) {
              writeToConnection(`Real-time power value: ${currentDPS} Watt`);

              powerValues.push(currentDPS);
              if (powerValues.length > maxPowerValues) {
                powerValues.shift();
              }

              const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;
              const stdDev = Math.sqrt(powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) / powerValues.length);

              writeToConnection(`Average consumption: ${averagePower.toFixed(2)} Watt, Standard deviation: ${stdDev.toFixed(2)} Watt`);

              // Set dynamic thresholds based on real-time data
              if (powerValues.length === maxPowerValues) {
                startThreshold = averagePower + stdDev * 2;
                stopThreshold = averagePower + stdDev;

                writeToConnection(`Dynamic start threshold: ${startThreshold.toFixed(2)} Watt`);
                writeToConnection(`Dynamic stop threshold: ${stopThreshold.toFixed(2)} Watt`);
              }

              // Handle state changes based on the real-time power consumption
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
            }
          }
        } else {
          this.log.warn(`Received non-JSON MQTT message: ${message}`);
        }
      } catch (error) {
        this.log.error('Failed to process MQTT message', error);
      }
    });
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

  // Start the IPC server to communicate with external connections for the platform
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

      let selectedCommand = '';
      let selectedPlug: any = null;
      let smartPlugsCache: any[] = [];

      connection.on('data', async (data: string | Buffer) => {
        const input = data.toString().trim();

        if (input === '') {
          this.log.info('Empty input received, proceeding to the next step if applicable.');
          return;
        }

        this.log.info(`Command received via IPC: "${input}"`);

        if (input === 'identify' || input === 'track' || input === 'calibrate') {
          selectedCommand = input;

          const smartPlugs = await this.getSmartPlugs();

          if (smartPlugs.length === 0) {
            connection.write('No smart plugs found.\n');
            connection.end();
            return;
          }

          smartPlugsCache = smartPlugs;
          let response = 'Available smart plugs:\n';
          smartPlugs.forEach((plug, index) => {
            response += `${index + 1}: Name: ${plug.displayName}, UUID: ${plug.UUID}\n`;
          });

          connection.write(response + 'Select the device number: \n');
        } else if (selectedCommand && /^\d+$/.test(input) && selectedCommand !== 'awaitingWashDuration') {
          const index = parseInt(input, 10) - 1;
          if (index >= 0 && index < smartPlugsCache.length) {
            selectedPlug = smartPlugsCache[index];

            if (selectedCommand === 'identify') {
              await this.identifyPowerValue(selectedPlug.deviceId, selectedPlug.deviceKey, connection);
              selectedCommand = '';
            } else if (selectedCommand === 'track') {
              connection.write('Please enter the PowerValueID: \n');
              selectedCommand = 'awaitingPowerValueId';
            } else if (selectedCommand === 'calibrate') {
              connection.write('Please enter the washing cycle duration in seconds: \n');
              selectedCommand = 'awaitingWashDuration';
            }
          } else {
            connection.write('Invalid selection.\n');
          }
        } else if (selectedCommand === 'awaitingWashDuration') {
          const washDurationSeconds = parseInt(input, 10);
          if (isNaN(washDurationSeconds) || washDurationSeconds <= 0) {
            connection.write('Invalid duration. Please enter a valid number of seconds.\n');
          } else {
            await this.calibratePowerConsumption(selectedPlug.deviceId, 'cur_power', connection, washDurationSeconds);
            selectedCommand = '';
          }
        } else if (selectedCommand === 'awaitingPowerValueId') {
          const powerValueId = input;
          if (selectedPlug) {
            await this.trackPowerConsumption(selectedPlug.deviceId, selectedPlug.deviceKey, powerValueId, undefined, connection);
            selectedCommand = '';
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

  configureAccessory(accessory: PlatformAccessory): void {
    const existingDevice = this.laundryDevices.find(laundryDevice =>
      this.api.hap.uuid.generate(laundryDevice.config.name) === accessory.UUID
    );

    if (!existingDevice || !existingDevice.config.exposeStateSwitch) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.accessories.push(accessory);
    }
  }
}