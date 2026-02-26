import { LaundryDeviceTracker } from '../../src/lib/laundryDeviceTracker';
import { Logger } from 'homebridge';
import { DateTime } from 'luxon';

describe('LaundryDeviceTracker min-run criteria and after-run window', () => {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  const baseConfig = {
    name: 'Dryer',
    deviceId: 'dryer1',
    localKey: 'key',
    ipAddress: '192.168.1.1',
    powerValueId: '19',
    startValue: 500,
    endValue: 100,
    startDuration: 10,
    endDuration: 5,
    startMessage: 'Started',
    endMessage: 'Finished',
  };

  describe('hasMinRunCriteriaConfigured', () => {
    it('returns false when no min criteria are set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, baseConfig, {} as any, {} as any);
      expect((tracker as any).hasMinRunCriteriaConfigured()).toBe(false);
    });

    it('returns true when minRunDurationSec is set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunDurationSec: 600 }, {} as any, {} as any);
      expect((tracker as any).hasMinRunCriteriaConfigured()).toBe(true);
    });

    it('returns true when minRunKWh is set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunKWh: 0.1 }, {} as any, {} as any);
      expect((tracker as any).hasMinRunCriteriaConfigured()).toBe(true);
    });

    it('returns true when minRunAvgPowerW is set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunAvgPowerW: 100 }, {} as any, {} as any);
      expect((tracker as any).hasMinRunCriteriaConfigured()).toBe(true);
    });
  });

  describe('meetsMinRunCriteria', () => {
    it('returns true when no min criteria configured', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, baseConfig, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(100, 0.001, 20)).toBe(true);
    });

    it('returns false when duration below minRunDurationSec', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunDurationSec: 600 }, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(120, 0.5, 400)).toBe(false);
    });

    it('returns true when duration meets minRunDurationSec and others not set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunDurationSec: 600 }, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(700, 0.5, 400)).toBe(true);
    });

    it('returns false when totalKWh below minRunKWh', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunKWh: 0.1 }, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(3000, 0.05, 400)).toBe(false);
    });

    it('returns false when avgPower below minRunAvgPowerW', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, minRunAvgPowerW: 100 }, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(3000, 0.5, 50)).toBe(false);
    });

    it('returns true when all configured criteria are met', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, {
        ...baseConfig,
        minRunDurationSec: 600,
        minRunKWh: 0.1,
        minRunAvgPowerW: 100,
      }, {} as any, {} as any);
      expect((tracker as any).meetsMinRunCriteria(3000, 0.5, 400)).toBe(true);
    });
  });

  describe('isInsideAfterRunWindow', () => {
    it('returns false when afterRunWindowMin not configured', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, baseConfig, {} as any, {} as any);
      (tracker as any).lastFullCycleEndTime = DateTime.now().minus({ minutes: 1 });
      expect((tracker as any).isInsideAfterRunWindow()).toBe(false);
    });

    it('returns false when lastFullCycleEndTime not set', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, afterRunWindowMin: 30 }, {} as any, {} as any);
      expect((tracker as any).isInsideAfterRunWindow()).toBe(false);
    });

    it('returns true when inside window after last full cycle', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, afterRunWindowMin: 30 }, {} as any, {} as any);
      (tracker as any).lastFullCycleEndTime = DateTime.now().minus({ minutes: 10 });
      expect((tracker as any).isInsideAfterRunWindow()).toBe(true);
    });

    it('returns false when outside window after last full cycle', () => {
      const messageGateway = { send: jest.fn() } as any;
      const tracker = new LaundryDeviceTracker(log, messageGateway, { ...baseConfig, afterRunWindowMin: 30 }, {} as any, {} as any);
      (tracker as any).lastFullCycleEndTime = DateTime.now().minus({ minutes: 40 });
      expect((tracker as any).isInsideAfterRunWindow()).toBe(false);
    });
  });
});
