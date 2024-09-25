export interface NotifyConfig {
    pushed?: PushedConfig;
    telegramBotToken?: string;
    laundryDevices?: LaundryDeviceConfig[];
    accessId?: string;
    accessKey?: string;
    countryCode?: number;
    username?: string;
    password?: string;
}

export interface PushedConfig {
    appKey: string;
    appSecret: string;
    channelAlias: string;
}

export interface LaundryDeviceConfig {
    name: string;
    id: string;
    startValue: number;
    startDuration: number;
    endValue: number;
    endDuration: number;
    startMessage?: string;
    endMessage: string;
    exposeStateSwitch?: boolean;
    syncWith?: string;
}