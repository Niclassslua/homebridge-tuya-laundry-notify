import { LaundryDeviceTracker } from '../../src/lib/laundryDeviceTracker';
import { Logger } from 'homebridge';

describe('LaundryDeviceTracker init with shared discovery', () => {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  it('uses provided local devices without triggering discovery', async () => {
    const smartPlugService = { discoverLocalDevices: jest.fn() } as any;
    const messageGateway = { send: jest.fn() } as any;
    const config: any = {
      name: 'Waschmaschine',
      deviceId: 'dev1',
      localKey: 'key',
      startValue: 90,
      startDuration: 10,
      endValue: 0,
      endDuration: 60,
      powerValueId: '19',
      exposeStateSwitch: false,
    };
    const tracker = new LaundryDeviceTracker(log, messageGateway, config, {} as any, smartPlugService);
    (tracker as any).detectStartStop = jest.fn();

    const devices = [
      { deviceId: 'dev1', ip: '1.1.1.1', version: '3.4' },
      { deviceId: 'dev2', ip: '1.1.1.2', version: '3.4' },
    ];

    await tracker.init(devices);

    expect(smartPlugService.discoverLocalDevices).not.toHaveBeenCalled();
    expect((tracker as any).detectStartStop).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'dev1' }));
  });
});
