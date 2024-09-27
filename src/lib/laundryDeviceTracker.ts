import { LaundryDeviceConfig } from '../interfaces/notifyConfig';
import { API, Logger, PlatformAccessory } from 'homebridge';
import { DateTime } from 'luxon';
import TuyAPI from 'tuyapi';  // Import TuyAPI for LAN control
import { MessageGateway } from './messageGateway';

export class LaundryDeviceTracker {
  private startDetected?: boolean;
  private startDetectedTime?: DateTime;
  private isActive?: boolean;
  private endDetected?: boolean;
  private endDetectedTime?: DateTime;
  private tuyapiDevice: any;  // Store TuyAPI device instance
  public accessory?: PlatformAccessory;

  constructor(
    public readonly log: Logger,
    public readonly messageGateway: MessageGateway,
    public config: LaundryDeviceConfig,
    public api: API,
  ) {
    // Initialize TuyAPI device for local LAN control
    this.tuyapiDevice = new TuyAPI({
      id: this.config.id,
      key: this.config.key,
      ip: this.config.ipAddress,
      version: this.config.protocolVersion || '3.3',  // Default to version 3.3
    });
  }

  public async init() {
    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue cannot be smaller than endValue.');
    }

    if (!this.config.id || !this.config.key || !this.config.ipAddress) {
      this.log.warn(`Device ${this.config.name} is missing required configuration (ID, Key, or IP). Initialization skipped.`);
      return;
    }

    try {
      // Find and connect to the device on the local network
      await this.tuyapiDevice.find();
      await this.tuyapiDevice.connect();
      this.log.info(`Connected to ${this.config.name} over LAN.`);

      // Start power monitoring
      await this.refresh();
    } catch (error) {
      this.log.error(`Error initializing device ${this.config.name}: ${error.message}`);
    }
  }

  // Poll the device for updates every second
  private async refresh() {
    try {
      // Fetch the current power status
      const powerValue = await this.tuyapiDevice.get({ dps: this.config.powerValueId || '18' });  // Assuming DPS '18' for power value
      this.log.debug(`${this.config.name} current power: ${powerValue}`);

      this.incomingData(powerValue);

      if (!this.isActive && this.startDetected && this.startDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.startDuration) {
          this.log.info(`${this.config.name} started the job!`);
          if (this.config.startMessage) {
            await this.messageGateway.send(this.config.startMessage);
          }
          this.isActive = true;
          this.updateAccessorySwitchState(true);
        }
      }

      if (this.isActive && this.endDetected && this.endDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.endDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.endDuration) {
          this.log.info(`${this.config.name} finished the job!`);
          if (this.config.endMessage) {
            await this.messageGateway.send(this.config.endMessage);
          }
          this.isActive = false;
          this.updateAccessorySwitchState(false);
        }
      }
    } catch (error) {
      this.log.error(`Error refreshing device ${this.config.name}: ${error.message}`);
    }

    // Poll again after 1 second
    setTimeout(() => this.refresh(), 1000);
  }

  // Handle incoming data (power consumption)
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
        this.log.debug(`Detected end value, waiting for ${this.config.endDuration} seconds...`);
      }
    } else {
      this.endDetected = false;
      this.endDetectedTime = undefined;
    }
  }

  // Update the accessory switch state (if applicable)
  private updateAccessorySwitchState(isOn: boolean) {
    if (this.config.exposeStateSwitch && this.accessory) {
      const service = this.accessory.getService(this.api.hap.Service.Switch);
      service?.setCharacteristic(this.api.hap.Characteristic.On, isOn);
    }
  }
}