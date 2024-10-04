export interface TuyaApiCredentials {
    accessId: string;
    accessKey: string;
    countryCode: number;
    username: string;
    password: string;
    appSchema: string;
    endpoint: string;
}

export interface NotifyConfig {
    pushed?: PushedConfig;
    telegramBotToken?: string;
    laundryDevices?: LaundryDeviceConfig[];
    tuyaApiCredentials?: TuyaApiCredentials; // Verwende TuyaApiCredentials hier
}

export interface PushedConfig {
    appKey: string;
    appSecret: string;
    channelAlias: string;
}

export interface LaundryDeviceConfig {
    deviceId: string;                  // Tuya Device ID
    name?: string;               // Optional device name
    localKey: string;                 // Tuya Device Key for local communication
    ipAddress: string;           // Device's local IP address
    powerValueId: string;        // DPS code for power consumption
    startValue: number;          // Power value to detect when the device starts
    startDuration: number;       // Time required to consider the device started
    endValue: number;            // Power value to detect when the device has ended
    endDuration: number;         // Time required to consider the device ended
    startMessage?: string;       // Message sent when the cycle starts
    endMessage?: string;         // Message sent when the cycle ends
    exposeStateSwitch?: boolean; // Expose switch for automation
    protocolVersion?: string;    // Optional protocol version
}