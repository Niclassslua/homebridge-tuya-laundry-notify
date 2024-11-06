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
  private lastDpsStatus: any = null; // Cached last DPS status
  private currentInterval = 5000; // Dynamic update interval in milliseconds
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
        const powerValue = await this.getPowerValue(selectedDevice);

        if (typeof powerValue !== 'number') {
          this.log.error(`Received invalid power value: ${powerValue} (expected a number).`);
          return;
        }

        this.log.debug(`Current power for ${deviceName}: ${powerValue}W`);
        this.incomingData(powerValue);

        // Run the helper method to check start and stop conditions
        await this.checkStartStopConditions(deviceName, powerValue);

      } catch (error) {
        this.log.error(`Error during start/stop detection: ${error.message}`);
      }
    }, this.currentInterval);
  }

  // Helper method to get power value with caching
  private async getPowerValue(selectedDevice: any): Promise<number | null> {
    const dpsStatus = await this.smartPlugService.getLocalDPS(selectedDevice, this.log);

    if (JSON.stringify(dpsStatus) === JSON.stringify(this.lastDpsStatus)) {
      this.log.debug(`No change in device status for ${selectedDevice.deviceId}, skipping further checks.`);
      return this.lastDpsStatus?.dps[this.config.powerValueId];
    }

    this.lastDpsStatus = dpsStatus;

    // Explizit prüfen, ob powerValue definiert ist, um 0 als gültigen Wert zu akzeptieren
    const powerValue = dpsStatus?.dps[this.config.powerValueId];
    return powerValue !== undefined ? powerValue : null;
  }

  // Method to dynamically adjust the interval based on activity
  private adjustInterval(isActive: boolean) {
    this.currentInterval = isActive ? 1000 : 5000; // 1 second when active, 5 seconds when idle
    this.log.debug(`Adjusted polling interval to ${this.currentInterval}ms based on activity.`);
  }

  // Helper method to check start and stop conditions
  private async checkStartStopConditions(deviceName: string, powerValue: number) {
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
        this.adjustInterval(true); // Switch to a more frequent interval
      }
    }

    // Accumulate energy consumption if the machine is running
    if (this.isActive) {
      const now = DateTime.now();
      const timeDiff = now.diff(this.lastMeasurementTime, 'seconds').seconds;
      this.lastMeasurementTime = now;

      const energyConsumed = (powerValue / 10) * timeDiff; // in watt-seconds (W-s)
      this.cumulativeConsumption += energyConsumed;

      this.log.debug(`Added ${energyConsumed} W·s. Total cumulativeConsumption: ${this.cumulativeConsumption} W·s, ${(this.cumulativeConsumption / 3600000).toFixed(4)} kWh`);
    }

    // Check whether the machine has stopped
    if (this.endDetected && this.endDetectedTime) {
      const secondsDiff = DateTime.now().diff(this.endDetectedTime, 'seconds').seconds;
      if (secondsDiff > this.config.endDuration && this.isActive) {
        this.isActive = false;
        const kWhConsumed = this.cumulativeConsumption / 3600000; // Convert watt-seconds to kWh
        this.log.info(`Device finished the job. Total consumption: ${kWhConsumed.toFixed(2)} kWh`);
        const endMessage = `${this.config.endMessage || ''} Total consumption: ${kWhConsumed.toFixed(2)} kWh.`;
        this.messageGateway.send(endMessage);
        this.updateAccessorySwitchState(false);
        this.cumulativeConsumption = 0; // Reset for the next cycle
        this.endDetected = false; // Reset end detection
        this.endDetectedTime = undefined;
        this.adjustInterval(false); // Switch to a less frequent interval
      }
    }
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