import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { NotifyConfig } from './interfaces/notifyConfig';
import { IndependentPlatformPlugin } from 'homebridge/lib/api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MessageGateway } from './lib/messageGateway';
import TuyaOpenAPI from './core/TuyaOpenAPI';

import fs from 'fs';
import path from 'path';
import { table } from 'table';
import { DateTime } from 'luxon'; // Importiere Luxon für Zeitstempel
import net from 'net';
import os from 'os';

let Accessory: typeof PlatformAccessory;

export class TuyaLaundryNotifyPlatform implements IndependentPlatformPlugin {
  public readonly typedConfig: PlatformConfig & NotifyConfig;
  public readonly accessories: PlatformAccessory[] = [];
  private apiInstance!: TuyaOpenAPI;
  private tokenInfo = {access_token: '', refresh_token: '', expire: 0};

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('TuyaLaundryNotifyPlatform initialisiert.');
    this.typedConfig = config as PlatformConfig & NotifyConfig;
    Accessory = api.platformAccessory;

    const {accessId, accessKey, endpoint, countryCode, username, password, appSchema} = this.typedConfig;

    const effectiveEndpoint = endpoint ?? 'https://openapi.tuyaeu.com';

    if (!accessId || !accessKey || !effectiveEndpoint) {
      throw new Error('Access ID, Access Key und Endpoint müssen in der Konfiguration angegeben werden.');
    }

    this.log.info(`Zugangsdaten: accessId=${accessId}, accessKey=${accessKey}, endpoint=${effectiveEndpoint}`);

    this.api.on('didFinishLaunching', async () => {
      this.log.info('Homebridge ist gestartet, beginne mit der Initialisierung.');
      await this.initDevices();
      this.startIPCServer();  // Starte IPC-Server
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  async initDevices() {
    const {accessId, accessKey, countryCode, username, password, appSchema, endpoint} = this.typedConfig;

    const effectiveCountryCode = Number(countryCode ?? '49');
    const effectiveUsername = username ?? '';
    const effectivePassword = password ?? '';
    const effectiveAppSchema = appSchema ?? 'tuyaSmart';

    this.apiInstance = new TuyaOpenAPI(endpoint ?? 'https://openapi.tuyaeu.com', accessId ?? '', accessKey ?? '', this.log);
    this.log.info('Log in to Tuya Cloud.');

    const res = await this.apiInstance.homeLogin(effectiveCountryCode, effectiveUsername, effectivePassword, effectiveAppSchema);
    if (res.success === false) {
      this.log.error(`Login failed. code=${res.code}, msg=${res.msg}`);
      return;
    }

    this.log.info('Fetching device list.');
    const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');

    if (!devicesResponse.success) {
      this.log.error(`Fetching device list failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
      return;
    }

    const deviceList = devicesResponse.result?.devices;

    if (!Array.isArray(deviceList)) {
      this.log.error('deviceList is not an array');
      return;
    }

    if (deviceList.length === 0) {
      this.log.warn('No devices found.');
      return;
    }

    const filePath = path.join(this.api.user.persistPath(), 'TuyaDeviceList.json');
    this.log.info('Geräteliste gespeichert unter:', filePath);
    await fs.promises.writeFile(filePath, JSON.stringify(deviceList, null, 2));

    for (const device of deviceList) {
      this.addAccessory(device);
    }
  }

  addAccessory(device: any) {
    const uuid = this.api.hap.uuid.generate(device.id);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
    } else {
      this.log.info('Adding new accessory:', device.name);

      const accessory = new this.api.platformAccessory(device.name, uuid);
      accessory.context.deviceID = device.id;
      accessory.context.deviceKey = device.local_key;
      this.accessories.push(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  async calibratePowerConsumption(deviceId: string, powerValueId: string, connection?: net.Socket) {
    const writeToConnection = (message: string) => {
      if (connection) {
        connection.write(message + '\n');
      } else {
        console.log(message);
      }
    };

    writeToConnection('Kalibrierungsmodus gestartet.');
    writeToConnection('Bitte starte jetzt das Gerät und lasse es für einige Zeit laufen. Drücke Enter, wenn das Gerät aktiv ist.');

    connection?.once('data', async () => {
      const activeValues: number[] = [];
      writeToConnection('Sammle Daten für den aktiven Zustand...');
      for (let i = 0; i < 10; i++) {
        const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
        const currentDPS = (statusResponse.result.find((dps: any) => dps.code === powerValueId)?.value) / 10;
        if (currentDPS !== undefined) {
          activeValues.push(currentDPS);
          writeToConnection(`Aktiver Power-Wert: ${currentDPS} Watt`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      writeToConnection('Bitte schalte jetzt das Gerät aus. Drücke Enter, wenn das Gerät inaktiv ist.');

      connection?.once('data', async () => {
        const inactiveValues: number[] = [];
        writeToConnection('Sammle Daten für den inaktiven Zustand...');
        for (let i = 0; i < 10; i++) {
          const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
          const currentDPS = (statusResponse.result.find((dps: any) => dps.code === powerValueId)?.value) / 10;
          if (currentDPS !== undefined) {
            inactiveValues.push(currentDPS);
            writeToConnection(`Inaktiver Power-Wert: ${currentDPS} Watt`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const activeMedian = activeValues.sort((a, b) => a - b)[Math.floor(activeValues.length / 2)];
        const inactiveMedian = inactiveValues.sort((a, b) => a - b)[Math.floor(inactiveValues.length / 2)];

        const newStartThreshold = (activeMedian + inactiveMedian) / 2;
        const newStopThreshold = newStartThreshold;

        writeToConnection(`Kalibrierung abgeschlossen.`);
        writeToConnection(`Neuer Startschwellenwert: ${newStartThreshold.toFixed(2)} Watt`);
        writeToConnection(`Neuer Stoppschwellenwert: ${newStopThreshold.toFixed(2)} Watt`);
      });
    });
  }

  async getSmartPlugs() {
    this.log.info('Fetching Tuya smart plugs...');
    const devicesResponse = await this.apiInstance.get('/v1.0/iot-01/associated-users/devices');
    if (!devicesResponse.success) {
      this.log.error(`Fetching smart plugs failed. code=${devicesResponse.code}, msg=${devicesResponse.msg}`);
      return [];
    }

    const deviceList = devicesResponse.result?.devices ?? [];

    return deviceList.filter(device => device.category === 'cz').map(device => ({
      displayName: device.name,
      UUID: device.id,
      deviceId: device.id,
      deviceKey: device.local_key
    }));
  }

  async trackPowerConsumption(deviceId: string, deviceKey: string, powerValueId: string, margin?: number, connection?: net.Socket) {
    let currentState: 'inactive' | 'starting' | 'active' | 'ending' = 'inactive';
    let startThreshold: number | null = null;
    let stopThreshold: number | null = null;
    const stableTimeRequired = 10;
    let stateChangeTime: DateTime | null = null;
    const powerValues: number[] = [];
    const maxPowerValues = 20;
    const hysteresisFactor = 0.2;

    const writeToConnection = (message: string) => {
      if (connection) {
        connection.write(message + '\n');
      } else {
        console.log(message);
      }
    };

    writeToConnection(`Starte Überwachung des Energieverbrauchs für Gerät ID: ${deviceId}, PowerValueID: ${powerValueId}`);

    setInterval(async () => {
      try {
        const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
        if (!statusResponse.success) {
          writeToConnection(`Fehler beim Abrufen des Status: ${statusResponse.msg} (Code: ${statusResponse.code})`);
          return;
        }

        const allDPS = statusResponse.result;
        const currentDPS = (allDPS.find((dps: any) => dps.code === powerValueId)?.value) / 10;

        if (currentDPS !== undefined) {
          writeToConnection(`Aktueller Power-Wert: ${currentDPS} Watt`);

          powerValues.push(currentDPS);
          if (powerValues.length > maxPowerValues) {
            powerValues.shift();
          }

          const averagePower = powerValues.reduce((sum, val) => sum + val, 0) / powerValues.length;
          const variance = powerValues.reduce((sum, val) => sum + Math.pow(val - averagePower, 2), 0) / powerValues.length;
          const stdDev = Math.sqrt(variance);

          writeToConnection(`Durchschnittlicher Verbrauch: ${averagePower.toFixed(2)} Watt, Standardabweichung: ${stdDev.toFixed(2)} Watt`);

          if (powerValues.length === maxPowerValues) {
            startThreshold = averagePower + stdDev * 2;
            stopThreshold = averagePower + stdDev;

            writeToConnection(`Dynamische Startschwelle: ${startThreshold.toFixed(2)} Watt`);
            writeToConnection(`Dynamische Stoppschwelle: ${stopThreshold.toFixed(2)} Watt`);
          }

          switch (currentState) {
            case 'inactive':
              if (startThreshold !== null && currentDPS > startThreshold) {
                if (!stateChangeTime) {
                  stateChangeTime = DateTime.now();
                  writeToConnection('Anstieg erkannt, Wartezeit beginnt...');
                } else {
                  const duration = DateTime.now().diff(stateChangeTime, 'seconds').seconds;
                  if (duration >= stableTimeRequired) {
                    currentState = 'active';
                    writeToConnection('Gerät ist jetzt aktiv.');
                    stateChangeTime = null;
                  }
                }
              } else {
                stateChangeTime = null;
              }
              break;

            case 'active':
              if (stopThreshold !== null && currentDPS < stopThreshold) {
                if (!stateChangeTime) {
                  stateChangeTime = DateTime.now();
                  writeToConnection('Abfall erkannt, Wartezeit beginnt...');
                } else {
                  const duration = DateTime.now().diff(stateChangeTime, 'seconds').seconds;
                  if (duration >= stableTimeRequired) {
                    currentState = 'inactive';
                    writeToConnection('Gerät ist jetzt inaktiv.');
                    stateChangeTime = null;
                  }
                }
              } else {
                stateChangeTime = null;
              }
              break;
          }
        } else {
          writeToConnection('Konnte aktuellen Power-Wert nicht abrufen.');
        }
      } catch (error) {
        writeToConnection(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 5000);
  }

  async identifyPowerValue(deviceId: string, deviceKey: string, connection: net.Socket) {
    const log = this.log;
    const config = { id: deviceId, key: deviceKey, name: 'Smart Plug' };
    const existingDPS: { [key: string]: string } = {};

    log.info(`Starte Identifizierung für Gerät: ${deviceId}`);

    const response = await this.apiInstance.get(`/v1.0/devices/${deviceId}`);
    if (!response.success) {
      log.error(`Konnte Gerät ${deviceId} nicht abrufen: ${response.msg}`);
      return;
    }

    log.info('Power on your appliance to observe the values.');
    setInterval(async () => {
      const statusResponse = await this.apiInstance.get(`/v1.0/devices/${deviceId}/status`);
      if (!statusResponse.success) {
        log.error(`Fehler beim Abrufen des Status: ${statusResponse.msg}`);
        return;
      }

      Object.assign(existingDPS, statusResponse.result);
      const tableData: string[][] = [['Property ID', 'Value']];
      for (const [key, value] of Object.entries(existingDPS)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        tableData.push([key, displayValue]);
      }

      connection.write(table(tableData));
      connection.write('Make sure plugged in appliance is consuming power (operating).');
      connection.write('\nOne of the values above will represent power consumption.\n');
    }, 5000);
  }

  private startIPCServer() {
    const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');
    this.log.info(`Starte den IPC-Server auf ${socketPath}`);

    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((connection) => {
      this.log.info('Verbindung über den IPC-Server erhalten');
      connection.write('> ');

      connection.setEncoding('utf8');

      let selectedCommand = ''; // Variable für den aktuellen Befehl
      let selectedPlug: any = null; // Das ausgewählte Gerät
      let smartPlugsCache: any[] = []; // Cache für die Smart-Plugs

      connection.on('data', async (data: string | Buffer) => {
        const input = data.toString().trim();
        this.log.info(`Empfangener Befehl über IPC: "${input}"`);

        // Kombinierter Ablauf mit list-smartplugs vor identify, track oder calibrate
        if (input === 'identify' || input === 'track' || input === 'calibrate') {
          selectedCommand = input;

          // Liste zuerst die Smart-Plugs auf
          const smartPlugs = await this.getSmartPlugs();

          if (smartPlugs.length === 0) {
            connection.write('Keine Smart-Plugs gefunden.\n');
            connection.end();
            return;
          }

          smartPlugsCache = smartPlugs; // Smart-Plugs in Cache speichern
          let response = 'Verfügbare Smart-Plugs:\n';
          smartPlugs.forEach((plug, index) => {
            response += `${index + 1}: Name: ${plug.displayName}, UUID: ${plug.UUID}\n`;
          });

          connection.write(response + 'Wähle die Nummer des Geräts: \n');
        } else if (selectedCommand && /^\d+$/.test(input)) {
          // Prüfe, ob die Eingabe eine Zahl ist und ein Smart-Plug ausgewählt wird
          const index = parseInt(input, 10) - 1;
          if (index >= 0 && index < smartPlugsCache.length) {
            selectedPlug = smartPlugsCache[index];

            if (selectedCommand === 'identify') {
              await this.identifyPowerValue(selectedPlug.deviceId, selectedPlug.deviceKey, connection);
              selectedCommand = ''; // Reset des Befehls
            } else if (selectedCommand === 'track') {
              connection.write('Bitte gib die PowerValueID ein: \n');
              selectedCommand = 'awaitingPowerValueId'; // Setze den Zustand auf PowerValueID-Abfrage
            } else if (selectedCommand === 'calibrate') {
              await this.calibratePowerConsumption(selectedPlug.deviceId, 'cur_power', connection);
              selectedCommand = ''; // Reset des Befehls nach der Kalibrierung
            }
          } else {
            connection.write('Ungültige Auswahl.\n');
          }
        } else if (selectedCommand === 'awaitingPowerValueId') {
          // Verarbeite die PowerValueID nach der Auswahl des Geräts
          const powerValueId = input;
          if (selectedPlug) {
            await this.trackPowerConsumption(selectedPlug.deviceId, selectedPlug.deviceKey, powerValueId, undefined, connection);
            selectedCommand = ''; // Reset des Befehls
          } else {
            connection.write('Kein gültiges Gerät ausgewählt.\n');
          }
        } else {
          connection.write('Unbekannter Befehl\n');
        }
      });
    });

    server.listen(socketPath, () => {
      this.log.info(`IPC-Server hört auf ${socketPath}`);
    });

    server.on('error', (err: Error) => {
      this.log.error(`Fehler beim IPC-Server: ${err.message}`);
    });
  }
}