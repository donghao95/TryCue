# Changelog

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
