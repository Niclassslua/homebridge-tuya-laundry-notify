# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2025-02-27

### Added

- **Dryer full-cycle vs short-cycle detection**: Optional per-device thresholds so dryers that do short after-run cycles (cool-down, extra tumble) no longer trigger repeated "start" and "finished" notifications.
  - `minRunDurationSec`: minimum run duration (seconds) to count as a full cycle
  - `minRunKWh`: minimum energy (kWh) to count as a full cycle
  - `minRunAvgPowerW`: minimum average power (W) to count as a full cycle
  - `afterRunWindowMin`: minutes after a full cycle end during which a new "start" is only confirmed once min criteria are met (avoids false start on after-run power spikes)
- **Dry run (learn thresholds)**: New option `dryRun`. When enabled, no notifications are sent; each run is logged with duration, kWh, and power stats, and suggested threshold values are written to `logs/dry-run-<deviceId>.json` so you can copy them into your config.
- **CLI tool (IPC server) toggle**: New option `enableIpcServer` (default: true). When disabled, the CLI socket is not started. A startup notice reminds you to disable it in plugin settings when you're done with setup.

### Changed

- Config key `nachlaufWindowMin` was renamed to `afterRunWindowMin`. The old key is still read for backward compatibility but prefer `afterRunWindowMin` in new configs.

### Fixed

- Dryers that do short after-run cycles no longer cause repeated false "cycle finished" and "cycle started" notifications when min-run criteria and after-run window are configured.
