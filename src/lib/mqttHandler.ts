import { Logger } from 'homebridge';
import TuyaOpenMQ from '../core/TuyaOpenMQ';

export class MQTTHandler {
  constructor(private log: Logger, private mq: TuyaOpenMQ) {}

  startListening() {
    this.log.debug('Starting MQTT message listener...');
    try {
      this.mq.addMessageListener(this.handleMessage.bind(this));
      this.mq.start();
      this.log.info('MQTT listener started successfully.');
    } catch (error) {
      this.log.error(`Failed to start MQTT listener: ${error.message}`);
      this.log.debug(`Stack trace: ${error.stack}`);
    }
  }

  handleMessage(message: string) {
    this.log.debug(`Received MQTT message: ${message}`);
    try {
      if (this.isValidJson(message)) {
        const parsedMessage = JSON.parse(message);
        this.log.debug(`Parsed MQTT message: ${JSON.stringify(parsedMessage)}`);
        // Handle the message...
      } else {
        this.log.warn(`Received non-JSON MQTT message: ${message}`);
      }
    } catch (error) {
      this.log.error(`Error handling MQTT message: ${error.message}`);
      this.log.debug(`Stack trace: ${error.stack}`);
    }
  }

  isValidJson(message: string): boolean {
    try {
      JSON.parse(message);
      return true;
    } catch (error) {
      this.log.warn(`Invalid JSON received: ${message}`);
      return false;
    }
  }
}