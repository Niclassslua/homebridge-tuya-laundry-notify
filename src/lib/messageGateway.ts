import {NotifyConfig} from '../interfaces/notifyConfig';
import {PushGateway} from './pushGateway';
import {TelegramGateway} from './telegramGateway';
import {API, Logger} from 'homebridge';

export class MessageGateway {
  private pushGateway!: PushGateway;
  private telegramGateway!: TelegramGateway;
  constructor(public readonly log: Logger, config: NotifyConfig, api: API) {
    if (config.telegramBotToken) {
      log.info('Starting Telegram Gateway');
      this.telegramGateway = new TelegramGateway(config.telegramBotToken, log, api);
    }

    if(config.pushed && config.pushed.appKey && config.pushed.appSecret && config.pushed.channelAlias) {
      this.pushGateway = new PushGateway(log, config.pushed);
    }
  }

  async send(message: string) {
    if (this.pushGateway) {
      this.pushGateway.send(message);
    }
    if (this.telegramGateway) {
      await this.telegramGateway.send(message);
    }
  }
}