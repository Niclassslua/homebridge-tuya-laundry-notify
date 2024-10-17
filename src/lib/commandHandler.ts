import { Logger } from 'homebridge';
import net from 'net';
import { PowerConsumptionTracker } from './powerConsumptionTracker';
import { DeviceManager } from './deviceManager';
import { TuyaApiService } from './tuyaApiService';

export class CommandHandler {
  private selectedCommand = '';
  private selectedPlug: any = null;
  private smartPlugsCache: any[] = [];
  private generateChart: boolean = false;
  private duration: number | undefined = undefined;

  private deviceManager: DeviceManager;
  private powerConsumptionTracker: PowerConsumptionTracker;

  constructor(private tuyaApiService: TuyaApiService, private log: Logger) {
    const apiInstance = this.tuyaApiService.getApiInstance();

    if (!apiInstance) {
      throw new Error('Tuya API is not authenticated.');
    }

    this.deviceManager = new DeviceManager(apiInstance, this.log);
    this.powerConsumptionTracker = new PowerConsumptionTracker(this.deviceManager, this.log);
  }

  async handleCommand(input: string, connection: net.Socket) {
    input = input.trim();

    if (!this.selectedCommand) {
      // New command, parse options
      const parts = input.split(/\s+/);
      const command = parts[0];

      // Properly check for --chart and --duration arguments
      this.generateChart = parts.includes('--chart');
      const durationArg = parts.find(part => part.startsWith('--duration='));
      this.duration = durationArg ? parseInt(durationArg.split('=')[1], 10) : undefined;

      this.log.info(`Command received: "${command}"`);
      this.log.info(`Parsed generateChart: ${this.generateChart}, duration: ${this.duration}`);

      switch (command) {
        case 'discover': {
          this.selectedCommand = 'discover';
          connection.write('Starting LAN discovery...\n');
          const localDevices = await this.deviceManager.discoverLocalDevices();

          if (localDevices.length === 0) {
            connection.write('No LAN devices found.\n');
            this.log.warn('No devices discovered on LAN.');
            this.selectedCommand = '';
            return;
          }

          connection.write(`Found ${localDevices.length} local devices. Now fetching cloud devices for comparison...\n`);

          let discoverLocalDevicesResponse = 'Local devices:\n';
          localDevices.forEach((plug, index) => {
            discoverLocalDevicesResponse += `${index + 1}: Device ID: ${plug.deviceId}, IP: ${plug.ip}, Protocol Version: ${plug.version}, \n`;
          });

          connection.write(discoverLocalDevicesResponse);

          const matchedDevices = await this.deviceManager.matchLocalWithCloudDevices(localDevices);

          if (matchedDevices.length === 0) {
            connection.write('No matching devices found in the cloud.\n');
            this.log.warn('No devices matched with the cloud.');
            this.selectedCommand = '';
            return;
          }

          this.smartPlugsCache = matchedDevices;
          let matchLocalWithCloudDevicesResponse = 'Matched smart plugs:\n';
          matchedDevices.forEach((plug, index) => {
            matchLocalWithCloudDevicesResponse += `${index + 1}: Name: ${plug.displayName}, Device ID: ${plug.deviceId}, Local Key: ${plug.localKey}, IP: ${plug.ip}\n`;
          });

          connection.write(matchLocalWithCloudDevicesResponse + 'Select the device number: \n');
          this.log.debug(`Displayed device options to user: ${matchLocalWithCloudDevicesResponse}`);

          // After discovery, set the selectedCommand to handle device selection
          this.selectedCommand = 'selectDevice';
          break;
        }

        case 'track': {
          this.selectedCommand = 'track';

          if (this.smartPlugsCache.length === 0) {
            connection.write('No devices found. Please run "discover" first.\n');
            this.selectedCommand = '';
            this.log.warn('No devices in smartPlugsCache.');
            return;
          }

          let response = 'Available smart plugs:\n';
          this.smartPlugsCache.forEach((plug, index) => {
            response += `${index + 1}: Name: ${plug.displayName}, Device ID: ${plug.deviceId}\n`;
          });

          connection.write(response + 'Select the device number: \n');
          this.log.debug(`Displayed available devices: ${response}`);
          break;
        }

        default: {
          this.log.warn(`Unknown command: ${command}`);
          connection.write(`Unknown command: ${command}\n`);
          break;
        }
      }
    } else {
      // Existing command in progress, do not re-parse options
      if (this.selectedCommand === 'track' || this.selectedCommand === 'selectDevice') {
        if (/^\d+$/.test(input)) {
          const index = parseInt(input, 10) - 1;

          if (index >= 0 && index < this.smartPlugsCache.length) {
            this.selectedPlug = this.smartPlugsCache[index];

            let dpsStatus = await this.deviceManager.getLocalDPS(this.selectedPlug);

            if (dpsStatus) {
              connection.write(
                `Selected device details:\n` +
                `Name: ${this.selectedPlug.displayName}\n` +
                `Tuya Device ID: ${this.selectedPlug.deviceId}\n` +
                `Local Key: ${this.selectedPlug.localKey || 'N/A'}\n` +
                `IP Address: ${this.selectedPlug.ip}\n` +
                `Protocol Version: ${this.selectedPlug.version}\n` +
                `DPS Status: ${JSON.stringify(dpsStatus)}\n`
              );
            } else {
              connection.write('Failed to retrieve DPS Status.\n');
              this.log.error('Failed to retrieve DPS Status.');
            }

            if (this.selectedCommand === 'track') {
              connection.write('Please enter the PowerValueID (e.g.: 19): \n');
              this.selectedCommand = 'awaitingPowerValueId';
              this.log.info('Command set to awaitingPowerValueId');
            } else if (this.selectedCommand === 'selectDevice') {
              // After selecting a device during discovery, reset the command
              this.selectedCommand = '';
              this.log.info('Device selected after discovery.');
            }
          } else {
            connection.write('Invalid selection.\n');
            this.log.error(`Invalid device index: ${index}`);
          }
        } else {
          connection.write('Please enter a valid device number.\n');
        }
      } else if (this.selectedCommand === 'awaitingPowerValueId') {
        const powerValueId = input;
        this.log.info(`Extracted PowerValueId: ${powerValueId}`);

        if (!powerValueId || isNaN(Number(powerValueId))) {
          connection.write('Invalid PowerValueID. Please try again with a valid number.\n');
          this.log.error('Invalid PowerValueID provided.');
          return;
        }

        if (this.selectedPlug) {
          await this.powerConsumptionTracker.trackPowerConsumption(
            this.selectedPlug.deviceId,
            this.selectedPlug.localKey,
            powerValueId,
            connection,
            this.generateChart,
            this.duration
          );

          this.selectedCommand = '';
          // Reset the stored flags after use
          this.generateChart = false;
          this.duration = undefined;
        } else {
          connection.write('No valid device selected.\n');
          this.log.error('No valid device selected for tracking.');
        }
      } else {
        connection.write('Unexpected input. Please start a new command.\n');
        this.log.warn('Received input when no command is in progress.');
      }
    }
  }

  showHelp(connection: net.Socket) {
    const helpMessage = `
    Welcome to the Smart Plug Controller!
    Available commands:
    1. discover  - Discover connected smart plugs
    2. track     - Track power consumption of a smart plug
    Type a command to begin.
    `;
    connection.write(helpMessage);
  }
}