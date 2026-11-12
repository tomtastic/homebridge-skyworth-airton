# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0](https://github.com/tomtastic/homebridge-skyworth-airton/releases/tag/v1.0.0) - 2026-11-12

### Added

- GitHub Actions CI: unit tests, lint and a clean build on Node 22, 24 and 26; a compatibility job that boots real Homebridge (1.9.0, 2.0.0 and the newest 2.x) against the plugin with an unreachable air conditioner, asserting that it loads, publishes the platform, and degrades into log lines instead of crashing; and a job running the provisioning tool's Python unit tests.
- `publish.yml`: a tag-driven release pipeline that publishes to npm through OIDC trusted publishing (no npm token stored in the repo), mirrors the same version to GitHub Packages as `@tomtastic/homebridge-skyworth-airton`, and opens a GitHub Release whose notes come from this file.
- Dependabot updates for npm and GitHub Actions.
- `npm run lint` using the Homebridge plugin template's ESLint configuration, and a `prepublishOnly` hook so a published tarball can never carry a stale `dist/`.
- Platform unit tests: accessory registration and cache restore, removal of accessories that left the config, invalid device entries, and the unconfigured case.
- This changelog, plus npm and CI badges, and an install section in the README.

### Changed

- `engines.node` is now `^22.12.0 || ^24.0.0 || ^26.0.0` (was `^22.10.0 || ^24.0.0`), covering every Node LTS Homebridge 2.x runs on, as the verified-plugin requirements ask for.
- `engines.homebridge` is now `^1.9.0 || ^2.0.0` (was `^1.8.0 || ^2.0.0`). Homebridge 1.8.x only runs on Node 18 and 20, both end of life, so the old floor could not be installed or tested on any currently supported Node release.
- `LICENSE` and `CHANGELOG.md` are now part of the published package, and `@types/node` tracks the oldest supported runtime (Node 22) instead of a newer one, so nothing compiles against APIs that release does not have.

### Fixed

- An air conditioner that is offline or slow when Homebridge starts is no longer abandoned until Homebridge is restarted. The poll loop was armed only after the first status read succeeded, so a failed first read left the accessory permanently stale; the loop now runs regardless, and the compatibility job covers that path.
- Cached accessories keep the context keys Homebridge stores alongside the plugin's own. The accessory context was replaced wholesale on every start, which discarded them.

## 0.1.1 - 2026-07-27 (no GitHub release; published before the release pipeline existed)

### Added

- Repository, homepage and bug-tracker metadata in `package.json`, so npm and the Homebridge UI link back to the source.

## 0.1.0 - 2026-07-27 (no GitHub release; published before the release pipeline existed)

### Added

- Initial release: local control over the air conditioner's TCP service on port 1998, with no cloud account. Each device is exposed as a HomeKit heater/cooler — power, auto/cool/heat, target and measured temperature, fan speed, swing — plus switches for dry mode, fan-only mode, sleep, display light, health filter, auxiliary heat and vertical/horizontal swing.
- `config.schema.json` for the Homebridge UI, and serialised read-modify-write commands so changing one setting never overwrites unrelated mode bits.
- `skyworth_provision.py` and `PROVISIONING_PROTOCOL.md` for joining an air conditioner to a local Wi-Fi network without the deprecated vendor app.
