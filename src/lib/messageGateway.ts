import { NotifyConfig, NtfyConfig } from '../interfaces/notifyConfig';
import { PushGateway } from './pushGateway';
import { TelegramGateway } from './telegramGateway';
import { NtfyGateway } from './ntfyGateway';
import { API, Logger } from 'homebridge';

export class MessageGateway {
  private pushGateway?: PushGateway;
  private telegramGateway?: TelegramGateway;
  private ntfyGateway?: NtfyGateway;

  constructor(public readonly log: Logger, config: NotifyConfig, api: API) {
    // Check if Telegram configuration is provided
    if (config.notifications?.telegram?.botToken) {
      log.info('Starting Telegram Gateway');
      this.telegramGateway = new TelegramGateway(config.notifications.telegram.botToken, log, api);
    } else {
      log.warn('Telegram configuration is missing or incomplete. Telegram notifications are not available.');
    }

    // Check if Pushed.co configuration is provided
    if (config.notifications?.pushed) {
      const { appKey, appSecret, channelAlias } = config.notifications.pushed;
      if (appKey && appSecret && channelAlias) {
        this.pushGateway = new PushGateway(log, config.notifications.pushed);
      } else {
        log.warn('Incomplete Pushed.co configuration. Pushed.co notifications are not available.');
      }
    }

    // Check if ntfy configuration is provided
    if (config.notifications?.ntfy) {
      log.info('Starting ntfy Gateway');
      this.ntfyGateway = new NtfyGateway(log, config.notifications.ntfy);
    } else {
      log.warn('ntfy configuration is missing. ntfy notifications are not available.');
    }
  }

  async send(message: string) {
    if (this.pushGateway) {
      this.pushGateway.send(message);
    }
    if (this.telegramGateway) {
      await this.telegramGateway.send(message);
    }
    if (this.ntfyGateway) {
      await this.ntfyGateway.send(message);
    }
    if (!this.pushGateway && !this.telegramGateway && !this.ntfyGateway) {
      this.log.warn('No notification gateways configured. Message could not be sent:', message);
    }
  }
}
