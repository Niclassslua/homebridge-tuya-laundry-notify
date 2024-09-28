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

    // Wenn ein spezifischer Input (Gerätenummer, PowerValueId oder Waschdauer) erwartet wird
    if (this.selectedCommand && /^\d+$/.test(input) && this.selectedCommand !== 'awaitingWashDuration') {
      const index = parseInt(input, 10) - 1;
      if (index >= 0 && index < this.smartPlugsCache.length) {
        this.selectedPlug = this.smartPlugsCache[index];
        if (this.selectedCommand === 'discover') {
          await this.smartPlugService.identifyPowerValue(this.selectedPlug.deviceId, connection);
          this.selectedCommand = '';
        } else if (this.selectedCommand === 'track') {
          connection.write('Please enter the PowerValueID: \n');
          this.selectedCommand = 'awaitingPowerValueId';
        } else if (this.selectedCommand === 'calibrate') {
          connection.write('Please enter the washing cycle duration in seconds: \n');
          this.selectedCommand = 'awaitingWashDuration';
        }
      } else {
        connection.write('Invalid selection.\n');
      }
      return;
    }

    // Handling der Waschdauer
    if (this.selectedCommand === 'awaitingWashDuration') {
      const washDurationSeconds = parseInt(input, 10);
      if (isNaN(washDurationSeconds) || washDurationSeconds <= 0) {
        connection.write('Invalid duration. Please enter a valid number of seconds.\n');
      } else {
        await this.smartPlugService.calibratePowerConsumption(this.selectedPlug.deviceId, 'cur_power', connection, washDurationSeconds);
        this.selectedCommand = '';
      }
      return;
    }

    // Handling der PowerValueID
    if (this.selectedCommand === 'awaitingPowerValueId') {
      const powerValueId = input;
      if (this.selectedPlug) {
        await this.smartPlugService.trackPowerConsumption(this.selectedPlug.deviceId, powerValueId, connection);
        this.selectedCommand = '';
      } else {
        connection.write('No valid device selected.\n');
      }
      return;
    }

    // Main command logic
    switch (input) {
      case 'discover':
      case 'track':
      case 'calibrate': {
        this.selectedCommand = input;

        // *** Starte die Discovery, wenn ein Befehl wie "discover", "track" oder "calibrate" eingegeben wurde ***
        const smartPlugs = await this.smartPlugService.discoverSmartPlugs();  // Starte Discovery hier
        if (smartPlugs.length === 0) {
          connection.write('No smart plugs found.\n');
          connection.end();
          return;
        }

        this.smartPlugsCache = smartPlugs;
        let response = 'Available smart plugs:\n';
        smartPlugs.forEach((plug, index) => {
          response += `${index + 1}: Name: ${plug.displayName}, UUID: ${plug.UUID}\n`;
        });

        connection.write(response + 'Select the device number: \n');
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