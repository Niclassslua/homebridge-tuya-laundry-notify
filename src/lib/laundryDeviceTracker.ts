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
  private lastMeasurementTime: DateTime = DateTime.now(); // Time of the last measurement
  public accessory?: PlatformAccessory;

  constructor(
    public readonly log: Logger,
    public readonly messageGateway: MessageGateway,
    public config: LaundryDeviceConfig,
    public api: API,
    private smartPlugService: SmartPlugService
  ) {
    const deviceName = this.config.name || this.config.deviceId;
    this.log.debug(`Initializing LaundryDeviceTracker with config: ${JSON.stringify(this.config, null, 2)}`);
  }

  public async init() {
    const deviceName = this.config.name || this.config.deviceId;

    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue cannot be smaller than endValue.');
    }

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

      selectedDevice.localKey = this.config.localKey;
      this.log.info(`Device ${deviceName} found on LAN. Starting power tracking.`);
      
      this.detectStartStop(selectedDevice);
    } catch (error) {
      this.log.error(`Error initializing device ${deviceName}: ${error.message}`);
    }
  }

  private async detectStartStop(selectedDevice: any) {
    setInterval(async () => {
      try {
        const deviceName = this.config.name || this.config.deviceId;
        const dpsStatus = await this.smartPlugService.getLocalDPS(selectedDevice, this.log);
        const powerValue = dpsStatus?.dps[this.config.powerValueId];

        if (typeof powerValue !== 'number') {
          this.log.error(`Received invalid power value: ${powerValue} (expected a number).`);
          return;
        }

        this.log.debug(`Current power for ${deviceName}: ${powerValue}W`);

        // Start detection whether the device is running
        this.incomingData(powerValue);

        // Check whether the machine started
        if (!this.isActive && this.startDetected && this.startDetectedTime) {
          const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
          this.log.debug(`Checking start confirmation: ${secondsDiff} seconds since start detected.`);
          
          if (secondsDiff > this.config.startDuration) {
            this.log.info(`${deviceName} has started!`);
            if (this.config.startMessage) {
              await this.messageGateway.send(this.config.startMessage);
            }
            this.isActive = true;
            this.updateAccessorySwitchState(true);
            this.cumulativeConsumption = 0; // Reset cumulative consumption for the new cycle
            this.startDetected = false; // Reset start detection
            this.startDetectedTime = undefined;
          }
        }

        if (this.isActive) {
          // When the machine is running, monitor consumption
          const now = DateTime.now();
          const timeDiff = now.diff(this.lastMeasurementTime, 'seconds').seconds;
          this.lastMeasurementTime = now;

          // Calculate the consumption in this period
          const energyConsumed = (powerValue / 10) * timeDiff; // in watt seconds (W-s)
          this.cumulativeConsumption += energyConsumed;

          this.log.debug(`Added ${energyConsumed} W·s. Total cumulativeConsumption: ${this.cumulativeConsumption} W·s, ${(this.cumulativeConsumption / 3600000).toFixed(4)} kWh`);
        }

        // Check whether the machine has stopped
        if (this.endDetected && this.endDetectedTime) {
          const secondsDiff = DateTime.now().diff(this.endDetectedTime, 'seconds').seconds;
          if (secondsDiff > this.config.endDuration && this.isActive) {
            this.isActive = false;
            const kWhConsumed = this.cumulativeConsumption / 3600000; // Convert watt seconds to kWh
            this.log.info(`Device finished the job. Total consumption: ${kWhConsumed.toFixed(2)} kWh`);
            const endMessage = `${this.config.endMessage || ''} Totalverbrauch: ${kWhConsumed.toFixed(2)} kWh.`;
            this.messageGateway.send(endMessage);
            this.updateAccessorySwitchState(false);
            this.cumulativeConsumption = 0; // Reset for the next cycle
          }
        }
      } catch (error) {
        this.log.error(`Error during start/stop detection: ${error.message}`);
      }
    }, 1000); // Check every second
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