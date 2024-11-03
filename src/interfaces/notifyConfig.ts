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
    notifications?: {
        pushed?: PushedConfig;
        telegram?: TelegramConfig;
        ntfy?: NtfyConfig;
    };
    laundryDevices?: LaundryDeviceConfig[];
    tuyaApiCredentials?: TuyaApiCredentials;
}

export interface PushedConfig {
    appKey: string;
    appSecret: string;
    channelAlias: string;
}

export interface TelegramConfig {
    botToken: string;                  // Telegram Bot Token for notifications
}

export interface NtfyConfig {
    title: string;                     // ntfy title for notifications
    topic: string;                     // ntfy topic for notifications
    serverUrl?: string;                // Optional custom server URL (default: https://ntfy.sh)
}

export interface LaundryDeviceConfig {
    deviceId: string;                  // Tuya Device ID
    name?: string;                     // Optional device name
    localKey: string;                  // Tuya Device Key for local communication
    ipAddress: string;                 // Device's local IP address
    powerValueId: string;              // DPS code for power consumption
    startValue: number;                // Power value threshold to detect start
    startDuration: number;             // Time required to confirm start
    endValue: number;                  // Power value threshold to detect end
    endDuration: number;               // Time required to confirm end
    startMessage?: string;             // Message sent at the start of the cycle
    endMessage?: string;               // Message sent at the end of the cycle
    exposeStateSwitch?: boolean;       // Option to expose a switch for automation
    protocolVersion?: string;          // Optional protocol version field
}
