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
    id: string;
    name?: string;
    key: string;
    ipAddress: string;
    powerValueId: string;
    startValue: number;
    startDuration: number;
    endValue: number;
    endDuration: number;
    startMessage?: string;
    endMessage?: string;
    exposeStateSwitch?: boolean;
    protocolVersion?: string;
}