import net from 'net';
import path from 'path';
import os from 'os';
import readline from 'readline';

const socketPath = path.join(os.tmpdir(), 'tuya-laundry.sock');

// Setup CLI tool
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// CLI Command to list devices and select a device to get its ID and Key
const command = process.argv[2];

if (command === 'list-devices') {
  const client = net.createConnection({ path: socketPath }, () => {
    console.log('Verbunden mit dem IPC-Server');
    client.write('list-smartplugs');
  });

  client.on('data', (data) => {
    const smartPlugs = JSON.parse(data.toString());
    console.log('Verfügbare Geräte:');
    smartPlugs.forEach((plug: any, index: number) => {
      console.log(`${index + 1}. Name: ${plug.displayName}, UUID: ${plug.UUID}`);
    });

    rl.question('Wähle die Nummer des Geräts, um Details anzuzeigen: ', (input) => {
      const selectedDevice = smartPlugs[parseInt(input) - 1];
      if (selectedDevice) {
        console.log(`Gerät gewählt: ${selectedDevice.displayName}`);
        console.log(`Gerät UUID: ${selectedDevice.UUID}`);
        console.log('Device ID: ', selectedDevice.deviceId);  // Zeigt die Device ID an
        console.log('Device Key: ', selectedDevice.deviceKey);  // Zeigt den Device Key an
      } else {
        console.log('Ungültige Auswahl.');
      }

      client.end();
      rl.close();
    });
  });

  client.on('end', () => {
    console.log('Verbindung zum IPC-Server geschlossen.');
  });

  client.on('error', (err) => {
    console.error(`Fehler bei der Verbindung zum IPC-Server: ${err.message}`);
  });
} else {
  console.error('Unbekannter Befehl. Verwende "list-devices".');
  process.exit(1);
}