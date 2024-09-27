import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from 'homebridge';
import { PlatformConfig } from 'homebridge';
import { CommandHandler } from './commandHandler';  // Importiere den CommandHandler
import { SmartPlugService } from './smartPlugService';  // Importiere den SmartPlugService

export class IPCServer {
  private server: net.Server | undefined;
  private readonly socketPath: string;
  private commandHandler: CommandHandler;  // Erstelle eine Instanz des CommandHandlers

  constructor(private log: Logger, private config: PlatformConfig, private smartPlugService: SmartPlugService) {
    this.socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');
    this.commandHandler = new CommandHandler(log, smartPlugService);  // Übergib sowohl log als auch den SmartPlugService
  }

  public start() {
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer((connection) => {
      this.log.info('Connection received via IPC server');
      this.commandHandler.showHelp(connection);

      connection.write('> ');

      connection.setEncoding('utf8');

      connection.on('data', async (data: string | Buffer) => {
        const input = data.toString().trim();

        this.log.info(`Command received via IPC: "${input}"`);

        // Übergibt den Befehl an den CommandHandler zur Verarbeitung
        this.commandHandler.handleCommand(input, connection);  // Jetzt mit der connection
      });
    });

    this.server.listen(this.socketPath, () => {
      this.log.info(`IPC server listening at ${this.socketPath}`);
    });

    this.server.on('error', (err: Error) => {
      this.log.error(`Error with IPC server: ${err.message}`);
    });
  }

  public stop() {
    if (this.server) {
      this.server.close(() => this.log.info('IPC server stopped.'));
    }
  }
}