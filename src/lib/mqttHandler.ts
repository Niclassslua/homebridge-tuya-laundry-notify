import { Logger } from 'homebridge';
import TuyaOpenMQ from '../core/TuyaOpenMQ';

export class MQTTHandler {
  constructor(private log: Logger, private mq: TuyaOpenMQ) {}

  startListening() {
    this.mq.addMessageListener(this.handleMessage.bind(this));
    this.mq.start();
  }

  handleMessage(message: string) {
    if (this.isValidJson(message)) {
      const parsedMessage = JSON.parse(message);
      // Handle parsed message logic
    } else {
      this.log.warn(`Received non-JSON MQTT message: ${message}`);
    }
  }

  isValidJson(message: string): boolean {
    try {
      JSON.parse(message);
      return true;
    } catch (error) {
      return false;
    }
  }
}