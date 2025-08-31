import { LaundryDeviceConfig } from '../interfaces/notifyConfig';
import { API, Logger, PlatformAccessory } from 'homebridge';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { MessageGateway } from './messageGateway';
import { SmartPlugService } from './smartPlugService';

interface PowerMeasurement {
  watt: number | null;
  voltage?: number;
  current?: number;
  rawDps: any;
}

interface PowerLogEntry {
  timestamp: string;
  watt: number;
  deltaWs: number;
  totalKWh: number;
  isActive: boolean;
  interval: number;
  rawDps: any;
  voltage?: number;
  current?: number;
}

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
  private powerLog: PowerLogEntry[] = [];
  private startTime?: DateTime;
  private endTime?: DateTime;
  private minPower = Number.POSITIVE_INFINITY;
  private maxPower = 0;
  private totalPower = 0;
  private sampleCount = 0;
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

  public async init(localDevices?: any[]) {
    const deviceName = this.config.name || this.config.deviceId;

    if (this.config.startValue < this.config.endValue) {
      throw new Error('startValue cannot be smaller than endValue.');
    }

    if (!this.config.localKey) {
      this.log.error(`Missing localKey for device ${deviceName}. Please provide a valid localKey.`);
      return;
    }

    try {
      const devices = localDevices ?? await this.smartPlugService.discoverLocalDevices();
      const selectedDevice = devices.find(device => device.deviceId === this.config.deviceId);

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
        const powerData = await this.getPowerValue(selectedDevice);

        if (typeof powerData.watt !== 'number') {
          this.log.error(`Received invalid power value: ${powerData.watt} (expected a number).`);
          return;
        }

        this.log.debug(`Current power for ${deviceName}: ${powerData.watt}W`);
        this.incomingData(powerData.watt);

        // Run the helper method to check start and stop conditions
        await this.checkStartStopConditions(deviceName, powerData);

      } catch (error) {
        this.log.error(`Error during start/stop detection: ${error.message}`);
      }
    }, this.currentInterval);
  }

  // Helper method to get power value with caching
  private async getPowerValue(selectedDevice: any): Promise<PowerMeasurement> {
    const dpsStatus = await this.smartPlugService.getLocalDPS(selectedDevice, this.log);

    if (JSON.stringify(dpsStatus) === JSON.stringify(this.lastDpsStatus)) {
      this.log.debug(`No change in device status for ${selectedDevice.deviceId}, skipping further checks.`);
      const cached = this.lastDpsStatus?.dps[this.config.powerValueId];
      return { watt: cached !== undefined ? cached : null, rawDps: this.lastDpsStatus };
    }

    this.lastDpsStatus = dpsStatus;

    // Explizit prüfen, ob powerValue definiert ist, um 0 als gültigen Wert zu akzeptieren
    const powerValue = dpsStatus?.dps[this.config.powerValueId];
    const voltage = dpsStatus?.dps['20'];
    const current = dpsStatus?.dps['18'];
    return {
      watt: powerValue !== undefined ? powerValue : null,
      voltage,
      current,
      rawDps: dpsStatus,
    };
  }

  // Method to dynamically adjust the interval based on activity
  private adjustInterval(isActive: boolean) {
    this.currentInterval = isActive ? 1000 : 5000; // 1 second when active, 5 seconds when idle
    this.log.debug(`Adjusted polling interval to ${this.currentInterval}ms based on activity.`);
  }

  // Helper method to check start and stop conditions
  private async checkStartStopConditions(deviceName: string, powerData: PowerMeasurement) {
    const powerValue = powerData.watt as number;

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
        this.startTime = DateTime.now();
        this.powerLog = [];
        this.lastMeasurementTime = DateTime.now();
        this.minPower = Number.POSITIVE_INFINITY;
        this.maxPower = 0;
        this.totalPower = 0;
        this.sampleCount = 0;
      }
    }

    const now = DateTime.now();
    const timeDiff = now.diff(this.lastMeasurementTime, 'seconds').seconds;
    this.lastMeasurementTime = now;

    const powerW = powerValue / 10;
    const energyConsumed = powerW * timeDiff; // in watt-seconds (W-s)

    if (this.isActive) {
      this.cumulativeConsumption += energyConsumed;
      this.minPower = Math.min(this.minPower, powerW);
      this.maxPower = Math.max(this.maxPower, powerW);
      this.totalPower += powerW;
      this.sampleCount++;
    }

    const totalKWh = this.cumulativeConsumption / 3600000;

    if (this.config.exportPowerLog && (this.isActive || this.startDetected || this.endDetected)) {
      this.powerLog.push({
        timestamp: now.toISO(),
        watt: powerW,
        deltaWs: energyConsumed,
        totalKWh,
        isActive: !!this.isActive,
        interval: this.currentInterval,
        rawDps: powerData.rawDps,
        voltage: powerData.voltage,
        current: powerData.current,
      });
    }

    if (this.isActive) {
      this.log.debug(`Added ${energyConsumed} W·s. Total cumulativeConsumption: ${this.cumulativeConsumption} W·s, ${totalKWh.toFixed(4)} kWh`);
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

        this.endTime = DateTime.now();
        const durationSec = this.startTime ? this.endTime.diff(this.startTime, 'seconds').seconds : 0;
        const avgPower = this.sampleCount > 0 ? this.totalPower / this.sampleCount : 0;
        if (this.config.exportPowerLog) {
          await this.exportPowerLog({
            startTime: this.startTime?.toISO(),
            endTime: this.endTime.toISO(),
            durationSec,
            minPower: this.minPower === Number.POSITIVE_INFINITY ? 0 : this.minPower,
            maxPower: this.maxPower,
            avgPower,
            totalKWh: kWhConsumed,
          });
        }

        this.cumulativeConsumption = 0; // Reset for the next cycle
        this.endDetected = false; // Reset end detection
        this.endDetectedTime = undefined;
        this.adjustInterval(false); // Switch to a less frequent interval
        this.powerLog = [];
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

  private async exportPowerLog(stats: {
    startTime?: string;
    endTime: string;
    durationSec: number;
    minPower: number;
    maxPower: number;
    avgPower: number;
    totalKWh: number;
  }) {
    try {
      const deviceId = this.config.deviceId;
      const timestamp = (stats.endTime || DateTime.now().toISO()).replace(/:/g, '-');
      const dir = path.resolve('logs');
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${deviceId}-${timestamp}.json`);
      const data = JSON.stringify({ ...stats, powerLog: this.powerLog }, null, 2);
      await fs.promises.writeFile(filePath, data);
      this.log.info(`Exported power log to ${filePath}`);
      this.powerLog = [];
    } catch (error) {
      this.log.error(`Failed to export power log: ${error.message}`);
    }
  }
}