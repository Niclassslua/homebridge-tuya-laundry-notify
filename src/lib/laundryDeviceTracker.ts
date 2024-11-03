import { LaundryDeviceConfig } from '../interfaces/notifyConfig';
import { API, Logger, PlatformAccessory } from 'homebridge';
import { DateTime } from 'luxon';
import { MessageGateway } from './messageGateway';
import { SmartPlugService } from './smartPlugService';

export class LaundryDeviceTracker {
  private startDetected?: boolean;
  private startDetectedTime?: DateTime;
  private isActive?: boolean;
  private endDetected?: boolean;
  private endDetectedTime?: DateTime;
  private cumulativeConsumption = 0; // in watt-seconds (W·s)
  public accessory?: PlatformAccessory;

  constructor(
    public readonly log: Logger,
    public readonly messageGateway: MessageGateway,
    public config: LaundryDeviceConfig,
    public api: API,
    private smartPlugService: SmartPlugService // Inject SmartPlugService
  ) {
    const deviceName = this.config.name || this.config.deviceId;
    this.log.debug(`Initializing LaundryDeviceTracker with config: ${JSON.stringify(this.config, null, 2)}`);
  }

  public async init() {
    const deviceName = this.config.name || this.config.deviceId;

    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue cannot be smaller than endValue.');
    }

    // Sicherstellen, dass der localKey in der Konfiguration vorhanden ist
    if (!this.config.localKey) {
      this.log.error(`Missing localKey for device ${deviceName}. Please provide a valid localKey.`);
      return;
    }

    try {
      const localDevices = await this.smartPlugService.discoverLocalDevices();
      const selectedDevice = localDevices.find(device => device.deviceId === this.config.deviceId);

      if (!selectedDevice) {
        this.log.warn(`Device ${deviceName} not found on LAN.`);
        return;
      }

      // localKey explizit dem gefundenen Gerät hinzufügen
      selectedDevice.localKey = this.config.localKey;
      this.log.info(`Device ${deviceName} found on LAN. Starting power tracking.`);
      await this.refresh(selectedDevice);
    } catch (error) {
      this.log.error(`Error initializing device ${deviceName}: ${error.message}`);
    }
  }

  private async refresh(selectedDevice: any) {
    const deviceName = this.config.name || this.config.deviceId;
    try {
      const dpsStatus = await this.smartPlugService.getLocalDPS(selectedDevice, this.log);
      //this.log.debug(`Full DPS data for ${deviceName}: ${JSON.stringify(dpsStatus?.dps || {}, null, 2)}`);

      const powerValue = dpsStatus?.dps[this.config.powerValueId];
      this.log.debug(`Current power for ${deviceName} (DPS ${this.config.powerValueId}): ${powerValue}`);

      if (typeof powerValue !== 'number') {
        this.log.error(`Received invalid power value: ${powerValue} (expected a number).`);
        return;
      }

      this.incomingData(powerValue);

      if (this.isActive) {
        this.cumulativeConsumption += powerValue; // add as watt-second (W·s)
      }

      if (!this.isActive && this.startDetected && this.startDetectedTime) {
        const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
        if (secondsDiff > this.config.startDuration) {
          this.log.info(`${deviceName} started the job!`);
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
          this.log.info(`${deviceName} finished the job!`);

          // Calculate total kWh
          const kWhConsumed = this.cumulativeConsumption / 3600000; // Convert watt-seconds to kWh
      
          const endMessage = `${this.config.endMessage || ''} Totalverbrauch: ${kWhConsumed.toFixed(2)} kWh.`;
          await this.messageGateway.send(endMessage);
      
          this.isActive = false;
          this.updateAccessorySwitchState(false);
          this.cumulativeConsumption = 0; // Reset for next cycle
        }
      }
    } catch (error) {
      this.log.error(`Error refreshing device ${deviceName}: ${error.message}`);
    }

    setTimeout(() => this.refresh(selectedDevice), 1000);
  }

  private incomingData(value: number) {
    const deviceName = this.config.name || this.config.deviceId;
    this.log.debug(`Processing incoming power data for ${deviceName}: ${value}`);

    if (value >= this.config.startValue) {
      if (!this.isActive && !this.startDetected) {
        this.startDetected = true;
        this.startDetectedTime = DateTime.now();
        this.log.debug(`Detected start value for ${deviceName}. Waiting ${this.config.startDuration} seconds for confirmation.`);
      }
    } else {
      this.startDetected = false;
      this.startDetectedTime = undefined;
    }

    if (value <= this.config.endValue) {
      if (this.isActive && !this.endDetected) {
        this.endDetected = true;
        this.endDetectedTime = DateTime.now();
        this.log.debug(`Detected end value for ${deviceName}. Waiting ${this.config.endDuration} seconds for confirmation.`);
      }
    } else {
      this.endDetected = false;
      this.endDetectedTime = undefined;
    }
  }

  private updateAccessorySwitchState(isOn: boolean) {
    if (this.config.exposeStateSwitch && this.accessory) {
      const service = this.accessory.getService(this.api.hap.Service.Switch);
      service?.setCharacteristic(this.api.hap.Characteristic.On, isOn);
      this.log.debug(`Updated accessory switch state for ${this.config.name}: ${isOn ? 'On' : 'Off'}`);
    }
  }
}
