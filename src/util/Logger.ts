/* eslint-disable @typescript-eslint/no-explicit-any */

export default interface Logger {
    info(message?: any, ...args: any[]): void;
    warn(message?: any, ...args: any[]): void;
    debug(message?: any, ...args: any[]): void;
    error(message?: any, ...args: any[]): void;
}

export class PrefixLogger {
    constructor(
        public log: Logger,
        public prefix: string,
        public debugMode = false,
    ) {
        this.debugMode = this.debugMode || process.argv.includes('-D') || process.argv.includes('--debug');
    }

    debug(message?: any, ...args: any[]) {
        if (this.debugMode) {
            this.log.info((this.prefix ? `[${this.prefix}] ` : '') + message, ...args);
        } else {
            this.log.debug((this.prefix ? `[${this.prefix}] ` : '') + message, ...args);
        }
    }

    info(message?: any, ...args: any[]) {
        this.log.info((this.prefix ? `[${this.prefix}] ` : '') + message, ...args);
    }

    warn(message?: any, ...args: any[]) {
        this.log.warn((this.prefix ? `[${this.prefix}] ` : '') + message, ...args);
    }

    error(message?: any, ...args: any[]) {
        this.log.error((this.prefix ? `[${this.prefix}] ` : '') + message, ...args);
    }

}