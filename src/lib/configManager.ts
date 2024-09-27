import { PlatformConfig } from 'homebridge';
import { NotifyConfig } from '../interfaces/notifyConfig';

export class ConfigManager {
  constructor(private config: PlatformConfig & NotifyConfig) {}

  public getConfig() {
    const { accessId, accessKey, endpoint, countryCode, username, password, appSchema } = this.config;
    const effectiveEndpoint = endpoint ?? 'https://openapi.tuyaeu.com';

    if (!accessId || !accessKey || !effectiveEndpoint) {
      throw new Error('Access ID, Access Key, and Endpoint must be specified in the configuration.');
    }

    return {
      accessId,
      accessKey,
      endpoint: effectiveEndpoint,
      countryCode,
      username,
      password,
      appSchema
    };
  }
}