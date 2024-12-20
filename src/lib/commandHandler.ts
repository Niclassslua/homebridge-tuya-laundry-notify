import { Logger } from 'homebridge';
import net from 'net';
import { PowerConsumptionTracker } from './powerConsumptionTracker';
import { DeviceManager } from './deviceManager';
import { TuyaApiService } from './tuyaApiService';

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
    if (!apiInstance) throw new Error(Color.error('Tuya API is not authenticated.'));

    this.deviceManager = new DeviceManager(apiInstance, this.log);
    this.powerConsumptionTracker = new PowerConsumptionTracker(this.deviceManager, this.log);
  }

  async handleCommand(input: string, connection: net.Socket) {
    input = input.trim();
    const [command, ...args] = input.split(/\s+/);

    if (!this.selectedCommand) {
      this.parseOptions(args);
      this.log.info(Color.info(`Command received: "${command}" with options: chart=${this.generateChart}, duration=${this.duration}`));

      const commandMap: { [key: string]: () => void } = {
        'discover': () => this.handleDiscover(connection),
        'track': () => this.handleTrack(connection),
        'exportConfig': () => this.handleExportConfig(connection),
      };

      (commandMap[command] || (() => this.unknownCommand(connection, command)))();
    } else {
      this.handleExistingCommand(input, connection);
    }
  }

  private parseOptions(args: string[]) {
    this.generateChart = args.includes('--chart');
    const durationArg = args.find(arg => arg.startsWith('--duration='));
    this.duration = durationArg ? parseInt(durationArg.split('=')[1], 10) : undefined;
  }

  private async handleDiscover(connection: net.Socket) {
    this.selectedCommand = 'discover';
    connection.write(Color.info('Starting LAN discovery...\n'));

    try {
      const localDevices = await this.deviceManager.discoverLocalDevices();
      if (localDevices.length === 0) {
        this.log.warn(Color.warning('No devices discovered on LAN.'));
        connection.write(Color.warning('No LAN devices found.\n'));
        connection.write("RESETTING COMMAND");
        return this.resetCommand();
      }

      connection.write(Color.info(`Found ${localDevices.length} local devices. Fetching cloud devices for comparison...\n`));
      const matchedDevices = await this.deviceManager.matchLocalWithCloudDevices(localDevices);
      if (matchedDevices.length === 0) {
        this.log.warn(Color.warning('No devices matched with the cloud.'));
        connection.write(Color.warning('No matching devices found in the cloud.\n'));
        connection.write("RESETTING COMMAND");
        return this.resetCommand();
      }

      this.smartPlugsCache = matchedDevices;
      connection.write(Color.success(this.formatDeviceList(matchedDevices, 'Matched smart plugs') + 'Select the device number: \n'));
      this.selectedCommand = 'selectDevice';
    } catch (error) {
      this.log.error(Color.error('Error during device discovery:'), error);
      connection.write(Color.error('Error during discovery.\n'));
      connection.write("RESETTING COMMAND");
      this.resetCommand();
    }
  }

  private handleTrack(connection: net.Socket) {
    connection.write("HANDLETRACK")
    this.selectedCommand = 'track';
    if (this.smartPlugsCache.length === 0) {
      connection.write(Color.warning('No devices found. Please run "discover" first.\n'));
      this.log.warn(Color.warning('No devices in smartPlugsCache.'));
      connection.write("RESETTING COMMAND");
      this.resetCommand();
      return;
    }
    connection.write(Color.info(this.formatDeviceList(this.smartPlugsCache, 'Available smart plugs') + 'Select the device number: \n'));
    this.selectedCommand = 'selectDeviceTrack';
  }

  private async handleExistingCommand(input: string, connection: net.Socket) {
    const trimmedInput = input.trim();

    connection.write("SELECTED COMMAND");
    connection.write(this.selectedCommand);

    if (this.selectedCommand === 'selectDevice') {
      const index = parseInt(trimmedInput, 10) - 1;
      if (!isNaN(index) && index >= 0 && index < this.smartPlugsCache.length) {
        this.selectedPlug = this.smartPlugsCache[index];
        await this.displayDeviceDetails(connection, this.selectedPlug);
        connection.write(Color.success("\nDevice selected successfully! You can now use 'track' or 'exportConfig' commands.\n"));
        connection.write("RESETTING COMMAND");
        this.resetCommand();
      } else {
        connection.write(Color.warning('Invalid selection. Please enter a valid device number.\n'));
      }
    } else if (this.selectedCommand === 'selectDeviceTrack') {
      const index = parseInt(trimmedInput, 10) - 1;
      if (!isNaN(index) && index >= 0 && index < this.smartPlugsCache.length) {
        this.selectedPlug = this.smartPlugsCache[index];
        await this.displayDeviceDetails(connection, this.selectedPlug);
        connection.write(Color.success("\nDevice selected successfully!\n"));
        this.selectedCommand = 'awaitingPowerValueIdTrack';
        this.log.info('Command set to awaitingPowerValueIdTrack');
        connection.write('Please enter the PowerValueID (e.g.: 19): \n');
      } else {
        connection.write(Color.warning('Invalid selection. Please enter a valid device number.\n'));
      }
    } else if (this.selectedCommand === 'awaitingPowerValueIdTrack') {
      const powerValueId = parseInt(trimmedInput, 10) - 1;
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
          String(powerValueId),
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
      this.handleConfigFlow(trimmedInput, connection);
    }
  }

  private handleConfigFlow(input: string, connection: net.Socket) {
    const prompts: { [key: string]: { message: string; nextCommand: string; property?: string } } = {
      'awaitingConfigName': { message: 'Enter the power value ID (e.g., 19): ', nextCommand: 'awaitingPowerValueId', property: 'name' },
      'awaitingPowerValueId': { message: 'Enter the start power value threshold: ', nextCommand: 'awaitingStartValue', property: 'powerValueId' },
      'awaitingStartValue': { message: 'Enter the duration (seconds) for start detection: ', nextCommand: 'awaitingStartDuration', property: 'startValue' },
      'awaitingStartDuration': { message: 'Enter the end power value threshold: ', nextCommand: 'awaitingEndValue', property: 'startDuration' },
      'awaitingEndValue': { message: 'Enter the duration (seconds) for end detection: ', nextCommand: 'awaitingEndDuration', property: 'endValue' },
      'awaitingEndDuration': { message: 'Enter the start message: ', nextCommand: 'awaitingStartMessage', property: 'endDuration' },
      'awaitingStartMessage': { message: 'Enter the end message: ', nextCommand: 'awaitingEndMessage', property: 'startMessage' },
      'awaitingEndMessage': { message: 'Should the state be exposed as a switch? (true/false): ', nextCommand: 'awaitingExposeStateSwitch', property: 'endMessage' },
      'awaitingExposeStateSwitch': { message: '', nextCommand: '', property: 'exposeStateSwitch' },
    };

    if (this.selectedCommand in prompts) {
      const { message, nextCommand, property } = prompts[this.selectedCommand];
      if (property) {
        this.configData[property] = property === 'exposeStateSwitch' ? input.toLowerCase() === 'true' : input;
      }
      connection.write(Color.info(message));
      this.selectedCommand = nextCommand || '';

      if (!nextCommand) {
        this.displayFinalConfig(connection);
        connection.write("RESETTING COMMAND");
        this.resetCommand();
      }
    } else {
      connection.write(Color.warning('Unexpected input. Please start a new command.\n'));
    }
  }

  private configData: any = {};

  private handleExportConfig(connection: net.Socket) {
    if (!this.selectedPlug) {
      connection.write(Color.warning("Please select a device first by using the 'discover' command.\n"));
      return;
    }

    // Basisdaten aus dem ausgewählten Gerät vorbereiten
    this.configData = {
      deviceId: this.selectedPlug.deviceId,
      localKey: this.selectedPlug.localKey,
      ipAddress: this.selectedPlug.ip,
      protocolVersion: this.selectedPlug.version,
    };

    connection.write(Color.info("Let's configure your laundry device.\n"));
    connection.write(Color.info("Enter the name of the device: "));
    this.selectedCommand = 'awaitingConfigName';
  }

  private displayFinalConfig(connection: net.Socket) {
    const finalConfig = {
      laundryDevices: [this.configData]
    };
    connection.write(Color.success("Generated Config:\n"));
    connection.write(JSON.stringify(finalConfig, null, 2) + "\n");
  }

  private async trackPowerConsumption(powerValueId: string, connection: net.Socket) {
    if (!powerValueId || isNaN(Number(powerValueId))) {
      connection.write(Color.warning('Invalid PowerValueID. Please try again with a valid number.\n'));
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
      connection.write("RESETTING COMMAND");
      this.resetCommand();
    } else {
      connection.write(Color.error('No valid device selected.\n'));
      this.log.error('No valid device selected for tracking.');
    }
  }

  private async displayDeviceDetails(connection: net.Socket, plug: any) {
    try {
      const dpsStatus = await this.deviceManager.getLocalDPS(plug);
      const details = `
        Selected device details:
        Name: ${plug.displayName}
        Tuya Device ID: ${plug.deviceId}
        Local Key: ${plug.localKey || 'N/A'}
        IP Address: ${plug.ip}
        Protocol Version: ${plug.version}
        DPS Status: ${JSON.stringify(dpsStatus)} \n`;
      connection.write(Color.success(details));
    } catch (error) {
      this.log.error(Color.error('Failed to retrieve DPS Status:'), error);
      connection.write(Color.error('Failed to retrieve DPS Status.\n'));
    }
  }

  private formatDeviceList(devices: any[], title: string): string {
    return `${title}:\n` + devices.map((plug, index) =>
      `${index + 1}: Name: ${plug.displayName}, Device ID: ${plug.deviceId}, IP: ${plug.ip}`
    ).join('\n') + '\n';
  }

  

  private unknownCommand(connection: net.Socket, command: string) {
    this.log.warn(Color.warning(`Unknown command: ${command}`));
    connection.write(Color.warning(`Unknown command: ${command}\n`));
  }

  private resetCommand() {
    this.selectedCommand = '';
    this.generateChart = false;
    this.duration = undefined;
    this.configData = {};
  }

  showHelp(connection: net.Socket) {
    const helpMessage = Color.info(`
      Welcome to the Smart Plug Controller!
      Available commands:
      1. discover       - Discover connected smart plugs
      2. track          - Track power consumption of a smart plug
      3. exportConfig   - Generate JSON configuration template for the selected plug
      Type a command to begin.
    `);
    connection.write(helpMessage);
  }
}
