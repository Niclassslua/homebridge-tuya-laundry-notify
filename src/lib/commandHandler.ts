import { Logger } from 'homebridge';
import net from 'net';
import { SmartPlugService } from './smartPlugService'; // Import SmartPlugService

export class CommandHandler {
  private selectedCommand = '';
  private selectedPlug: any = null;
  private smartPlugsCache: any[] = [];

  constructor(private log: Logger, private smartPlugService: SmartPlugService) {}

  async handleCommand(input: string, connection: net.Socket) {
    input = input.trim();
    this.log.info(`Command received: "${input}"`);
    this.log.info(`Current selectedCommand: ${this.selectedCommand}`);
    this.log.info(`Current smartPlugsCache length: ${this.smartPlugsCache.length}`);

    // Wenn ein spezifischer Input (Gerätenummer) erwartet wird
    if (this.selectedCommand && /^\d+$/.test(input)) {
      const index = parseInt(input, 10) - 1;
      this.log.info(`Parsed device index: ${index}`);

      // Sicherstellen, dass das Gerät innerhalb des gültigen Bereichs liegt
      if (index >= 0 && index < this.smartPlugsCache.length) {
        this.selectedPlug = this.smartPlugsCache[index];
        this.log.info(`Selected plug: ${JSON.stringify(this.selectedPlug)}`);

        const dpsStatus = await this.smartPlugService.getLocalDPS(this.selectedPlug, this.log).catch(error => {
          this.log.error(`Error retrieving DPS Status: ${error.message}`);
          return null;
        });

        if (dpsStatus) {
          this.log.info(`DPS Status for selected plug: ${JSON.stringify(dpsStatus)}`);
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

        // Logs für Debugging, um zu sehen, ob der nächste Schritt korrekt gesetzt wird
        this.log.info(`Next step based on command: ${this.selectedCommand}`);

        // Überprüfen, ob ein track- oder calibrate-Befehl gerade läuft
        if (this.selectedCommand === 'track') {
          connection.write('Please enter the PowerValueID (default: cur_power): \n');
          this.selectedCommand = 'awaitingPowerValueId';
          this.log.info('Command set to awaitingPowerValueId');
        } else if (this.selectedCommand === 'calibrate') {
          connection.write('Please enter the washing cycle duration in seconds: \n');
          this.selectedCommand = 'awaitingWashDuration';
          this.log.info('Command set to awaitingWashDuration');
        } else {
          // Falls keine spezifische Aktion definiert ist, resetten wir den Befehl
          this.selectedCommand = '';  // Setze den Befehl zurück
          this.log.info('Command reset after device selection.');
        }
      } else {
        connection.write('Invalid selection.\n');
        this.log.error(`Invalid device index: ${index}`);
      }
      return;
    }

    // Handling der Waschdauer
    if (this.selectedCommand === 'awaitingWashDuration') {
      this.log.info(`Handling wash duration input: ${input}`);
      const washDurationSeconds = parseInt(input, 10);
      if (isNaN(washDurationSeconds) || washDurationSeconds <= 0) {
        connection.write('Invalid duration. Please enter a valid number of seconds.\n');
      } else {
        this.log.info(`Calibrating power consumption for ${this.selectedPlug.deviceId} with duration ${washDurationSeconds} seconds.`);
        await this.smartPlugService.calibratePowerConsumption(this.selectedPlug.deviceId, 'cur_power', connection, washDurationSeconds);
        this.selectedCommand = ''; // Zurücksetzen nach der Kalibrierung
      }
      return;
    }

    // Handling der PowerValueID
    if (this.selectedCommand === 'awaitingPowerValueId') {
      this.log.info(`Handling PowerValueID input: ${input}`);
      const powerValueId = input || 'cur_power'; // Falls der Benutzer keine PowerValueID eingibt, nutze den Standardwert
      if (this.selectedPlug) {
        this.log.info(`Tracking power consumption for device ${this.selectedPlug.deviceId} with PowerValueID ${powerValueId}`);
        await this.smartPlugService.trackPowerConsumption(this.selectedPlug.deviceId, powerValueId, connection);
        this.selectedCommand = '';  // Zurücksetzen nach dem Tracking
      } else {
        connection.write('No valid device selected.\n');
        this.log.error('No valid device selected for tracking.');
      }
      return;
    }

    // Main command logic
    switch (input) {
      case 'discover': {
        this.selectedCommand = input;
        this.log.info('Starting device discovery...');

        // Starte die LAN Discovery
        connection.write('Starting LAN discovery...\n');
        const localDevices = await this.smartPlugService.discoverLocalDevices();

        if (localDevices.length === 0) {
          connection.write('No LAN devices found.\n');
          this.log.warn('No devices discovered on LAN.');
          this.selectedCommand = '';
          return;
        }

        connection.write(`Found ${localDevices.length} local devices. Now fetching cloud devices for comparison...\n`);
        this.log.info(`Discovered local devices: ${JSON.stringify(localDevices)}`);

        // Abgleich mit Cloud-Geräten
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
        this.log.info(`Displayed device options to user: ${response}`);
        break;
      }

      case 'track':
      case 'calibrate': {
        this.selectedCommand = input;

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
        this.log.info(`Displayed available devices: ${response}`);
        break;
      }

      default: {
        this.log.warn(`Unknown command: ${input}`);
        connection.write(`Unknown command: ${input}\n`);
        break;
      }
    }
  }

  // Display help information when connection is established
  showHelp(connection: net.Socket) {
    const helpMessage = `
    Welcome to the Smart Plug Controller!
    Available commands:
    1. discover  - Discover connected smart plugs
    2. track     - Track power consumption of a smart plug
    3. calibrate - Calibrate power consumption for a washing cycle
    Type a command to begin.
    `;
    connection.write(helpMessage);
  }
}