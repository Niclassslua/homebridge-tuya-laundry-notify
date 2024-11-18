import { Logger } from 'homebridge';
import { TuyaApiCredentials } from '../interfaces/notifyConfig';
import TuyaOpenAPI from '../core/TuyaOpenAPI';

export class TuyaApiService {
  private static instance: TuyaApiService;
  private apiInstance: TuyaOpenAPI | null = null;

  private constructor(
    private credentials: TuyaApiCredentials,
    private log: Logger
  ) {}

  public static getInstance(credentials: TuyaApiCredentials, log: Logger): TuyaApiService {
    if (!TuyaApiService.instance) {
      TuyaApiService.instance = new TuyaApiService(credentials, log);
    }
    return TuyaApiService.instance;
  }

  public async authenticate(): Promise<void> {
    const { accessId, accessKey, username, password, countryCode, endpoint, appSchema } = this.credentials;

    this.apiInstance = new TuyaOpenAPI(endpoint, accessId, accessKey);

    try {
      const res = await this.apiInstance.homeLogin(
        Number(countryCode),
        username,
        password,
        appSchema
      );
      if (res && res.success) {
        this.log.info('Successfully authenticated with Tuya OpenAPI.');
      } else {
        this.log.error('Authentication failed:', res ? res.msg : 'No response from API');
        this.apiInstance = null;
      }
    } catch (error) {
      this.log.error('Error during Tuya API authentication:', error);
      this.apiInstance = null;
    }
  }

  public getApiInstance(): TuyaOpenAPI | null {
    return this.apiInstance;
  }
}
