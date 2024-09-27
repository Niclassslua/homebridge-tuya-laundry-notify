import { Logger } from 'homebridge';
import net from 'net';
import { SmartPlugService } from './smartPlugService'; // Importiere einen hypothetischen Service zur Interaktion mit Smart Plugs

export class CommandHandler {
  constructor(private log: Logger, private smartPlugService: SmartPlugService) {} // Injektion des SmartPlugService

  async handleCommand(command: string, connection: net.Socket) {
    switch (command) {
      case 'identify': {
        this.log.info('Processing identify command...');
        connection.write('Identifying device...\n');
        const smartPlugs = await this.smartPlugService.getSmartPlugs();
        if (smartPlugs.length === 0) {
          connection.write('No smart plugs found.\n');
        } else {
          connection.write('Available smart plugs:\n');
          smartPlugs.forEach((plug, index) => {
            connection.write(`${index + 1}: Name: ${plug.displayName}, UUID: ${plug.UUID}\n`);
          });
        }
        break;
      }

      case 'track': {
        this.log.info('Processing track command...');
        connection.write('Tracking power consumption...\n');
        const trackingResult = await this.smartPlugService.trackPowerConsumption();
        if (trackingResult.success) {
          connection.write(`Power consumption tracked: ${trackingResult.data} Watt\n`);
        } else {
          connection.write(`Failed to track power consumption: ${trackingResult.error}\n`);
        }
        break;
      }

      case 'calibrate': {
        this.log.info('Processing calibrate command...');
        connection.write('Calibrating power consumption...\n');
        const calibrationResult = await this.smartPlugService.calibratePowerConsumption();
        if (calibrationResult.success) {
          connection.write('Calibration completed successfully.\n');
        } else {
          connection.write(`Calibration failed: ${calibrationResult.error}\n`);
        }
        break;
      }

      default: {
        this.log.warn(`Unknown command: ${command}`);
        connection.write(`Unknown command: ${command}\n`);
        break;
      }
    }
  }
}