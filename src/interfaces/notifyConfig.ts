export interface NotifyConfig {
    pushed?: PushedConfig;
    telegramBotToken?: string;
    laundryDevices?: LaundryDeviceConfig[];
    tuyaApiCredentials?: TuyaApiCredentials; // Separate Section for API Credentials
}

export interface TuyaApiCredentials {  // New Interface for Tuya API Credentials
    accessId: string;                // Tuya Access ID
    accessKey: string;               // Tuya Access Key
    countryCode: string;             // Country Code (e.g., '49' for Germany)
    username: string;                // Tuya account username
    password: string;                // Tuya account password
    endpoint: string;                // API endpoint, e.g., 'https://openapi.tuyaeu.com'
    appSchema: string;               // The app schema, e.g., 'smartlife'
}

export interface PushedConfig {
    appKey: string;
    appSecret: string;
    channelAlias: string;
}

export interface LaundryDeviceConfig {
    id: string;                  // Tuya Device ID
    name?: string;               // Optional device name
    key: string;                 // Tuya Device Key for local communication
    ipAddress: string;           // Device's local IP address
    powerValueId: string;        // DPS code for power consumption
    startValue: number;          // Power value to detect when the device starts
    startDuration: number;       // Time required to consider the device started
    endValue: number;            // Power value to detect when the device has ended
    endDuration: number;         // Time required to consider the device ended
    startMessage?: string;       // Message sent when the cycle starts
    endMessage?: string;         // Message sent when the cycle ends
    exposeStateSwitch?: boolean; // Expose switch for automation
}