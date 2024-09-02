import {LaundryDeviceConfig} from '../interfaces/notifyConfig';
import {PushGateway} from './pushGateway';
import {DeviceData} from 'tuyapi';
import {API, Logger, PlatformAccessory} from 'homebridge';
import {DateTime} from 'luxon';
import {LaundryDevice} from './laundryDevice';
import TuyaOpenAPI from '../core/TuyaOpenAPI';
import {MessageGateway} from './messageGateway';

export class LaundryDeviceTracker {
  private device?: LaundryDevice;
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

  public init() {
    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue cannot be lower than endValue.');
    }

    this.device = new LaundryDevice(this.log, this.config.id, this.tuyaAPI, this.config.name);

    this.device.on('data', (powerValue: number) => {
      this.incomingData(powerValue);
    });

    this.device.on('refresh', () => {
      if (!this.isActive && this.startDetected && this.startDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.startDuration) {
          this.log.info(`${this.config.name} started the job!`);
          if (this.config.startMessage) {
            this.messageGateway.send(this.config.startMessage);
          }
          this.isActive = true;
          if (this.config.exposeStateSwitch && this.accessory) {
            const service = this.accessory.getService(this.api.hap.Service.Switch);
            service?.setCharacteristic(this.api.hap.Characteristic.On, true);
          }
          if (this.config.syncWith) {
            this.sendPower(this.config.syncWith, true);
          }
        }
      }
      if (this.isActive && this.endDetected && this.endDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.endDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.endDuration) {
          this.log.info(`${this.config.name} finished the job!`);
          // send push here if needed
          if (this.config.endMessage) {
            this.messageGateway.send(this.config.endMessage);
          }
          if (this.config.exposeStateSwitch && this.accessory) {
            const service = this.accessory.getService(this.api.hap.Service.Switch);
            service?.setCharacteristic(this.api.hap.Characteristic.On, false);
          }
          this.isActive = false;
          if (this.config.syncWith) {
            this.sendPower(this.config.syncWith, false);
          }
        }
      }
    });

    this.device.init();
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
