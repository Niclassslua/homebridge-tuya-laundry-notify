import {NotifyConfig} from '../interfaces/notifyConfig';
import {PushGateway} from './pushGateway';
import {TelegramGateway} from './telegramGateway';
import {API, Logger} from 'homebridge';

export class MessageGateway {
  private pushGateway?: PushGateway;
  private telegramGateway?: TelegramGateway;

  constructor(public readonly log: Logger, config: NotifyConfig, api: API) {
    if (config.telegramBotToken) {
      log.info('Starte Telegram Gateway');
      this.telegramGateway = new TelegramGateway(config.telegramBotToken, log, api);
    } else {
      log.warn('Telegram Bot Token fehlt. Telegram-Benachrichtigungen sind nicht verfügbar.');
    }

    if (config.pushed && config.pushed.appKey && config.pushed.appSecret && config.pushed.channelAlias) {
      this.pushGateway = new PushGateway(log, config.pushed);
    } else {
      log.warn('Pushed.co-Konfiguration ist unvollständig. Pushed.co-Benachrichtigungen sind nicht verfügbar.');
    }
  }

  async send(message: string) {
    if (this.pushGateway) {
      this.pushGateway.send(message);
    }
    if (this.telegramGateway) {
      await this.telegramGateway.send(message);
    }
    if (!this.pushGateway && !this.telegramGateway) {
      this.log.warn('Keine Benachrichtigungs-Gateways konfiguriert. Nachricht konnte nicht gesendet werden:', message);
    }
  }
}