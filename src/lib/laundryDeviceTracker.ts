import {LaundryDeviceConfig} from '../interfaces/notifyConfig';
import {API, Logger, PlatformAccessory} from 'homebridge';
import {DateTime} from 'luxon';
import TuyaOpenAPI from '../core/TuyaOpenAPI';
import {MessageGateway} from './messageGateway';
import {TuyaMQTTProtocol} from '../core/TuyaOpenMQ';

export class LaundryDeviceTracker {
  private startDetected?: boolean;
  private startDetectedTime?: DateTime;
  private isActive?: boolean;
  private endDetected?: boolean;
  private endDetectedTime?: DateTime;

  public accessory?: PlatformAccessory;

  constructor(
    public readonly log: Logger,
    public readonly messageGateway: MessageGateway,
    public config: LaundryDeviceConfig,
    public api: API,
    public tuyaAPI: TuyaOpenAPI,
  ) {
  }

  public async init() {
    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue darf nicht kleiner als endValue sein.');
    }

    if (!this.config.id) {
      this.log.warn(`Gerät ${this.config.name} hat keine ID. Initialisierung wird übersprungen.`);
      return;
    }

    await this.getInitialDeviceInfo();
    await this.refresh();
  }

  private async refresh() {
    try {
      if (!this.isActive && this.startDetected && this.startDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.startDuration) {
          this.log.info(`${this.config.name} started the job!`);
          if (this.config.startMessage) {
            await this.messageGateway.send(this.config.startMessage);
          }
          this.isActive = true;
          if (this.config.exposeStateSwitch && this.accessory) {
            const service = this.accessory.getService(this.api.hap.Service.Switch);
            service?.setCharacteristic(this.api.hap.Characteristic.On, true);
          }
          if (this.config.syncWith) {
            await this.sendPower(this.config.syncWith, true);
          }
        }
      }
      if (this.isActive && this.endDetected && this.endDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.endDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.endDuration) {
          this.log.info(`${this.config.name} finished the job!`);
          if (this.config.endMessage) {
            await this.messageGateway.send(this.config.endMessage);
          }
          if (this.config.exposeStateSwitch && this.accessory) {
            const service = this.accessory.getService(this.api.hap.Service.Switch);
            service?.setCharacteristic(this.api.hap.Characteristic.On, false);
          }
          this.isActive = false;
          if (this.config.syncWith) {
            await this.sendPower(this.config.syncWith, false);
          }
        }
      }
    } catch (e) {
      if (e instanceof Error) {
        this.log.error('Refresh error:', e.message);
      } else {
        this.log.error('Refresh error:', String(e));
      }
    }
  
    setTimeout(async () => await this.refresh(), 1000);
  }

  public onMQTTMessage(topic: string, protocol: TuyaMQTTProtocol, message) {
    switch(protocol) {
      case TuyaMQTTProtocol.DEVICE_STATUS_UPDATE: {
        const {devId, status} = message;
        if (devId === this.config.id) {
          const currPower = status.find((property) => property.code === 'cur_power');
          if (currPower) {
            this.incomingData(currPower.value);
          }
        }
        break;
      }
    }
  }

  private async getInitialDeviceInfo() {
    try {
      const response = await this.tuyaAPI.get(`/v1.0/devices/${this.config.id}`);
      if (response.result && response.result.status) {
        const currPower = response.result.status.find((property) => property.code === 'cur_power');
        if (currPower) {
          this.log.info(`Connected to ${this.config.name}`);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        this.log.error(`Could not get device ${this.config.name}`, error.message);
      } else {
        this.log.error(`Could not get device ${this.config.name}`, String(error));
      }
      throw error;
    }
  }

  private incomingData(value: number) {
    if (value > this.config.startValue) {
      if (!this.isActive && !this.startDetected) {
        this.startDetected = true;
        this.startDetectedTime = DateTime.now();
        this.log.debug(`Detected start value, waiting for ${this.config.startDuration} seconds...`);
      }
    } else {
      this.startDetected = false;
      this.startDetectedTime = undefined;
    }

    if (value < this.config.endValue) {
      if (this.isActive && !this.endDetected) {
        this.endDetected = true;
        this.endDetectedTime = DateTime.now();
        this.log.debug(`Detected end value, waiting for ${this.config.startDuration} seconds...`);
      }
    } else {
      this.endDetected = false;
      this.endDetectedTime = undefined;
    }
  }

  async sendPower(deviceID: string, value: boolean) {
    await this.tuyaAPI.post(`/v1.0/devices/${deviceID}/commands`, { commands: [{ code: 'switch_1', value }] });
  }
}
