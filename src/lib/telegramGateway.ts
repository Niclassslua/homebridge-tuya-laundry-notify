import TelegramBot from 'node-telegram-bot-api';
import {API, Logger} from 'homebridge';
import * as path from 'path';
import * as fs from 'fs';

export class TelegramGateway {

  private subscribers: number[] = [];
  private bot: TelegramBot;

  constructor(token: string, private log: Logger, private api: API) {
    this.loadSubscribers();

    this.bot = new TelegramBot(token, {polling: true});

    this.bot.onText(/\/subscribe/, (msg, match) => {
      this.subscribers.push(msg.chat.id);
      this.saveSubscribers();
      this.bot.sendMessage(msg.chat.id, 'Subscribe successful!');

    });

    this.bot.onText(/\/unsubscribe/, (msg, match) => {
      const index = this.subscribers.indexOf(msg.chat.id);
      if (index > -1) {
        this.subscribers.splice(index, 1);
        this.saveSubscribers();
        this.bot.sendMessage(msg.chat.id, 'Unsubscribed...');
      } else {
        this.bot.sendMessage(msg.chat.id, 'You are not subscribed!');
      }
    });
  }

  private checkPersistPath() {
    if (!fs.existsSync(this.api.user.persistPath())) {
      fs.mkdirSync(this.api.user.persistPath());
    }
  }

  private loadSubscribers() {
    const file = path.join(this.api.user.persistPath(), 'LaundryTelegramSubscribers.json');
    this.checkPersistPath();
    try {
      const subscribersRaw = fs.readFileSync(file).toString();
      this.subscribers = JSON.parse(subscribersRaw);
      this.log.info(`Loaded ${this.subscribers.length} Telegram subscribers from cache`);

    } catch (error) {
      this.subscribers = [];
    }
  }

  private saveSubscribers() {
    const file = path.join(this.api.user.persistPath(), 'LaundryTelegramSubscribers.json');
    this.checkPersistPath();
    fs.writeFileSync(file, JSON.stringify(this.subscribers));
  }

  async send(message: string) {
    for (const subscriber of this.subscribers) {
      await this.bot.sendMessage(subscriber, message);
    }
  }
}