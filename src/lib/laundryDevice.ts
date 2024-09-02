import EventEmitter from 'events';
import {Logger} from 'homebridge';
import TuyaOpenAPI from '../core/TuyaOpenAPI';

export class LaundryDevice extends EventEmitter {
  public refreshDelay = 5000;
  private refreshInterval?: NodeJS.Timeout;
  private connected = false;

  constructor(
    private readonly log: Logger,
    private readonly id: string,
    private readonly tuyaAPI: TuyaOpenAPI,
    private readonly name: string = 'the device',
  ) {
    super();
  }

  public init() {
    this.startRefresh();
  }

  private startRefresh() {
    this.refreshInterval = setInterval(async () => {
      const response = await this.getDeviceInfo();
      if (!this.connected) {
        this.connected = true;
        this.log.info(`Connected to ${this.name}`);
      }
      if (response.result && response.result.status) {
        const currPower = response.result.status.find((property) => property.code === 'cur_power');
        if (currPower) {
          this.emit('data', currPower.value);
        } else {
          this.log.error(`Cannot find curr_power value for ${this.name}`);
        }
      } else {
        this.log.error(`Cannot get response result for ${this.name}`);
      }
      this.emit('refresh');
    }, this.refreshDelay);
  }

  private async getDeviceInfo() {
    try {
      const res = await this.tuyaAPI.get(`/v1.0/devices/${this.id}`);
      return res;
    } catch (error) {
      this.log.error(`Error refreshing data for ${this.name}:`, error.message);
      throw error;
    }
  }
}