import { LaundryDeviceConfig } from '../interfaces/notifyConfig';
import { API, Logger, PlatformAccessory } from 'homebridge';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { MessageGateway } from './messageGateway';
import { SmartPlugService } from './smartPlugService';
import { errorMessage } from './errors';

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
  private cumulativeConsumption = 0; // watt-seconds (Ws) for the current run
  private cumulativeSinceStartDetected = 0; // Ws accumulated since startDetectedTime when inside after-run window (used to delay start confirmation)
  private lastMeasurementTime: DateTime = DateTime.now();
  private lastDpsStatus: any = null;
  private currentInterval = 5000; // polling interval in ms (1s when active, 5s when idle)
  private powerLog: PowerLogEntry[] = [];
  private startTime?: DateTime;
  private endTime?: DateTime;
  private minPower = Number.POSITIVE_INFINITY;
  private maxPower = 0;
  private totalPower = 0;
  private sampleCount = 0;
  private lastFullCycleEndTime?: DateTime; // set when a run that met min-run criteria ended (used for after-run window)
  private dryRunRuns: Array<{ startTime: string; endTime: string; durationSec: number; totalKWh: number; avgPower: number; maxPower: number }> = [];
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
      this.log.error(`Error initializing device ${deviceName}: ${errorMessage(error)}`);
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
        this.log.error(`Error during start/stop detection: ${errorMessage(error)}`);
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

    // Check powerValue is defined so that 0 is treated as a valid reading
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

  /** True if any min-run criteria are configured (used to distinguish full cycles from short after-run cycles). */
  private hasMinRunCriteriaConfigured(): boolean {
    const c = this.config;
    return (
      (c.minRunDurationSec !== undefined && c.minRunDurationSec !== null) ||
      (c.minRunKWh !== undefined && c.minRunKWh !== null) ||
      (c.minRunAvgPowerW !== undefined && c.minRunAvgPowerW !== null)
    );
  }

  /** After-run window in minutes (supports deprecated nachlaufWindowMin for backward compatibility). */
  private getAfterRunWindowMin(): number | undefined | null {
    const c = this.config as LaundryDeviceConfig & { nachlaufWindowMin?: number };
    return c.afterRunWindowMin ?? c.nachlaufWindowMin;
  }

  /** True if we are within the after-run window (minutes after last full cycle end). Inside this window, start is only confirmed once min-run criteria are met. */
  private isInsideAfterRunWindow(): boolean {
    const windowMin = this.getAfterRunWindowMin();
    if (windowMin === undefined || windowMin === null || !this.lastFullCycleEndTime) return false;
    const minutesSince = DateTime.now().diff(this.lastFullCycleEndTime, 'minutes').minutes;
    return minutesSince < windowMin;
  }

  /** True if the run (duration, energy, avg power) meets all configured min-run criteria (i.e. counts as a full cycle). */
  private meetsMinRunCriteria(durationSec: number, totalKWh: number, avgPower: number): boolean {
    const c = this.config;
    if (c.minRunDurationSec !== undefined && c.minRunDurationSec !== null && durationSec < c.minRunDurationSec)
      return false;
    if (c.minRunKWh !== undefined && c.minRunKWh !== null && totalKWh < c.minRunKWh) return false;
    if (c.minRunAvgPowerW !== undefined && c.minRunAvgPowerW !== null && avgPower < c.minRunAvgPowerW) return false;
    return true;
  }

  // Helper method to check start and stop conditions
  private async checkStartStopConditions(deviceName: string, powerData: PowerMeasurement) {
    const powerValue = powerData.watt as number;

    // Check whether the machine started
    if (!this.isActive && this.startDetected && this.startDetectedTime) {
      const secondsDiff = DateTime.now().diff(this.startDetectedTime, 'seconds').seconds;
      const kWhSinceStart = this.cumulativeSinceStartDetected / 3600000;
      this.log.debug(`Checking start confirmation: ${secondsDiff} seconds since start detected, ${kWhSinceStart.toFixed(4)} kWh since start.`);

      let shouldConfirmStart = false;
      if (this.getAfterRunWindowMin() != null && this.isInsideAfterRunWindow()) {
        // Inside after-run window: confirm start only when min-run criteria are already met (avoids false start on after-run power spikes)
        const minDur = this.config.minRunDurationSec;
        const minKWh = this.config.minRunKWh;
        if (minDur != null || minKWh != null) {
          shouldConfirmStart =
            (minDur == null || secondsDiff >= minDur) || (minKWh == null || kWhSinceStart >= minKWh);
        } else {
          shouldConfirmStart = secondsDiff > this.config.startDuration;
        }
      } else {
        shouldConfirmStart = secondsDiff > this.config.startDuration;
      }

      if (shouldConfirmStart) {
        this.log.info(`${deviceName} has started!`);
        if (!this.config.dryRun && this.config.startMessage) {
          await this.messageGateway.send(this.config.startMessage);
        }
        if (this.config.dryRun) {
          this.log.info(`[Dry Run] Run started – no notification sent. Stats will be logged when run ends.`);
        }
        this.isActive = true;
        this.updateAccessorySwitchState(true);
        this.cumulativeConsumption = 0; // Reset cumulative consumption for the new cycle
        this.cumulativeSinceStartDetected = 0;
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
    } else if (this.startDetected && this.isInsideAfterRunWindow()) {
      this.cumulativeSinceStartDetected += energyConsumed;
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
        const kWhConsumed = this.cumulativeConsumption / 3600000; // Convert watt-seconds to kWh
        this.endTime = DateTime.now();
        const durationSec = this.startTime ? this.endTime.diff(this.startTime, 'seconds').seconds : 0;
        const avgPower = this.sampleCount > 0 ? this.totalPower / this.sampleCount : 0;
        const maxPower = this.maxPower;

        if (this.config.dryRun) {
          this.logRunAndSuggestThresholds(durationSec, kWhConsumed, avgPower, maxPower);
        } else {
          const isFullCycle = !this.hasMinRunCriteriaConfigured() || this.meetsMinRunCriteria(durationSec, kWhConsumed, avgPower);

          if (!isFullCycle) {
            this.log.info(
              `Run ignored (short cycle): duration ${durationSec.toFixed(0)}s, ${kWhConsumed.toFixed(4)} kWh, avg ${avgPower.toFixed(1)} W`
            );
          } else {
            this.log.info(`Device finished the job. Total consumption: ${kWhConsumed.toFixed(2)} kWh`);
            const endMessage = `${this.config.endMessage || ''} Total consumption: ${kWhConsumed.toFixed(2)} kWh.`;
            this.messageGateway.send(endMessage);
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
            this.lastFullCycleEndTime = this.endTime;
          }
        }

        this.isActive = false;
        this.updateAccessorySwitchState(false);
        this.cumulativeConsumption = 0; // Reset for the next cycle
        this.endDetected = false; // Reset end detection
        this.endDetectedTime = undefined;
        this.adjustInterval(false); // Switch to a less frequent interval
        this.powerLog = [];
      }
    }
  }

  /** Dry run: record run stats and write suggested thresholds to logs/dry-run-<deviceId>.json */
  private logRunAndSuggestThresholds(durationSec: number, totalKWh: number, avgPower: number, maxPower: number) {
    const deviceName = this.config.name || this.config.deviceId;
    const run = {
      startTime: this.startTime?.toISO() ?? '',
      endTime: this.endTime?.toISO() ?? '',
      durationSec,
      totalKWh,
      avgPower,
      maxPower,
    };
    this.dryRunRuns.push(run);

    this.log.info(
      `[Dry Run] Run finished: duration ${durationSec.toFixed(0)}s, ${totalKWh.toFixed(4)} kWh, avg ${avgPower.toFixed(1)} W, max ${maxPower.toFixed(1)} W`
    );

    const suggested = this.computeSuggestedThresholds();
    const dir = path.resolve('logs');
    const filePath = path.join(dir, `dry-run-${this.config.deviceId}.json`);
    const data = JSON.stringify(
      {
        deviceId: this.config.deviceId,
        deviceName,
        runs: this.dryRunRuns,
        suggested,
        hint: 'Copy suggested values into your device config (minRunDurationSec, minRunKWh, minRunAvgPowerW, afterRunWindowMin). Then set dryRun to false.',
      },
      null,
      2
    );

    fs.promises
      .mkdir(dir, { recursive: true })
      .then(() => fs.promises.writeFile(filePath, data))
      .then(() => {
        this.log.info(`[Dry Run] Suggested thresholds written to ${filePath}`);
      })
      .catch(err => {
        this.log.error(`[Dry Run] Failed to write ${filePath}: ${errorMessage(err)}`);
      });
  }

  /** From recorded runs, suggest min-run thresholds that separate full cycles from short after-run cycles. */
  private computeSuggestedThresholds(): {
    minRunDurationSec: number;
    minRunKWh: number;
    minRunAvgPowerW: number;
    afterRunWindowMin: number;
  } {
    const FULL_CYCLE_MIN_DURATION_SEC = 600;
    const FULL_CYCLE_MIN_KWH = 0.05;
    const fullCycleRuns = this.dryRunRuns.filter(r => r.durationSec >= FULL_CYCLE_MIN_DURATION_SEC && r.totalKWh >= FULL_CYCLE_MIN_KWH);
    const shortCycleRuns = this.dryRunRuns.filter(r => r.durationSec < FULL_CYCLE_MIN_DURATION_SEC || r.totalKWh < FULL_CYCLE_MIN_KWH);

    let minRunDurationSec = 600;
    let minRunKWh = 0.05;
    let minRunAvgPowerW = 100;

    if (fullCycleRuns.length > 0) {
      const minFullDuration = Math.min(...fullCycleRuns.map(r => r.durationSec));
      const minFullKWh = Math.min(...fullCycleRuns.map(r => r.totalKWh));
      const minFullAvgPower = Math.min(...fullCycleRuns.map(r => r.avgPower));
      const maxShortDuration = shortCycleRuns.length > 0 ? Math.max(...shortCycleRuns.map(r => r.durationSec)) : 0;
      const maxShortKWh = shortCycleRuns.length > 0 ? Math.max(...shortCycleRuns.map(r => r.totalKWh)) : 0;
      const maxShortAvgPower = shortCycleRuns.length > 0 ? Math.max(...shortCycleRuns.map(r => r.avgPower)) : 0;

      minRunDurationSec = Math.max(120, Math.round(Math.max(maxShortDuration + 60, minFullDuration * 0.25)));
      minRunKWh = Math.max(0.01, Math.round(Math.max(maxShortKWh * 2, minFullKWh * 0.15) * 100) / 100);
      minRunAvgPowerW = Math.max(50, Math.round(Math.max(maxShortAvgPower * 2, minFullAvgPower * 0.2)));
    }

    return {
      minRunDurationSec,
      minRunKWh,
      minRunAvgPowerW,
      afterRunWindowMin: 30,
    };
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
      this.cumulativeSinceStartDetected = 0;
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
      this.log.error(`Failed to export power log: ${errorMessage(error)}`);
    }
  }
}