# Changelog

## [0.1.4](https://github.com/donghao95/TryCue/compare/v0.1.3...v0.1.4) (2026-07-03)


### Bug Fixes

* **api:** 修复 recovery guard 的 await-before-assignment 窗口 ([#53](https://github.com/donghao95/TryCue/issues/53)) ([870e405](https://github.com/donghao95/TryCue/commit/870e405eec2db06570c120c27d0100d1783e365f))
* 修复代码审查第二轮发现的状态机并发、文档一致性和工程问题 ([#51](https://github.com/donghao95/TryCue/issues/51)) ([a9e1db9](https://github.com/donghao95/TryCue/commit/a9e1db906a6cdb2fe3977ee71cafcd322cfa001b))


### Performance Improvements

* **docs:** 将 README 截图转为 WebP，体积减少 82% ([#48](https://github.com/donghao95/TryCue/issues/48)) ([ca8fa8b](https://github.com/donghao95/TryCue/commit/ca8fa8bf48767b2ef27fa70e5432e1a781029f5e))

## [0.1.3](https://github.com/donghao95/TryCue/compare/v0.1.2...v0.1.3) (2026-07-02)


### Bug Fixes

* **web:** 修复刷新后"确认计划并生成人设"按钮永久 disabled ([#44](https://github.com/donghao95/TryCue/issues/44)) ([0e93b07](https://github.com/donghao95/TryCue/commit/0e93b07767c95ff16ae7ca79798459f1cab4783a))
* **web:** 修复观众计划 SSE 终态事件的 stale 边界场景 ([#46](https://github.com/donghao95/TryCue/issues/46)) ([cf6200a](https://github.com/donghao95/TryCue/commit/cf6200a2b71033269d25cf9df4ebe6aca821238f))
* 修复代码审查发现的状态机、幂等性和鉴权回滚问题 ([#47](https://github.com/donghao95/TryCue/issues/47)) ([7374113](https://github.com/donghao95/TryCue/commit/737411354b5d1884eeb158cadfe8d59cc2406362))

## [0.1.2](https://github.com/donghao95/TryCue/compare/v0.1.1...v0.1.2) (2026-07-01)


### Bug Fixes

* **api:** move audience plan confirm conflict checks outside transaction ([#33](https://github.com/donghao95/TryCue/issues/33)) ([32be028](https://github.com/donghao95/TryCue/commit/32be0280fe0355827a212bcfb0526c87103f3561))


### Performance Improvements

* **docker:** slim runner image via 3-stage build ([#36](https://github.com/donghao95/TryCue/issues/36)) ([edc7537](https://github.com/donghao95/TryCue/commit/edc7537e4e5a0b1aa6df03a5ed4e1654f279bb31))

## 0.1.1 (2026-07-01)


### Bug Fixes

* **api,shared:** fix baseUrl schema rejecting empty string and auth hook blocking Web UI ([87874fb](https://github.com/donghao95/TryCue/commit/87874fb53caa2d5da91767b967bcaf6fff5f96af))
* **api:** adapt aiSdkTracing for ai-sdk v7 ([#31](https://github.com/donghao95/TryCue/issues/31)) ([a2441ab](https://github.com/donghao95/TryCue/commit/a2441ab3132669ad20a9e32f646fdecb9e332937))
* **ci,db:** enable release-please to trigger docker workflow + fix db:deploy hardcoded DATABASE_URL ([bbd59dc](https://github.com/donghao95/TryCue/commit/bbd59dc5e274ef5710d5f7cc7d149e073cd151e1))
* **ci:** stabilize CI smoke checks with deterministic mock ([bef73d7](https://github.com/donghao95/TryCue/commit/bef73d75120366d8b1d94144c73f8fa2520480de))
* **ci:** stabilize CI smoke checks with deterministic mock ([#14](https://github.com/donghao95/TryCue/issues/14)) ([bef73d7](https://github.com/donghao95/TryCue/commit/bef73d75120366d8b1d94144c73f8fa2520480de))
* **db,ci:** point @trycue/db exports to dist, clean env.example, add production smoke ([#23](https://github.com/donghao95/TryCue/issues/23)) ([6a87404](https://github.com/donghao95/TryCue/commit/6a87404fe2ba18b696531f518058e692394feb4f))
* **deps:** resolve esbuild Dependabot alert ([#22](https://github.com/donghao95/TryCue/issues/22)) ([48bf8fe](https://github.com/donghao95/TryCue/commit/48bf8fec4cd6c3aaea48749b39bde5b76c88a5c2))
* **security,api:** harden auth, rate-limit, validation and fix evidencePack bug ([f4775c9](https://github.com/donghao95/TryCue/commit/f4775c9cd3e9681942b33c456c70f17807faebd5))
* **shared:** point exports to dist for prod, keep src for dev/typecheck ([5d385ed](https://github.com/donghao95/TryCue/commit/5d385eda911a1d0e9e9a836d1d87fa99b727ad66))
* **shared:** point exports to dist for prod, keep src for dev/typecheck ([153748f](https://github.com/donghao95/TryCue/commit/153748fcc7e81a6b63da6268622a65afa183bdd3))
* **tool-executor:** align emitAudienceEvents journey arg in 3 commits ([6e0ace6](https://github.com/donghao95/TryCue/commit/6e0ace61344add9f423f5fca03eff0aaadb83d5c))
* **tool-executor:** align emitAudienceEvents journey arg in 3 commits ([3091fb9](https://github.com/donghao95/TryCue/commit/3091fb9d3bdf807303e17bf8b2cb181397bc4b52))
* **web,api:** subscribe to report.regenerated and harden parsePageQuery ([#13](https://github.com/donghao95/TryCue/issues/13)) ([f218323](https://github.com/donghao95/TryCue/commit/f218323f26812e05c7e90178f00f3ac59df00fc5))
