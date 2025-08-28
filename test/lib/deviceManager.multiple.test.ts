import { DeviceManager } from '../../src/lib/deviceManager';
import { Logger } from 'homebridge';

describe('DeviceManager multiple discovery', () => {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  it('discovers devices on subsequent calls', async () => {
    const manager = new DeviceManager(null as any, log);

    // Mock the private discoverDevices method to avoid network operations
    (manager as any).discoverDevices = async function(_port: number) {
      const key = 'dummy';
      if ((this as any).devicesSeen.has(key)) {
        return [];
      }
      (this as any).devicesSeen.add(key);
      return [{ deviceId: 'dev1', ip: '0.0.0.0', version: '3.3' }];
    };

    const first = await manager.discoverLocalDevices();
    const second = await manager.discoverLocalDevices();

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});
