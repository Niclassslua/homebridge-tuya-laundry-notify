import { Logger } from 'homebridge';
import axios from 'axios';

export interface NtfyConfig {
  topic: string; // Ntfy topic to which notifications will be sent
  serverUrl?: string; // Optional custom ntfy server URL (default: https://ntfy.sh)
}

export class NtfyGateway {
  private serverUrl: string;

  constructor(
    private readonly log: Logger,
    private readonly config: NtfyConfig,
  ) {
    this.serverUrl = config.serverUrl || 'https://ntfy.sh';
  }

  public async send(message: string) {
    try {
      const url = `${this.serverUrl}/${this.config.topic}`;
      await axios.post(url, message, {
        headers: {
          'Title': 'Homebridge Notification',
        },
      });
      this.log.debug(`Sent notification to ntfy topic ${this.config.topic}`);
    } catch (error) {
      this.log.error(`Failed to send notification via ntfy: ${error.message}`);
    }
  }
}
