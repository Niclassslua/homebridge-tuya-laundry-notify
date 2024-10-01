import { Logger } from 'homebridge';
import net from 'net';
import { SmartPlugService } from './smartPlugService';

export class CommandHandler {
  private selectedCommand = '';
  private selectedPlug: any = null;
  private smartPlugsCache: any[] = [];

  constructor(private log: Logger, private smartPlugService: SmartPlugService) {}

  async handleCommand(input: string, connection: net.Socket) {
    input = input.trim();
    const parts = input.split(' ');
    const command = parts[0];
    const generateChart = parts.includes('--chart'); // Check for the --chart flag
    const durationArg = parts.find(part => part.startsWith('--duration='));
    const duration = durationArg ? parseInt(durationArg.split('=')[1], 10) : undefined; // Extract the duration in seconds

    this.log.info(`Command received: "${command}"`);
    this.log.info(`Current selectedCommand: ${this.selectedCommand}`);
    this.log.info(`Current smartPlugsCache length: ${this.smartPlugsCache.length}`);

    if (this.selectedCommand === 'awaitingPowerValueId') {
      const powerValueId = parts[1];

      if (this.selectedPlug) {
        await this.smartPlugService.trackPowerConsumption(
          this.selectedPlug.deviceId,
          this.selectedPlug.localKey,
          powerValueId,
          connection,
          1000,
          generateChart,
          duration
        );
        this.selectedCommand = '';  // Set the command back to empty after tracking
      } else {
        connection.write('No valid device selected.\n');
        this.log.error('No valid device selected for tracking.');
      }
      return; // End the function here to prevent further processing
    }

    if (this.selectedCommand && /^\d+$/.test(input)) {
      const index = parseInt(input, 10) - 1;

      if (index >= 0 && index < this.smartPlugsCache.length) {
        this.selectedPlug = this.smartPlugsCache[index];

        const dpsStatus = await this.smartPlugService.getLocalDPS(this.selectedPlug, this.log);

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
        } else {
          this.selectedCommand = '';  // Reset after device selection
          this.log.info('Command reset after device selection.');
        }
      } else {
        connection.write('Invalid selection.\n');
        this.log.error(`Invalid device index: ${index}`);
      }
      return;
    }

    switch (command) {
      case 'discover': {
        this.selectedCommand = command;
        connection.write('Starting LAN discovery...\n');
        const localDevices = await this.smartPlugService.discoverLocalDevices();

        if (localDevices.length === 0) {
          connection.write('No LAN devices found.\n');
          this.log.warn('No devices discovered on LAN.');
          this.selectedCommand = '';
          return;
        }

        connection.write(`Found ${localDevices.length} local devices. Now fetching cloud devices for comparison...\n`);
        const matchedDevices = await this.smartPlugService.matchLocalWithCloudDevices(localDevices);

        if (matchedDevices.length === 0) {
          connection.write('No matching devices found in the cloud.\n');
          this.log.warn('No devices matched with the cloud.');
          this.selectedCommand = '';
          return;
        }

        this.smartPlugsCache = matchedDevices;
        let response = 'Matched smart plugs:\n';
        matchedDevices.forEach((plug, index) => {
          response += `${index + 1}: Name: ${plug.displayName}, Device ID: ${plug.deviceId}, Local Key: ${plug.localKey}, IP: ${plug.ip}\n`;
        });

        connection.write(response + 'Select the device number: \n');
        this.log.debug(`Displayed device options to user: ${response}`);
        break;
      }

      case 'track': {
        this.selectedCommand = command;

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