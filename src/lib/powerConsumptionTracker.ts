import { Logger } from 'homebridge';

export class PowerConsumptionTracker {
  private powerValues: number[] = [];
  private startThreshold: number | null = null;
  private stopThreshold: number | null = null;

  constructor(private log: Logger) {}

  trackPower(currentDPS: number) {
    this.powerValues.push(currentDPS);
    if (this.powerValues.length > 20) {
      this.powerValues.shift();
    }
    this.calculateThresholds();
  }

  private calculateThresholds() {
    const averagePower = this.powerValues.reduce((sum, val) => sum + val, 0) / this.powerValues.length;
    const stdDev = Math.sqrt(this.powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) / this.powerValues.length);
    this.startThreshold = averagePower + stdDev * 2;
    this.stopThreshold = averagePower + stdDev;
    this.log.info(`New thresholds: Start ${this.startThreshold}, Stop ${this.stopThreshold}`);
  }
}