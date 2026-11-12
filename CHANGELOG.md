# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut by release-please from Conventional Commit messages: each release PR
inserts its generated section above the newest entry. Hand-written notes still go under
`[Unreleased]`; when merging a release PR, fold them into the generated section and leave
`[Unreleased]` empty.

## [0.13.0](https://github.com/caelum29/calibre-mcp/compare/v0.12.0...v0.13.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **tools:** calibre_quality_report no longer has a readability input; it was never implemented and is now ignored like any unknown input.

### Added

* **board:** show the search query, mode and bundle on the cover board ([5a29e66](https://github.com/caelum29/calibre-mcp/commit/5a29e664d5d86fab43817049476ec78ef394d1c2))
* **board:** show the search query, mode and bundle on the cover board ([80056d1](https://github.com/caelum29/calibre-mcp/commit/80056d1dab2713fd3fc1c8a73e66e9e69d692625))
* **build-index:** enableFts enables Calibre FTS through the routed write path ([#447](https://github.com/caelum29/calibre-mcp/issues/447)) ([ad1c29d](https://github.com/caelum29/calibre-mcp/commit/ad1c29d74826b662ad8bdba01c3c8f67a2bfcb90))
* **build-index:** enableFts enables Calibre FTS via the routed write path ([#447](https://github.com/caelum29/calibre-mcp/issues/447)) ([a39aad6](https://github.com/caelum29/calibre-mcp/commit/a39aad68ea89e4d69eaa8e009f0b498af53378ef))
* **calibre:** detect the Calibre version, show it in calibre_ping, add calibre_too_old ([#499](https://github.com/caelum29/calibre-mcp/issues/499)) ([97b7c54](https://github.com/caelum29/calibre-mcp/commit/97b7c54046222798f6b2a7ec0d55f201c1ab96b4))
* **calibre:** detect the Calibre version, show it in calibre_ping, add calibre_too_old ([#499](https://github.com/caelum29/calibre-mcp/issues/499)) ([15a9e59](https://github.com/caelum29/calibre-mcp/commit/15a9e59906e25819236c04eec6066194be324b18))
* **eval:** declare [#363](https://github.com/caelum29/calibre-mcp/issues/363) report-only axes before measuring ([#363](https://github.com/caelum29/calibre-mcp/issues/363)) ([d76d69f](https://github.com/caelum29/calibre-mcp/commit/d76d69f18a115b4dcd62e2e713bdd7c3cd06a8e6))
* **eval:** declare golden-set hash rule and record [#392](https://github.com/caelum29/calibre-mcp/issues/392) decisions ([#392](https://github.com/caelum29/calibre-mcp/issues/392)) ([875f7ad](https://github.com/caelum29/calibre-mcp/commit/875f7adb39009e3697f381836e9f9e3b11a927cf))
* **eval:** gate the fusion-only tier as a second --rerank off pass ([#356](https://github.com/caelum29/calibre-mcp/issues/356)) ([694582f](https://github.com/caelum29/calibre-mcp/commit/694582f39264c424a24659a178e353af083c71c9))
* **eval:** golden-set hash gate and hash-freeze re-freeze hint ([#392](https://github.com/caelum29/calibre-mcp/issues/392)) ([edf91cb](https://github.com/caelum29/calibre-mcp/commit/edf91cb235da33eb3e227400586c45a4c00cf85c))
* **eval:** golden-set hash gate and one-command hash re-freeze ([8e622df](https://github.com/caelum29/calibre-mcp/commit/8e622df22c7a7d6630d88b0684d6f6cc84f9b8c7))
* **eval:** hash-freeze refuses an uncommitted rule and marks a dirty tree ([#392](https://github.com/caelum29/calibre-mcp/issues/392)) ([62ce217](https://github.com/caelum29/calibre-mcp/commit/62ce2174c2a3ad4d24e65334e16aec6cbf543352))
* **eval:** headroom share + saturation warning, refresh README ([#365](https://github.com/caelum29/calibre-mcp/issues/365)) ([8b27ab2](https://github.com/caelum29/calibre-mcp/commit/8b27ab29949425c0ef04bb20b0e969e8e816c06e))
* **eval:** report-only snippet, span, confidence, latency and ablation axes ([1cf6350](https://github.com/caelum29/calibre-mcp/commit/1cf6350bf7193ea4ccb20e4536b225fe23c1ecb2))
* **eval:** report-only snippet, span, confidence, latency and ablation axes ([#363](https://github.com/caelum29/calibre-mcp/issues/363)) ([38645e7](https://github.com/caelum29/calibre-mcp/commit/38645e711f680bbbccaf0054c5be2b35f67fa98f))
* **eval:** stats module, --compare, top-10 list diff gate ([1e9c9eb](https://github.com/caelum29/calibre-mcp/commit/1e9c9eb8c5b0c2e05fb8e7a6ef34e10352b430c6))
* **eval:** stats module, --compare, top-10 list diff replaces aggregate epsilon ([#358](https://github.com/caelum29/calibre-mcp/issues/358)) ([c90c5a6](https://github.com/caelum29/calibre-mcp/commit/c90c5a6720947e864df00c679a86a3b4a3d5055e))
* **eval:** sweep scorers report paired stats from stats.ts ([73c93b7](https://github.com/caelum29/calibre-mcp/commit/73c93b76ddff9ca45a23b200c27e6d328bac5d21))
* **eval:** sweep scorers report paired stats from stats.ts ([#358](https://github.com/caelum29/calibre-mcp/issues/358)) ([8bde6b6](https://github.com/caelum29/calibre-mcp/commit/8bde6b61bf931e9752ea6b5ca8cb5c2243484366))
* **eval:** tier-0 hash-embedder gate in pnpm test ([#357](https://github.com/caelum29/calibre-mcp/issues/357)) ([0a1eb31](https://github.com/caelum29/calibre-mcp/commit/0a1eb310e2fe0b06be96c5943fe8df7c1d6db238))
* **gate:** gate writes per call, previews stay available with writes off ([#435](https://github.com/caelum29/calibre-mcp/issues/435)) ([a10bea9](https://github.com/caelum29/calibre-mcp/commit/a10bea9d601508b6e5bc04f10360242e221e2325))
* **gate:** gate writes per call, previews stay available with writes off ([#435](https://github.com/caelum29/calibre-mcp/issues/435)) ([cc9087f](https://github.com/caelum29/calibre-mcp/commit/cc9087f60df5dc7860d31947f77c0c3e34ea2372))
* **ping:** library ids and [default] in the Index line, busy state for a locked index, capped text ([baa16cc](https://github.com/caelum29/calibre-mcp/commit/baa16cc059e55848455f317dba9a05794131cbcd))
* **ping:** name library ids and the default, report a locked index as busy, cap the Index text ([#440](https://github.com/caelum29/calibre-mcp/issues/440)) ([4b7c87a](https://github.com/caelum29/calibre-mcp/commit/4b7c87a04b3a1cf9b2ee7e54bbc5d8152625121d))
* **ping:** probe whether Calibre accepts writes and report it in both channels ([#439](https://github.com/caelum29/calibre-mcp/issues/439)) ([2b00b00](https://github.com/caelum29/calibre-mcp/commit/2b00b00382a5e04532ab1dad626a4498137e4bb9))
* **ping:** report whether Calibre itself accepts writes ([a392566](https://github.com/caelum29/calibre-mcp/commit/a392566740c9c7fd2ebbcdc77292517d7dce7a3b))
* **resources:** book URI carries the library id ([#432](https://github.com/caelum29/calibre-mcp/issues/432)) ([30e171b](https://github.com/caelum29/calibre-mcp/commit/30e171bb00dfad29b35efa6c673c4e3658dbf6d5))
* **resources:** book URI carries the library id, calibre://book/{libId}/{id} ([#432](https://github.com/caelum29/calibre-mcp/issues/432)) ([6177459](https://github.com/caelum29/calibre-mcp/commit/6177459c505dea0a2e6590e6cf6a18ec13cffc86))
* **result:** show error code and next step as labelled lines in error text ([581d134](https://github.com/caelum29/calibre-mcp/commit/581d1348b3adbb1ad2685813dbfc8bf73a2d79a5))
* **result:** show the error code and next step as labelled lines in error text ([#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([9a38bbd](https://github.com/caelum29/calibre-mcp/commit/9a38bbd06290e3e21bd7dcbdb8c1dd9005f1a06c))
* **search:** read Calibre 9.18 annotations and notes in calibre_search ([#500](https://github.com/caelum29/calibre-mcp/issues/500)) ([2b4c3bd](https://github.com/caelum29/calibre-mcp/commit/2b4c3bd9cb233fa79c1959da920cefaaf6a1aa2a))
* **search:** read Calibre 9.18 annotations and notes in calibre_search ([#500](https://github.com/caelum29/calibre-mcp/issues/500)) ([bf52674](https://github.com/caelum29/calibre-mcp/commit/bf52674281d81e2bc2e45f712caf42aab95baed5))
* **search:** total tie-break by id at every ranking stage ([#412](https://github.com/caelum29/calibre-mcp/issues/412)) ([83eccfc](https://github.com/caelum29/calibre-mcp/commit/83eccfcc5f4128fb86144125d00f0b8e37af67b0))
* **tools:** remove unimplemented readability input and binary-mode line ([#447](https://github.com/caelum29/calibre-mcp/issues/447)) ([e44f8dc](https://github.com/caelum29/calibre-mcp/commit/e44f8dcdef7a9574fc7072a12c68b27652150713))
* **tools:** tags_add / tags_remove on calibre_bulk_update ([#321](https://github.com/caelum29/calibre-mcp/issues/321)) ([b33cc77](https://github.com/caelum29/calibre-mcp/commit/b33cc779c8aff2afd4cff4ffac9c5f69be961e30))
* **write-gate:** gate-off previews carry writeEnabled: false and the remedy line ([#554](https://github.com/caelum29/calibre-mcp/issues/554)) ([0ff8eae](https://github.com/caelum29/calibre-mcp/commit/0ff8eae7081a1a2dffad766149c28c60bd1afdc0))
* **write-gate:** gate-off previews carry writeEnabled: false and the remedy line ([#554](https://github.com/caelum29/calibre-mcp/issues/554)) ([0ee268a](https://github.com/caelum29/calibre-mcp/commit/0ee268afdd8045c3888bdcf2e6e4475044186a3e))


### Fixed

* **add_book:** duplicate probe uses curation matching, probes same-call copies, reports the cap ([e545e69](https://github.com/caelum29/calibre-mcp/commit/e545e694838328049d17b88aeee695c39a223d16))
* **add_book:** duplicate probe uses curation matching, probes same-call copies, reports the cap ([#341](https://github.com/caelum29/calibre-mcp/issues/341)) ([eed5908](https://github.com/caelum29/calibre-mcp/commit/eed59088f63debaae6c4f55c27b8470e700340a9))
* **add_book:** match filename slugs with editions, keep the cap note when the probe fails ([#341](https://github.com/caelum29/calibre-mcp/issues/341)) ([bcd8f46](https://github.com/caelum29/calibre-mcp/commit/bcd8f46a17f24b31829fa208a67057f5eb96330f))
* **add_book:** probe also searches the main title; ignore a raw import's PDF pubdate ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([9931cce](https://github.com/caelum29/calibre-mcp/commit/9931cceacecb63644b912304baa56bf3d3fb3186))
* **add_book:** probe the main title and ignore a raw import's PDF pubdate ([6de02ea](https://github.com/caelum29/calibre-mcp/commit/6de02eae0cce6d6f348742d690ae98962d1bcca2))
* **add_book:** strip a leading =/~/^ from the main-title probe query ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([85f4492](https://github.com/caelum29/calibre-mcp/commit/85f4492fe67030dfcef496eb136417f635ddc4f6))
* **add-book:** calibre_error for an unclassified failed add, invalid_input for an unreadable file ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([b99c6d4](https://github.com/caelum29/calibre-mcp/commit/b99c6d4578d8c88106899087468c692e9b10b3ef))
* **add-book:** label only a parsed duplicate report or empty stderr as a duplicate skip ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([43e177e](https://github.com/caelum29/calibre-mcp/commit/43e177efa32b411ab34e5f49bfc345244a2ca41d))
* **add-book:** one next step for an unclassified failed add ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([43db1b0](https://github.com/caelum29/calibre-mcp/commit/43db1b0a1eaa00ca1040ff95caf7dba6efb929a7))
* **add-book:** report a non-duplicate failed add as an error, not a skip ([0517e52](https://github.com/caelum29/calibre-mcp/commit/0517e524a9c1fbe471415ad7064b110a675c9b62))
* **add-book:** report a skipped title+author duplicate in text and JSON ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([c10bf48](https://github.com/caelum29/calibre-mcp/commit/c10bf48a1eafaa52718d46b30004ee766f8a3a6e))
* **add-book:** return a non-duplicate no-ids add as an error in our own words ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([8d76834](https://github.com/caelum29/calibre-mcp/commit/8d76834998a6625fb7dc7bb4e767f64b3b81fc97))
* **add-book:** say a title+author duplicate was skipped, in text and JSON ([#555](https://github.com/caelum29/calibre-mcp/issues/555)) ([0838436](https://github.com/caelum29/calibre-mcp/commit/08384361616edbaa64e5cf35f3991a226bb552ff))
* **app:** enableFts drops banner lines at any position again; pin the steer per filter tool ([#518](https://github.com/caelum29/calibre-mcp/issues/518)) ([19555ca](https://github.com/caelum29/calibre-mcp/commit/19555ca2dcadca3cf96bd73eb4d0037a0d300704))
* **app:** omit the retry clause when no retry ran ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([4e8da18](https://github.com/caelum29/calibre-mcp/commit/4e8da181a310ec85a3e2ece19bc63f1d55a6ce83))
* **build-index:** enableFts on every result kind, verify a possibly committed enable ([#447](https://github.com/caelum29/calibre-mcp/issues/447)) ([a48445f](https://github.com/caelum29/calibre-mcp/commit/a48445f8c9c468399c90c478f64435f150340f70))
* **build-index:** FTS promise never rejects; cancelled call returns the build result ([#447](https://github.com/caelum29/calibre-mcp/issues/447)) ([45638ac](https://github.com/caelum29/calibre-mcp/commit/45638ac00c17196e163baf1813f9a901a6b4156f))
* **build-index:** report a removed selected id as pruned, not failed ([#561](https://github.com/caelum29/calibre-mcp/issues/561)) ([958214b](https://github.com/caelum29/calibre-mcp/commit/958214b342e003c4a335a9c66147dad800a0c76c))
* **build-index:** report a removed selected id as pruned, not failed ([#561](https://github.com/caelum29/calibre-mcp/issues/561)) ([cd15a78](https://github.com/caelum29/calibre-mcp/commit/cd15a7871f6e1ce9e5eab623543613fef7758edd))
* **bundles:** cap the exclusion count and cover semantic, annotations, board ([#564](https://github.com/caelum29/calibre-mcp/issues/564)) ([5ee8f38](https://github.com/caelum29/calibre-mcp/commit/5ee8f3892307a91d632e02a869f822f4cfa3db73))
* **bundles:** report how many books exclusion markers removed from a filter ([f0bfd2c](https://github.com/caelum29/calibre-mcp/commit/f0bfd2c29d75e1e9fe080b4184e4f04d288616b2))
* **bundles:** report how many books exclusion markers removed from a filter ([#564](https://github.com/caelum29/calibre-mcp/issues/564)) ([68687bb](https://github.com/caelum29/calibre-mcp/commit/68687bba9e2a49762e4ff19c277b62256cf217b5))
* **busy:** half-open breaker admits one probe, not every concurrent call ([759f157](https://github.com/caelum29/calibre-mcp/commit/759f157f9b67c94fa76188f82c40fab13ef6a9f2))
* **busy:** half-open breaker admits one probe, not every concurrent call ([#343](https://github.com/caelum29/calibre-mcp/issues/343)) ([4f8e62e](https://github.com/caelum29/calibre-mcp/commit/4f8e62e761bbf4d7f68059e96efd24bfab5cd56e))
* **busy:** probe claim token, honest probe wording, ping shows probing library ([#343](https://github.com/caelum29/calibre-mcp/issues/343)) ([37a00e1](https://github.com/caelum29/calibre-mcp/commit/37a00e174296371d450c1f1cd3aa7d89499c3b5a))
* **calibre:** fail on unknown library instead of guessing a libId ([#438](https://github.com/caelum29/calibre-mcp/issues/438)) ([17e564d](https://github.com/caelum29/calibre-mcp/commit/17e564d45a1a99e7fd902b0a4375a21bd91cab25))
* **calibre:** fail on unknown library instead of guessing a libId ([#438](https://github.com/caelum29/calibre-mcp/issues/438)) ([0bea15f](https://github.com/caelum29/calibre-mcp/commit/0bea15f26acd356c417a87fb7d25ac85bb06981b))
* **coerce:** limitParam falls back to the default below 1 ([97219f6](https://github.com/caelum29/calibre-mcp/commit/97219f621fc7a7e3222fc77513916621a947d419))
* **coerce:** limitParam falls back to the default below 1 ([#552](https://github.com/caelum29/calibre-mcp/issues/552)) ([a8508e3](https://github.com/caelum29/calibre-mcp/commit/a8508e362be42a131890682c37e54ffa015a0c71))
* **docs:** JSDoc, short headers, threshold basis, logged snippet errors ([#348](https://github.com/caelum29/calibre-mcp/issues/348)) ([5b46018](https://github.com/caelum29/calibre-mcp/commit/5b460183dfaaa8e2ee5f7e6b08d5ca27a0c5d0de))
* **domain:** keep pubYear's plausible-year floor alongside isEmptyDate ([#347](https://github.com/caelum29/calibre-mcp/issues/347)) ([73f094c](https://github.com/caelum29/calibre-mcp/commit/73f094c96a0c33c9e7bedd1a3cd3cc4b6d086ba7))
* **duplicates:** one same-work verdict for similar, compare and the merge preview ([#550](https://github.com/caelum29/calibre-mcp/issues/550)) ([ba317e0](https://github.com/caelum29/calibre-mcp/commit/ba317e079931cb6d1272d89c01e7502051ea1495))
* **duplicates:** share one same-work verdict across similar, compare and the merge preview ([#550](https://github.com/caelum29/calibre-mcp/issues/550)) ([4c16d6c](https://github.com/caelum29/calibre-mcp/commit/4c16d6cc8981e0d5191f168f3ad9337b844ade51))
* **enrich:** reject bare binary digit runs as ISBN candidates ([df666d9](https://github.com/caelum29/calibre-mcp/commit/df666d9933e296a1bcda78a15f61daa99f7a8c99))
* **enrich:** reject bare binary digit runs as ISBN candidates ([#445](https://github.com/caelum29/calibre-mcp/issues/445)) ([8e98b62](https://github.com/caelum29/calibre-mcp/commit/8e98b62f89b6b368bb480c331780f14bb5b2be06))
* **errors:** a gateway 5xx in calibredb stderr is calibre_busy ([#529](https://github.com/caelum29/calibre-mcp/issues/529)) ([c35e6b4](https://github.com/caelum29/calibre-mcp/commit/c35e6b41f974694493886d37d5fad0b26d070706))
* **errors:** a gateway 5xx on a write or read is calibre_busy, not calibre_unreachable ([#494](https://github.com/caelum29/calibre-mcp/issues/494)) ([4583673](https://github.com/caelum29/calibre-mcp/commit/45836736c308b2623d76cf04a5d5c691004d615f))
* **errors:** gateway 5xx in calibredb stderr is calibre_busy ([5b3fec7](https://github.com/caelum29/calibre-mcp/commit/5b3fec79991e536c67cc850d4869b34b769ec994))
* **errors:** gateway 5xx on a write or read is calibre_busy ([f37d338](https://github.com/caelum29/calibre-mcp/commit/f37d33898d51dcdc8908b7a913bfc2da3922b158))
* **eval:** [#363](https://github.com/caelum29/calibre-mcp/issues/363) axes skip missing fields, runPass options, durationMs scope ([#363](https://github.com/caelum29/calibre-mcp/issues/363)) ([b980d44](https://github.com/caelum29/calibre-mcp/commit/b980d44756da8e3f8f6c496f96860f7cd5a2f5bf))
* **eval:** CLI entry guard survives symlinks; CLI tests robust to Node warnings and fail fast ([#389](https://github.com/caelum29/calibre-mcp/issues/389)) ([ff95fb7](https://github.com/caelum29/calibre-mcp/commit/ff95fb705c2961b54d3e755097c241b6c69b223f))
* **eval:** guard frozen baselines, validate gate inputs up front, fix README proof weights ([#356](https://github.com/caelum29/calibre-mcp/issues/356)) ([7ae61c6](https://github.com/caelum29/calibre-mcp/commit/7ae61c66ddddf3e132d434dc56c962f1da066ca8))
* **eval:** hash-tier list-diff hint names only the re-freeze ([#392](https://github.com/caelum29/calibre-mcp/issues/392)) ([66274c9](https://github.com/caelum29/calibre-mcp/commit/66274c9f25bb74848c811455a33b6d4aa2154823))
* **eval:** keep reportOnlyAxes entries axis-only, comment beside the block ([#363](https://github.com/caelum29/calibre-mcp/issues/363)) ([f38f273](https://github.com/caelum29/calibre-mcp/commit/f38f273c153268e728a74c43a6ad611db3fc0a6e))
* **eval:** maxScore drift fails unless every baseline row is matched ([#325](https://github.com/caelum29/calibre-mcp/issues/325)) ([8d0476c](https://github.com/caelum29/calibre-mcp/commit/8d0476c19a7b52a79714ee4edd692d4f703ab2eb))
* **eval:** rerank-floor sign test pairs by query, not by row ([#358](https://github.com/caelum29/calibre-mcp/issues/358)) ([2853688](https://github.com/caelum29/calibre-mcp/commit/2853688db01c29a0bbd5282742ff45e504c07223))
* **eval:** saturation signals skip fusion-only and live runs, missing mode = unsolved ([#365](https://github.com/caelum29/calibre-mcp/issues/365)) ([6f97fac](https://github.com/caelum29/calibre-mcp/commit/6f97fac387aff29f24952997f40c4f711c5611b4))
* **eval:** split the eval CLI entry into run-cli.ts so --gate cannot fail open ([d244706](https://github.com/caelum29/calibre-mcp/commit/d24470661fad79158c80c22b938ceba2b09afeef))
* **eval:** split the eval CLI entry into run-cli.ts so --gate cannot fail open ([#416](https://github.com/caelum29/calibre-mcp/issues/416)) ([9d814a4](https://github.com/caelum29/calibre-mcp/commit/9d814a481c4a165a0c79beca10bc9990e2a6e053))
* **eval:** stale allow entries fail, validate allow-file up front, warn on partial --compare pairing ([#358](https://github.com/caelum29/calibre-mcp/issues/358)) ([96438d5](https://github.com/caelum29/calibre-mcp/commit/96438d5af8f3550307dab972e619974dcb2c93da))
* **figures:** code the all-figures-skipped error result through toolError ([#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([9bdfcae](https://github.com/caelum29/calibre-mcp/commit/9bdfcaea09cd883e10e41cd103c27637ade38498))
* **figures:** demote fragment rasters to page-render in place ([#422](https://github.com/caelum29/calibre-mcp/issues/422)) ([#427](https://github.com/caelum29/calibre-mcp/issues/427)) ([9fe3545](https://github.com/caelum29/calibre-mcp/commit/9fe354592e5ff118f8296e4222b88c4f1b585137))
* **figures:** EPUB figures carry section §N, not page p.N ([bf42ae4](https://github.com/caelum29/calibre-mcp/commit/bf42ae4cffc6eb2063e3650d8ed7c33058bfd95c))
* **figures:** EPUB figures carry section §N, not page p.N ([#553](https://github.com/caelum29/calibre-mcp/issues/553)) ([bcf507f](https://github.com/caelum29/calibre-mcp/commit/bcf507fd4eadd23650f49a2ebdcadb47198d65dc))
* **figures:** pair captions with images by order, not adjacency ([#537](https://github.com/caelum29/calibre-mcp/issues/537)) ([8b85a6b](https://github.com/caelum29/calibre-mcp/commit/8b85a6b44929ee3674ac6d5e64e6004fa767849a))
* **figures:** pair captions with images by order, not adjacency ([#537](https://github.com/caelum29/calibre-mcp/issues/537)) ([8826cef](https://github.com/caelum29/calibre-mcp/commit/8826cef64f1057a9ee8499bdb1bb2fe47fb7f903))
* **figures:** typed SCAN_FAILED for EPUBs missing container.xml or OPF ([#485](https://github.com/caelum29/calibre-mcp/issues/485)) ([48ba92d](https://github.com/caelum29/calibre-mcp/commit/48ba92d10348f494b87ac99f7e3cf139f6c01a4d))
* **figures:** typed SCAN_FAILED for EPUBs missing container.xml or OPF ([#485](https://github.com/caelum29/calibre-mcp/issues/485)) ([d07c6cd](https://github.com/caelum29/calibre-mcp/commit/d07c6cd6c8d6b5776456e09984e716f626ce4637))
* **fts:** column names outside NOT are not highlight terms ([#389](https://github.com/caelum29/calibre-mcp/issues/389)) ([8c7d93c](https://github.com/caelum29/calibre-mcp/commit/8c7d93c563d903b8595fdd7943fe2b73ce6bde8c))
* **fts:** column names outside NOT are not highlight terms; pin NOT col:NEAR ([#389](https://github.com/caelum29/calibre-mcp/issues/389)) ([06731ca](https://github.com/caelum29/calibre-mcp/commit/06731ca695e7ab94ab1ef1f333b76e283290d42b))
* **fts:** negate a column-filtered NOT operand as a whole in highlight repair ([44d056f](https://github.com/caelum29/calibre-mcp/commit/44d056fc74127993e0cde0c3195b215dbe56bb29))
* **fts:** negate a column-filtered NOT operand as a whole in highlight repair ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([268b61e](https://github.com/caelum29/calibre-mcp/commit/268b61e34d8a650e36972559543e2cb8b698aa0a))
* **fts:** reuse the EN+RU Snowball stemmer; never highlight NOT operands ([fd5694f](https://github.com/caelum29/calibre-mcp/commit/fd5694fc6d2fb42be1416fff27b3d3729976f020))
* **fts:** reuse the EN+RU Snowball stemmer; never highlight NOT operands ([#340](https://github.com/caelum29/calibre-mcp/issues/340)) ([dec1d18](https://github.com/caelum29/calibre-mcp/commit/dec1d182fa024e09b51f34e22573f04ab1725f94))
* **get-content:** continue from a cursor-only call ([cb8248a](https://github.com/caelum29/calibre-mcp/commit/cb8248a3c53cdccf36f90e592adbaa6eee7bba71))
* **get-content:** continue from a cursor-only call ([#536](https://github.com/caelum29/calibre-mcp/issues/536)) ([4e6ed49](https://github.com/caelum29/calibre-mcp/commit/4e6ed492c87c69e81b0948fc95a70da779f7548e))
* **get-content:** sentenceAware ends chunks at sentence ends, not line wraps ([#551](https://github.com/caelum29/calibre-mcp/issues/551)) ([4bcfdec](https://github.com/caelum29/calibre-mcp/commit/4bcfdec9fd709a94481548acc04cda1fc0db28ee))
* **get-content:** sentenceAware ends chunks at sentence ends, not line wraps ([#551](https://github.com/caelum29/calibre-mcp/issues/551)) ([fd913b7](https://github.com/caelum29/calibre-mcp/commit/fd913b7eda79daae7a5df42db5d05ef5c9faf72f))
* **index:** anchor and canonicalise the label match in indexedFigureCaption ([#428](https://github.com/caelum29/calibre-mcp/issues/428)) ([84b5de6](https://github.com/caelum29/calibre-mcp/commit/84b5de62ca71ec02c5d505c9aeeb839369f4d84c))
* **index:** store and embed the inventory's full figure caption ([#428](https://github.com/caelum29/calibre-mcp/issues/428)) ([15c4e29](https://github.com/caelum29/calibre-mcp/commit/15c4e29c4b86819d950734146b1fff09bd2ef7d2))
* **index:** store and embed the inventory's full figure caption ([#428](https://github.com/caelum29/calibre-mcp/issues/428)) ([2f61289](https://github.com/caelum29/calibre-mcp/commit/2f61289437ab301ea0aed49a2bafc098bf7899b6))
* **labelled-lines:** match ping's gate-off writes line, register build_index FTS line, narrow Code/Next to handler errors ([#493](https://github.com/caelum29/calibre-mcp/issues/493), [#519](https://github.com/caelum29/calibre-mcp/issues/519)) ([f5b8003](https://github.com/caelum29/calibre-mcp/commit/f5b80037650fc3b53886ad9c21574981f563ab77))
* **labelled-lines:** narrow Code/Next contract, fix ping writes pattern, register build_index FTS line ([4df2a3c](https://github.com/caelum29/calibre-mcp/commit/4df2a3ccc28430711f5a8f9ee76c7ffd6e9c97f2))
* **labelled-lines:** register calibre_remove_book's Not found line ([#529](https://github.com/caelum29/calibre-mcp/issues/529)) ([91e2b6e](https://github.com/caelum29/calibre-mcp/commit/91e2b6eef6e15dd55824aa2927d1075856837ef4))
* **labelled-lines:** register remove_book's Not found line; supported-versions wording true across 1.0.0 ([a3dceb0](https://github.com/caelum29/calibre-mcp/commit/a3dceb0d0eca65d91916fccc6f1d02593c6edc9b))
* **logging:** collapse repeated errors in the recentErrors ring ([8c0ea0d](https://github.com/caelum29/calibre-mcp/commit/8c0ea0dce2a9ca14a81188cda37bea3734f8b79b))
* **logging:** collapse repeated errors in the recentErrors ring ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([03f728c](https://github.com/caelum29/calibre-mcp/commit/03f728c43e48bd5117120c2f72e4b7719080cff9))
* **merge:** never claim nothing changed for an unverified step; name the sources left ([#413](https://github.com/caelum29/calibre-mcp/issues/413)) ([6979c80](https://github.com/caelum29/calibre-mcp/commit/6979c80c0c3e4a5283aff2ec4804a5f6c747b1d1))
* **merge:** no false retry count, one steer and one full stop in transient step text ([#417](https://github.com/caelum29/calibre-mcp/issues/417)) ([d411683](https://github.com/caelum29/calibre-mcp/commit/d41168352aa28fa7a2b45b982327e04f3bc7e904))
* **merge:** settle dropped-mid-request merge steps by a re-read ([#413](https://github.com/caelum29/calibre-mcp/issues/413)) ([475ba0c](https://github.com/caelum29/calibre-mcp/commit/475ba0c8868f2ba590696c1cb15e7621ecaf22f3))
* **merge:** settle dropped-mid-request merge steps by a re-read ([#413](https://github.com/caelum29/calibre-mcp/issues/413)) ([60c29ea](https://github.com/caelum29/calibre-mcp/commit/60c29ea038eb4eb968f1e36c0f16baf6c9104fca))
* **ping:** cap the live-id walk and mark an unchecked index count ([#496](https://github.com/caelum29/calibre-mcp/issues/496)) ([333fe64](https://github.com/caelum29/calibre-mcp/commit/333fe64ed52a059397aaed598619f2a09d7b8f25))
* **ping:** keep the default library in the capped Index text and say busy on the semantic line ([#440](https://github.com/caelum29/calibre-mcp/issues/440)) ([12609fe](https://github.com/caelum29/calibre-mcp/commit/12609fe1bbeb5730bd948d7c293da8c263f7b36a))
* **ping:** report an unknown CALIBRE_MCP_LIBRARY as a config error, not unreachable ([#438](https://github.com/caelum29/calibre-mcp/issues/438)) ([2974f16](https://github.com/caelum29/calibre-mcp/commit/2974f16c7f84d3d459c488154202bd9b521dc4a8))
* **ping:** send the write probe as one bodiless POST that never follows a redirect ([#439](https://github.com/caelum29/calibre-mcp/issues/439)) ([c49c829](https://github.com/caelum29/calibre-mcp/commit/c49c82927b6d604dceb2138aac959678be6f5c3a))
* **quality:** flag dot slugs, download-site tags, [source] prefixes, copy and Kindle img leftovers ([#558](https://github.com/caelum29/calibre-mcp/issues/558)) ([db2c62d](https://github.com/caelum29/calibre-mcp/commit/db2c62d8241e2986add23861554f731d9101f2ee))
* **quality:** flag dot slugs, download-site tags, [source] prefixes, copy and Kindle img titles ([e8ef0ed](https://github.com/caelum29/calibre-mcp/commit/e8ef0ed2619979ac4de9a21fcc4aff5c6fdc7e27))
* **recover-metadata:** de-slug only filename-shaped titles, not Self-Hosting ([#549](https://github.com/caelum29/calibre-mcp/issues/549)) ([affb43c](https://github.com/caelum29/calibre-mcp/commit/affb43ce6ae4671b396ca68988536617aa8a32bb))
* **recover-metadata:** look up slug titles as a de-slugged title query ([544efd0](https://github.com/caelum29/calibre-mcp/commit/544efd0d4cba11e4d24a53169afc3aa979b48265))
* **recover-metadata:** look up slug titles as a de-slugged title query ([#549](https://github.com/caelum29/calibre-mcp/issues/549)) ([77ed68b](https://github.com/caelum29/calibre-mcp/commit/77ed68b938416b6badae57ee695e782484c1e21b))
* **reindex:** progress-log names can't collide after sanitising library ids ([571543c](https://github.com/caelum29/calibre-mcp/commit/571543c315a9a122b3cebce267490ff23c4d930c))
* **remove-book:** report unknown ids as not found in dry-run and apply ([3587f85](https://github.com/caelum29/calibre-mcp/commit/3587f85117adcf1f60f5ff74e86c527df3f9dffd))
* **remove-book:** report unknown ids as not found instead of counting them ([#519](https://github.com/caelum29/calibre-mcp/issues/519)) ([11ede04](https://github.com/caelum29/calibre-mcp/commit/11ede04c7b03eada9fe36e16a67554c38ac94a52))
* **resources:** decode the libId segment once on read; docs state ID-only ([#432](https://github.com/caelum29/calibre-mcp/issues/432)) ([de4f468](https://github.com/caelum29/calibre-mcp/commit/de4f468cfbbf8ee7c1d9753766fdb66be45b6a8b))
* **result:** book not_found error names one next step ([#498](https://github.com/caelum29/calibre-mcp/issues/498)) ([ea00478](https://github.com/caelum29/calibre-mcp/commit/ea00478ae3f79ad5b38a347b36d631d0be229a0a))
* **result:** book not_found names one next step ([#498](https://github.com/caelum29/calibre-mcp/issues/498)) ([e0946a1](https://github.com/caelum29/calibre-mcp/commit/e0946a1f0b163cb1d8463d9be3f858a2b9147fa0))
* **result:** one write-refused remedy for the hint, the refusal message and ping ([#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([853421f](https://github.com/caelum29/calibre-mcp/commit/853421fe038edebf233dcbdec35a941d30e40b38))
* **result:** search errors and ping's busy report state one next step ([#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([4589094](https://github.com/caelum29/calibre-mcp/commit/4589094ba986f28117777567fc44dad904e6542b))
* **result:** state each error's next step once at sites that word their own ([#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([4878fd0](https://github.com/caelum29/calibre-mcp/commit/4878fd06be888713a0fdd91f12a820545fc6f282))
* **result:** state each error's next step once; one write-refused remedy ([296fb71](https://github.com/caelum29/calibre-mcp/commit/296fb717bb7f609092f3096dfb75c2a6d4602e45))
* **result:** steer numeric-id not-found in extract_isbn, real id for the bookId alias ([#498](https://github.com/caelum29/calibre-mcp/issues/498)) ([c976bfb](https://github.com/caelum29/calibre-mcp/commit/c976bfb26cc835cc773775dcdd46349b72a4764b))
* **result:** steer numeric-id not-found in extract_isbn, real id for the bookId alias ([#498](https://github.com/caelum29/calibre-mcp/issues/498)) ([02d3791](https://github.com/caelum29/calibre-mcp/commit/02d3791b534a82ee03d191b81acdb3141449f751))
* **search:** column filters in mode=fts get a steer; drop column-aware highlight ([#419](https://github.com/caelum29/calibre-mcp/issues/419)) ([763fde3](https://github.com/caelum29/calibre-mcp/commit/763fde35d6c6402a77685edaaa89ef85b3cf3d31))
* **search:** drop column-aware FTS highlight path, steer column filters to mode=meta ([#419](https://github.com/caelum29/calibre-mcp/issues/419)) ([be6a4f4](https://github.com/caelum29/calibre-mcp/commit/be6a4f45e7c365cacd8424c9464774c896bb63d4))
* **search:** fill the title of whole-book annotation records from the book ([#519](https://github.com/caelum29/calibre-mcp/issues/519)) ([96ca6fd](https://github.com/caelum29/calibre-mcp/commit/96ca6fddb7eb745ef3263211b5617d20b2f8be5c))
* **search:** guard user text from calibredb flags, map FTS5 errors to invalid_input, tolerate lines around JSON ([#500](https://github.com/caelum29/calibre-mcp/issues/500)) ([0b1bbbe](https://github.com/caelum29/calibre-mcp/commit/0b1bbbe460468773f29af0f702c6a87e1ef3b334))
* **search:** title on whole-book annotations; notes #custom argv test ([#519](https://github.com/caelum29/calibre-mcp/issues/519)) ([eaca5c9](https://github.com/caelum29/calibre-mcp/commit/eaca5c9d96b682d3435306e864aa1fe64129745c))
* **semantic:** break fused figure ties by (bookId, figureId) ([#457](https://github.com/caelum29/calibre-mcp/issues/457)) ([30d5db0](https://github.com/caelum29/calibre-mcp/commit/30d5db041e7c16548d4706e7c8baca4c9d502082))
* **semantic:** break fused figure ties by (bookId, figureId) ([#457](https://github.com/caelum29/calibre-mcp/issues/457)) ([542a727](https://github.com/caelum29/calibre-mcp/commit/542a727e11905d0d7a02f0bb0fb82ed18747f211))
* **semantic:** collision-free and length-capped progress log names ([9feb792](https://github.com/caelum29/calibre-mcp/commit/9feb792613da3f52c1c71888d19a90c01ef42abb))
* **semantic:** collision-free and length-capped progress log names ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([4b31ccb](https://github.com/caelum29/calibre-mcp/commit/4b31ccbbeafea7e7c7aa0ffa3b6ed60a0c45bf19))
* **semantic:** drop candidate caches on another connection's commit via data_version ([#337](https://github.com/caelum29/calibre-mcp/issues/337)) ([2371e3a](https://github.com/caelum29/calibre-mcp/commit/2371e3ae8345995592fbe7f3e4a786b61b1346d2))
* **semantic:** drop hits for books removed or merged in the Calibre GUI ([#579](https://github.com/caelum29/calibre-mcp/issues/579)) ([0969bf9](https://github.com/caelum29/calibre-mcp/commit/0969bf9a0e255664903e00451bd81fea7f75e4fa))
* **semantic:** drop hits for books removed or merged in the Calibre GUI ([#579](https://github.com/caelum29/calibre-mcp/issues/579)) ([6d14b69](https://github.com/caelum29/calibre-mcp/commit/6d14b69efea5c12d297bd217497a132de1fa87ae))
* **semantic:** drop removed and merged books from the index after a confirmed write ([#496](https://github.com/caelum29/calibre-mcp/issues/496)) ([33a8e0d](https://github.com/caelum29/calibre-mcp/commit/33a8e0d7995a29095e5a458f5316937de735864d))
* **semantic:** drop removed and merged books from the index after a confirmed write ([#496](https://github.com/caelum29/calibre-mcp/issues/496)) ([41bebef](https://github.com/caelum29/calibre-mcp/commit/41bebef8752ede36ae7a152f4984b476f1790ce8))
* **semantic:** drop stale candidate caches when another process commits ([d152da9](https://github.com/caelum29/calibre-mcp/commit/d152da9235d2f1edc7d3571ae810b169529f92c8))
* **semantic:** hash sanitised library ids in progress-log names ([#344](https://github.com/caelum29/calibre-mcp/issues/344)) ([3ac7a45](https://github.com/caelum29/calibre-mcp/commit/3ac7a4523b18cc44fcb3b852310737cba908a6e2))
* **semantic:** judge confidence on live hits only; not_found for a pruned gone book ([#579](https://github.com/caelum29/calibre-mcp/issues/579)) ([8e61ea9](https://github.com/caelum29/calibre-mcp/commit/8e61ea906565f29b5ba185f7d76788c02d5ebcb9))
* **semantic:** make the index owner claim atomic across processes ([#414](https://github.com/caelum29/calibre-mcp/issues/414)) ([7119f66](https://github.com/caelum29/calibre-mcp/commit/7119f663b339d077c2736ef3597242be702d7931))
* **semantic:** pin progress-log hash name, document suffix ([#344](https://github.com/caelum29/calibre-mcp/issues/344)) ([79b4027](https://github.com/caelum29/calibre-mcp/commit/79b402744f5c0eb4c83d03a6b27f7d45603761d3))
* **semantic:** print the [#388](https://github.com/caelum29/calibre-mcp/issues/388) refusal on ping's semantic line and document it ([#388](https://github.com/caelum29/calibre-mcp/issues/388)) ([db0b261](https://github.com/caelum29/calibre-mcp/commit/db0b261fce5115925fff24c668bccfa87722e715))
* **semantic:** read-only counts treat a missing table as empty ([#325](https://github.com/caelum29/calibre-mcp/issues/325)) ([a6d3c00](https://github.com/caelum29/calibre-mcp/commit/a6d3c00b57a5de823eae127182847395762e7a67))
* **semantic:** refresh candidate caches per changed book, not per library ([741a548](https://github.com/caelum29/calibre-mcp/commit/741a5489b02e1b0682da5fa00ca66e75b52b5422))
* **semantic:** refresh candidate caches per changed book, not per library ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([cb83d55](https://github.com/caelum29/calibre-mcp/commit/cb83d555c7410d91734f46be4e5f496374ceb1bc))
* **semantic:** refuse a library whose id differs from another only in case ([#388](https://github.com/caelum29/calibre-mcp/issues/388)) ([d879ecb](https://github.com/caelum29/calibre-mcp/commit/d879ecb437828a27e19de5990eabfc36e951e8ef))
* **semantic:** refuse indexing a library whose id differs from another only in case ([a52c9df](https://github.com/caelum29/calibre-mcp/commit/a52c9df1de6837fb07da73af218cac7255ebeafb))
* **semantic:** snippet window never cuts a surrogate pair ([#325](https://github.com/caelum29/calibre-mcp/issues/325)) ([b1e9b50](https://github.com/caelum29/calibre-mcp/commit/b1e9b50a12f6ce956f0d303237baf8a53a983c47))
* **semantic:** steer a keyword-only index to a rebuild when the model is present ([#559](https://github.com/caelum29/calibre-mcp/issues/559)) ([c61d728](https://github.com/caelum29/calibre-mcp/commit/c61d7283809bc941f121d7fe5b7862d9baa4492f))
* **semantic:** steer a keyword-only index to a rebuild when the model is present ([#559](https://github.com/caelum29/calibre-mcp/issues/559)) ([2749bd3](https://github.com/caelum29/calibre-mcp/commit/2749bd3034ef62cb053feec6e8c4540bca52b41d))
* **semantic:** surface the [#388](https://github.com/caelum29/calibre-mcp/issues/388) case clash on every index read path ([#388](https://github.com/caelum29/calibre-mcp/issues/388)) ([88f71b3](https://github.com/caelum29/calibre-mcp/commit/88f71b39b30c69f3c3b61f78fef6d87a108b1cec))
* **semantic:** the library indexed first owns a case-colliding index ([#414](https://github.com/caelum29/calibre-mcp/issues/414)) ([f0c3536](https://github.com/caelum29/calibre-mcp/commit/f0c35368b82d8f2febdd996742d900f273134db1))
* **semantic:** the library indexed first owns a case-colliding index ([#414](https://github.com/caelum29/calibre-mcp/issues/414)) ([a329a7f](https://github.com/caelum29/calibre-mcp/commit/a329a7ff9bcf3f04a0bdb15bc148cbb633aac01f))
* **tools:** cancel summary adds up, real failures during a cancel, read-only ping counts ([#325](https://github.com/caelum29/calibre-mcp/issues/325)) ([e73cbe4](https://github.com/caelum29/calibre-mcp/commit/e73cbe4973d8e12dd72e4b9be67fc1ec06af44ec))
* **tools:** honest build_index progress counts, one ping Index budget, keyword-only label ([#325](https://github.com/caelum29/calibre-mcp/issues/325)) ([20ad7c8](https://github.com/caelum29/calibre-mcp/commit/20ad7c8c1f2302621b25971c8fcb5d2441211eac))
* **tools:** put bulk preview warnings in structuredContent too ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([8c182a2](https://github.com/caelum29/calibre-mcp/commit/8c182a21613cbf0b3cf5043cc148b72a0441ebdd))
* **tools:** re-read a dropped write before trusting a later refusal, report real retry count ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([73c4375](https://github.com/caelum29/calibre-mcp/commit/73c43752b7db2e8a13959661755eb26f606266a9))
* **tools:** re-read before skipping a no-op tag book, trim and split in the intended check ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([2d42334](https://github.com/caelum29/calibre-mcp/commit/2d4233428d684c032f649fc06812da426723b969))
* **tools:** say when a write's success came from a re-read, in both channels ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([daae12f](https://github.com/caelum29/calibre-mcp/commit/daae12f96cbff139a5d1c58aa1793ae853c828ee))
* **tools:** skip the no-op set_metadata for tag merges that change nothing ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([37fdcb7](https://github.com/caelum29/calibre-mcp/commit/37fdcb7652e2ff912dd5148a87a152cfd8a2fac0))
* **tools:** verify a dropped bulk write by re-read before failing it ([a41cb3b](https://github.com/caelum29/calibre-mcp/commit/a41cb3bfca960a0e95f7e7621cf51e79ff87229c))
* **tools:** verify a dropped bulk write by re-read before failing it ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([f9795e1](https://github.com/caelum29/calibre-mcp/commit/f9795e19f6b41398154ced1ad4ded5e10ceb03f8))
* **tools:** verify a write that dropped on any retry attempt, match errorCode to the re-read ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([555f69f](https://github.com/caelum29/calibre-mcp/commit/555f69f282ab9de458090af95945d20581fc6350))
* **tools:** verify an ambiguous write against the intended values, not just a change ([#370](https://github.com/caelum29/calibre-mcp/issues/370)) ([6fb04d5](https://github.com/caelum29/calibre-mcp/commit/6fb04d518b9d862a0ae12edde319d96d8814c5b1))
* **tools:** verify writes against intended values and report re-read confirmations ([f181e76](https://github.com/caelum29/calibre-mcp/commit/f181e7656b51565cd7778dcdf93e1c535bd0c373))
* **ui:** board collapses on annotations, notes and figure-hit calls ([125d489](https://github.com/caelum29/calibre-mcp/commit/125d4897be3047df12232b6cf54b0cfc2b89ffc4))
* **ui:** board collapses on annotations, notes and figure-hit calls ([#535](https://github.com/caelum29/calibre-mcp/issues/535)) ([e622211](https://github.com/caelum29/calibre-mcp/commit/e62221100edc0397f0e153a3a486367d87282217))
* **update-book:** fold identifier scheme names to lowercase before merging ([#563](https://github.com/caelum29/calibre-mcp/issues/563)) ([b91dfd3](https://github.com/caelum29/calibre-mcp/commit/b91dfd37014eb1634daacf0ab4fabee7bf6df62b))
* **update-book:** invalid_input for bad identifiers, normalise partial pubdate ([#421](https://github.com/caelum29/calibre-mcp/issues/421), [#423](https://github.com/caelum29/calibre-mcp/issues/423)) ([0b99ab1](https://github.com/caelum29/calibre-mcp/commit/0b99ab1be806e378d9149fd3860fbbd8e1296379))
* **update-book:** merge identifiers by scheme in update_book and bulk_update ([#563](https://github.com/caelum29/calibre-mcp/issues/563)) ([748c5f8](https://github.com/caelum29/calibre-mcp/commit/748c5f85861a36e3eebe53d0ff613e43885355ab))
* **update-book:** merge identifiers by scheme in update_book and bulk_update ([#563](https://github.com/caelum29/calibre-mcp/issues/563)) ([b81e107](https://github.com/caelum29/calibre-mcp/commit/b81e1071d6781dbd2b474c4a40685b35dd85d940))
* **update-book:** typed invalid_input for bad identifiers; normalise partial pubdate ([#421](https://github.com/caelum29/calibre-mcp/issues/421), [#423](https://github.com/caelum29/calibre-mcp/issues/423)) ([95df6b5](https://github.com/caelum29/calibre-mcp/commit/95df6b5ef31c3c5eff4562baf6f2b0321e109c16))
* **update-book:** validate bulk_update values up front; pad one-digit pubdate month ([#421](https://github.com/caelum29/calibre-mcp/issues/421), [#423](https://github.com/caelum29/calibre-mcp/issues/423)) ([1f348d9](https://github.com/caelum29/calibre-mcp/commit/1f348d97214219ebf00527c4f3bdc6717d5a506e))
* **write-gate:** gate-off previews name the remedy instead of a refused call or hidden tool ([#519](https://github.com/caelum29/calibre-mcp/issues/519)) ([73b54ae](https://github.com/caelum29/calibre-mcp/commit/73b54aedb297196132a831d1cfc75fe3236760b5))
* **write-gate:** gate-off previews name the remedy, never a refused call or hidden tool ([53263af](https://github.com/caelum29/calibre-mcp/commit/53263af2ab2fd06b54c617f007fddb93ef57876b))
* **write:** presenter returns code, text and hint; one next step per failed write ([#417](https://github.com/caelum29/calibre-mcp/issues/417)) ([294cbb0](https://github.com/caelum29/calibre-mcp/commit/294cbb0bc7c0867e6494055180efc50a8881a910))
* **write:** presenter returns code, text and hint; tools pass them through ([#417](https://github.com/caelum29/calibre-mcp/issues/417), [#437](https://github.com/caelum29/calibre-mcp/issues/437)) ([fa03e92](https://github.com/caelum29/calibre-mcp/commit/fa03e9293d3df9b86b2160606fe927a8bc6098c2))
* **writes:** one equality in previews/merge, honest list-replacement wording, verify dropped connections ([d3b4a40](https://github.com/caelum29/calibre-mcp/commit/d3b4a400a37415edb543f6fc8bd3108141341d5f))
* **writes:** one equality in previews/merge, honest list-replacement wording, verify dropped connections ([#342](https://github.com/caelum29/calibre-mcp/issues/342)) ([075666d](https://github.com/caelum29/calibre-mcp/commit/075666d0e149f9228b656ce63be95e083fbf3180))

## [0.12.0](https://github.com/caelum29/calibre-mcp/compare/v0.11.0...v0.12.0) (2026-10-30)


### Added

* **structure:** EPUB TOC (nav.xhtml / NCX) as a chapter-map source ([#135](https://github.com/caelum29/calibre-mcp/issues/135)) ([c7dbd55](https://github.com/caelum29/calibre-mcp/commit/c7dbd559f51407c63b085ca56cf8a0b7583d57ee))

## [0.11.0](https://github.com/caelum29/calibre-mcp/compare/v0.10.0...v0.11.0) (2026-10-30)


### Added

* **observability:** agent-readable JSONL logs in `<index dir>/logs/calibre-mcp-YYYY-MM-DD.jsonl` — one record per tool call with timing and outcome, daily rotation with retention, calibredb argv/diag redacted; `calibre_ping` now reports `recentErrors`. Level via `CALIBRE_MCP_LOG_LEVEL` ([#247](https://github.com/caelum29/calibre-mcp/issues/247))
* **semantic:** EmbeddingGemma 2 (768/256) available as evaluation candidates; the default model stays `multilingual-e5-small` ([#139](https://github.com/caelum29/calibre-mcp/issues/139), [#209](https://github.com/caelum29/calibre-mcp/pull/209))


### Changed

* **logging:** stderr lines are now the same JSON objects as the log files, prefixed `[calibre-mcp] ` (was `[calibre-mcp] LEVEL msg {json}`). If you grep the host log (e.g. Claude Desktop's `main.log`) for `ERROR`, match `"lvl":"error"` instead ([#247](https://github.com/caelum29/calibre-mcp/issues/247), [#250](https://github.com/caelum29/calibre-mcp/pull/250))


### Fixed

* **writes:** transient calibredb errors are retried on idempotent writes; a connection dropped mid-request is reported as "may have committed" instead of failed ([#233](https://github.com/caelum29/calibre-mcp/issues/233))
* **writes:** the #33 timeout-verify path is shared by every write tool, so a timed-out write is checked against a re-read everywhere ([#221](https://github.com/caelum29/calibre-mcp/issues/221)); that re-read now compares fields the same way the diff does, so a committed clear or a reordered identifiers map is no longer reported as not landed ([#254](https://github.com/caelum29/calibre-mcp/pull/254))
* **writes:** calibredb's 401 credentials prompt is classified as a write refusal with a fix-it steer ([#237](https://github.com/caelum29/calibre-mcp/issues/237))
* **update-book:** no-op fields are dropped from the diff, empty and absent values compare equal, the summary names only fields that changed, and an empty unverified diff says "no-op" ([#202](https://github.com/caelum29/calibre-mcp/issues/202), [#216](https://github.com/caelum29/calibre-mcp/issues/216), [#235](https://github.com/caelum29/calibre-mcp/issues/235))
* **bulk-update:** a mid-loop refusal keeps already-committed books visible and hands back `retryIds` with a re-run steer; `ids` combined with `query` is rejected; per-id errors collapse to one bounded line ([#213](https://github.com/caelum29/calibre-mcp/issues/213), [#214](https://github.com/caelum29/calibre-mcp/issues/214), [#216](https://github.com/caelum29/calibre-mcp/issues/216))
* **tools:** one result model for text and `structuredContent` — `nextCursor`, update diffs, quality issues, FTS snippets, duplicate groups and compare diffs now appear in both channels, and book-scope search / `build_index` text names the book ids ([#199](https://github.com/caelum29/calibre-mcp/issues/199), [#211](https://github.com/caelum29/calibre-mcp/issues/211), [#227](https://github.com/caelum29/calibre-mcp/issues/227), [#234](https://github.com/caelum29/calibre-mcp/issues/234))
* **quality-report:** a stringified `readability` boolean is coerced instead of rejected ([#212](https://github.com/caelum29/calibre-mcp/issues/212))
* **metadata:** ISBN recovery skips ad/catalog ISBNs and flags hits whose title disagrees (titles agree on a subset or 2+ shared significant words, EN/RU stop-words ignored); provider authors are normalized, an author list is weak only when every entry is suspect, author-as-publisher is dropped, and ISBN-13 is emitted ([#198](https://github.com/caelum29/calibre-mcp/issues/198), [#201](https://github.com/caelum29/calibre-mcp/issues/201))
* **curation:** more raw-filename title patterns are detected ([#207](https://github.com/caelum29/calibre-mcp/issues/207))
* **ui:** the cover-board cache is keyed by library and filter, so boards from different libraries no longer collide ([#215](https://github.com/caelum29/calibre-mcp/issues/215))

## [0.10.0](https://github.com/caelum29/calibre-mcp/compare/v0.9.0...v0.10.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **semantic:** transformers.js 4.3.1 + INDEX_VERSION 4 (re-index required) ([#194](https://github.com/caelum29/calibre-mcp/issues/194))

### Added

* **semantic:** transformers.js 4.3.1 + INDEX_VERSION 4 (re-index required) ([#194](https://github.com/caelum29/calibre-mcp/issues/194)) ([290c803](https://github.com/caelum29/calibre-mcp/commit/290c8034377c74c506078c1fab7226b82f8a09f0))


### Fixed

* **semantic:** atomic per-book index writes + vector-aware freshness ([#197](https://github.com/caelum29/calibre-mcp/issues/197)) ([#205](https://github.com/caelum29/calibre-mcp/issues/205)) ([30c1470](https://github.com/caelum29/calibre-mcp/commit/30c14709c825f505b0a559791902208b0163fe9b))
* **semantic:** wait on a shared index lock instead of failing ([#196](https://github.com/caelum29/calibre-mcp/issues/196)) ([#206](https://github.com/caelum29/calibre-mcp/issues/206)) ([6caf501](https://github.com/caelum29/calibre-mcp/commit/6caf5015b086deb0a2b9c6b7d107d8007d94192a))

## [0.9.0](https://github.com/caelum29/calibre-mcp/compare/v0.8.0...v0.9.0) (2026-10-23)


### Added

* cancel long tool calls and report progress ([#150](https://github.com/caelum29/calibre-mcp/issues/150)) ([d39c263](https://github.com/caelum29/calibre-mcp/commit/d39c2630387b71c8e69bad73f0138ca9da60d7a6))
* generate the tool catalog and keep tool counts in sync ([#148](https://github.com/caelum29/calibre-mcp/issues/148)) ([bda73ca](https://github.com/caelum29/calibre-mcp/commit/bda73ca2a06a9ab3b8e772648f7fcd728e79e741))


### Fixed

* address verifier findings on the hygiene stack ([#154](https://github.com/caelum29/calibre-mcp/issues/154)) ([9e8c106](https://github.com/caelum29/calibre-mcp/commit/9e8c106fdf6a1989bdd6c4d4d9a621ef58f5ba02))
* kill child process groups and exit when the client goes away ([#145](https://github.com/caelum29/calibre-mcp/issues/145)) ([47cc35d](https://github.com/caelum29/calibre-mcp/commit/47cc35de0cecc779d414ecd8c01fbbc7894c0e04))

## [Unreleased]

### Added

- **`docs/tool-catalog.json`** — the generated, exact `tools/list` the server advertises
  (writes enabled; client-compat rewrites applied), so schema changes show up as a reviewable
  diff. `pnpm catalog` regenerates it; `pnpm catalog:check` fails on drift.
- **Cancellation.** Cancelling a tool call from the client (MCP `notifications/cancelled`)
  now stops the work: running `calibredb` / `ebook-convert` / `pdftotext` / figure-scan
  process groups are killed and downloads are aborted. `calibre_build_index` stops between
  books and reports what was already indexed (re-running the same call resumes).
- **Progress notifications.** `calibre_build_index` (per book) and `calibre_quality_report`
  send MCP progress notifications when the client asks for them (throttled, monotonic).

### Changed

- **Minimum Node.js is now 22.16 (was 22.5).** The semantic index needs `node:sqlite` with
  FTS5: on 22.5–22.12 `node:sqlite` exists only behind `--experimental-sqlite` (the server
  failed to start with `ERR_UNKNOWN_BUILTIN_MODULE`), and 22.13–22.15 ship SQLite without
  FTS5 (index builds failed with `no such module: fts5`). `engines` and the MCPB manifest now
  say `>=22.16`; Node 22 is tested in CI alongside Node 24.
- **Releases are automated with release-please.** Merging the release PR tags `vX.Y.Z`,
  creates the GitHub release and publishes to npm, the GitHub release (`.mcpb`) and the MCP
  Registry from one workflow.
- **Tool counts in the docs and manifests are now generated and correct.** The plugin and
  marketplace descriptions said 17 tools, the skill and `CLAUDE.md` 18; the server advertises
  19 model-facing tools (18 task tools + `calibre_ping`) plus 2 widget-internal ones. Every
  stated count is now maintained from the catalog.

### Fixed

- **No orphaned `calibredb` / `ebook-convert` processes after the client disconnects.**
  Subprocesses run in their own (detached) process group so a timeout can kill the
  conversion worker too — but that also let them outlive the server when the client
  closed stdin or sent SIGTERM mid-call, keeping the library write lock. The server now
  shuts down on stdin EOF/close, SIGINT and SIGTERM, kills every still-running process
  group first, closes the MCP server and exits 0.

## [0.8.0] — 2026-10-23

### Added

- **PDF outline (bookmarks) as a chapter-map source (#134).** `calibre_get_content` structure output can now report `detector: "pdf-outline"`; about 78% of sampled PDFs get an outline map, including books whose text never says "Chapter N".
- **`indexVersion` as citation provenance (#136).** Exposed in `calibre_semantic_search` results and `calibre_ping` (read from the opened index's meta), with a stale-index hint.
- **`pnpm reindex` (#99).** Book-level parallel re-index with worker threads and a single serialized SQLite writer; about 2.35x faster at N=3 (full library roughly 6-7 h vs 15 h), resumable, and refuses the production index without `--production`. `calibre_build_index` itself stays at N=1.
- **Label-only PDF figure captions recovered from page layout** (`pdftotext -bbox-layout`): label-only figures drop from 4,196 to 900 library-wide.

### Changed

- **EPUB front matter is demoted in search (#102).** Heading-structured front matter (title page, copyright, praise, TOC as headings) now ranks lower; the eval gate covers it with a new fixture.
- **RRF fusion weights evaluated (#142).** `VECTOR_RRF_WEIGHT` stays 1.0 (D-021).

### Fixed

- **EPUB figure markers for BPB/Manning caption shapes (#101).** The 14 books that placed 0 figures now place all of them.
- **Figure captions (#107).** No more empty captions, wrapped captions are joined (with an ellipsis when cut), body-text false positives are rejected, two-line bare labels are recognized; page-boundary fallback markers on book 175 go from 57 to 0.
- **Concurrency fixes found during #99.** Chunking is async so other workers' Content Server timers no longer fire spuriously; the extract-cache LRU no longer evicts another book's in-flight temp file.

> **Upgrade note:** figure indexes, front-matter flags and chapter maps changed, so cache versions were bumped. Run a re-index (`pnpm reindex` or `calibre_build_index`) to pick up the figure and front-matter fixes in the semantic index.

## [0.7.6] — 2026-10-21

### Changed

- **Release pipeline is re-runnable (#161).** The release workflow now waits (up to 5 min) for the
  new version to be visible on npm before publishing to the MCP Registry, retries the Registry
  publish up to 3x, and skips `npm publish` when the version already exists, so a failed release
  run can be re-run safely. No server behavior changes.

## [0.7.5] — 2026-10-21

### Added

- **ODT books are now extractable (#132).** OpenDocument-text books no longer get reported
  as having no extractable text format.

### Fixed

- **`calibre_build_index` no longer stops at 100 books (#138).** It now pages through all
  query matches (reported on a 155k-book library) instead of silently truncating.
- **Concurrent semantic searches no longer all time out (#156).** They are serialized
  through a FIFO inference queue.
- **Faster book-scope and bundle keyword search (#155).** An FTS-first CTE stops SQLite
  from re-running `MATCH` per row on book-filtered queries.
- **`calibre_update_book` / `calibre_bulk_update` emit `null` before/after for empty
  fields**, and pubdate proposals are sentinel-aware (#157).
- **Richer text output.** `calibre_get_book` now lists formats, ISBN/identifiers, tags,
  series, publisher, pubdate and languages (#104); EPUB figure search hits show the page
  (#105); `calibre_get_figures` names the other available format (#106);
  `calibre_ping` always reports the semantic model and index counts, and the uncaptioned
  figure-count wording is explicit (#108).
- **PyMuPDF extraction emits `\f` page breaks like pdftotext (#133)**, so page-to-offset
  mapping no longer depends on which backend ran.

## [0.7.4] — 2026-08-21

### Added

- **Markdown books are now extractable and indexable (#12).** `MD`/`MARKDOWN` (plus
  `TXTZ`/`TEXT`) joined the extractor's format-preference list, so a markdown-only book
  is no longer reported as having "no extractable text format" by `calibre_get_content`,
  `calibre_build_index` and ISBN scanning. Markdown ranks **above PDF** — it round-trips
  through `ebook-convert` with headings intact, which chunking leans on. An empty
  markdown/text file now says so instead of blaming an image-only page layer.

### Fixed

- **EPUB figure scans no longer fail when the cache directory is missing.** `unzip -d`
  creates only one missing directory level, so a scan starting from a not-yet-created cache
  dir (fresh boot, or the OS tmp reaper having cleaned it) exited 2 and surfaced as
  `FIGURES_SCAN_FAILED`; the extraction dir is now created up front.

## [0.7.3] — 2026-08-18

### Fixed

- **Cover-board click now opens the book card in Claude Desktop (#130).** Clicking a
  cover sends a `ui/message` request instead of a widget-initiated `tools/call` — Desktop
  never surfaced the result of the latter in the chat, so the click only flashed
  "Opening…" and nothing appeared. Hosts without `ui/message` still fall back to the
  `tools/call` path.

### Chore

- Added `pnpm-workspace.yaml` with `allowBuilds` for `esbuild`/`onnxruntime-node`/
  `protobufjs`/`sharp` (required by pnpm 11); bumped the `open` dependency to `^11.0.1`.

## [0.7.2] — 2026-07-27

### Fixed

- **Empty frame after listing figures.** In MCP Apps hosts, a `calibre_get_figures` call
  that only lists captions left a tall blank panel in the chat instead of rendering
  nothing. The figure viewer now reports zero height when it has nothing to show.

## [0.7.1] — 2026-07-27

### Added

- **In-chat figure viewer (MCP Apps hosts, #112).** Fetching figures with
  `calibre_get_figures` now shows them to *you*, not just to the assistant: a large reading
  pane with a margin rail when several figures come back, caption and page under each one,
  click (or Enter) to zoom to 100% and drag to pan. A figure that couldn't be extracted
  appears as a quiet placard rather than an error, and a plain listing call renders nothing
  at all. Text-only hosts are unaffected — same images in the transcript as before.

### Changed

- **The figure viewer is now documented** in the tool reference, the README and the
  companion `calibre-mcp` skill, where `calibre_get_figures` had been missing from the tool
  map entirely.
- **Stronger nudge to actually read the figure.** Fetch results now tell the assistant the
  images are in its context, ask it to name two things visible in the figure before
  interpreting, and to say plainly when it can't see the image instead of guessing from
  what similar diagrams usually look like.

## [0.7.0] — 2026-07-27

Book **figures** — the diagrams, charts and schemas your books explain things with — are now
first-class: listable, viewable in chat, searchable by caption, and visible as markers in
extracted text.

### Added

- **`calibre_get_figures` (new tool, #18).** Lists a book's captioned figures with page and
  caption so you can judge relevance before spending image tokens, then fetches up to 3 of
  them per call as actual images. Works on EPUB (preferred) and PDF; diagrams drawn as
  vectors — invisible to image extraction — are rendered from the page as a cropped band
  above their caption. Uncaptioned images (covers, decorations, equation art) stay hidden
  unless `include_uncaptioned: true`, and scanned PDFs honestly report 0 figures.
- **Figure search: `target: figures` on `calibre_semantic_search`.** Runs the full hybrid
  pipeline over figure *captions* instead of book text, so "find a diagram of the JWT
  signature flow" ranks captions directly rather than hoping a passage mentions the figure.
  Orthogonal to `scope` — search figures library-wide or inside one book. Hits carry the
  caption, page, surrounding passage, and a ready-made `calibre_get_figures` call.
- **Inline image markers in `calibre_get_content`.** Extracted text now shows
  `[image #N: page 71, "Figure 3-1. …"]` where a figure sits, so a passage that says "as
  shown below" no longer reads as a gap — and the marker names the figure to fetch.
- `calibre_build_index` takes `prune: true` — deletes index entries for books that are no
  longer in the library. Indexing only ever upserts, so removals and merges left orphaned
  chunks that semantic search still returned, pointing at ids that 404 on
  `calibre_get_content`. The prune reports how many books/chunks/figures it dropped, and
  refuses to run at all if the library reports zero books (an empty listing must never wipe
  the index) (#100).

### Fixed

- Large books no longer fail to index with "Download timed out": the download budget now
  bounds **stalled** transfers (no bytes received for 120s, clock reset by every chunk)
  instead of total elapsed time, which a 183 MB PDF cannot meet from a cold cache. A
  stalled download says so, with the byte count received (#100).
- The "no extractable text" message no longer diagnoses every format as a scanned PDF —
  an empty EPUB/AZW3 now reads as a missing text layer (image-only pages or DRM) (#100).
- Reranked result order no longer depends on which other candidates happened to share the
  batch: pairs are now scored one at a time, so the same query returns the same ordering
  regardless of how the candidate pool composed itself.

### Changed

- **Figures and markers enter the index at build time**, so an index built by an earlier
  version needs a `force: true` rebuild before `target: figures` finds anything and before
  extracted text carries image markers. The extraction cache is versioned, so a rebuild
  re-extracts rather than reusing marker-free text.

## [0.6.4] — 2026-07-22

### Fixed

- Claude Desktop 1.24012.x: every tool declaring an `outputSchema` failed with
  "Tool execution failed" — the client rejects the call pre-dispatch when the schema
  contains the `$schema` meta-key, which the MCP TS SDK always emits. The server now
  strips the `$schema` key from `outputSchema` in outgoing `tools/list` results
  (semantics-free), restoring all tools in Desktop.

## [0.6.3] — 2026-07-22

### Fixed

- Tool failures no longer die silently: an unhandled promise rejection in the process
  used to kill the whole server on Node ≥15, surfacing to the client as a detail-free
  "Tool execution failed" with no way to diagnose it. Such rejections are now logged with
  a full stack to stderr and the process survives; uncaught exceptions still log their
  stack before exit. The catch-all error handler around every tool call now also returns
  the actual error name and message (plus a machine-readable `errorCode`) instead of a
  bare "internal error in `<tool>`", so agents get something actionable to act on. Also
  fixed a related crash vector in the ISBN-scan timeout path that could kill the process
  on a later extraction failure.

### Added

- `pnpm pack:mcpb:dev` builds a Claude Desktop test bundle stamped with a
  `X.Y.Z-dev.<sha>[.dirty]` version (staged only — repo files are untouched), so a local
  test install can never be mistaken for a released bundle.

## [0.6.2] — 2026-07-21

### Fixed

- `calibre_remove_book` no longer scares agents into refusing removal on explicit user
  request: the description overstated the danger ("permanently delete… files on disk") —
  in reality `calibredb remove` without `--permanent` moves books to Calibre's Trash,
  restorable from the GUI — and the dry-run returned `isError: true`, which read as
  "dangerous/failed" and primed refusal of the confirm step. The tool now describes the
  Trash-recoverable two-step flow accurately, the dry-run is a success result with steering
  text (gate unchanged: zero writes without `confirm=true`), and the post-removal message
  mentions Trash restorability. `docs/TOOLS.md` aligned.

## [0.6.1] — 2026-07-21

### Added

- `countOnly` parameter on `calibre_search` — answer "how many books match?" with just the
  count: no cover board, no row fetch (#67).
- Cover board hero state: a search that identifies exactly one book renders a card-like
  hero (large cover opens the full book card, title/authors, Open + Search-inside) instead
  of a one-book shelf; the shelf⇄coverflow toggle hides (#71).

### Fixed

- Zero-result searches no longer attach an empty cover board — plain text only, and the
  board widget collapses instead of showing an error (#68).
- Book card: clicked Read/Download buttons no longer disappear after Claude Desktop's
  open-link dialog (approve or decline) — Desktop resolves a successful ui/open-link with
  an error-shaped body, which the widget misread as "host can't open links" (#69).
- Cover board & card: Search-inside (and other message-backed buttons) no longer vanish
  after a successful send; buttons now hide only when the host genuinely lacks the
  ui/message method (-32601) or omits it from its declared capabilities (#72).
- Book card: the Open button no longer flashes/jitters on click — the pending "Opening…"
  state appears only when the call takes longer than 200 ms (#70).

## [0.6.0] — 2026-07-20

### Added

- Action buttons across both in-chat widgets (issue #53): **Open** launches a book in the
  local Calibre viewer via a new widget-internal `calibre_open_book` tool and the
  `calibre://view-book` scheme — it works even on hosts that block link-opening. The book
  card gains per-format **Download** buttons, a click-to-zoom cover, a **Search inside this
  book** input, and a curation row (**Fix metadata**, **Find duplicates**, **Summarize**)
  that hands the request to the assistant in chat. The cover board gains per-card **Open**
  and **Search inside** (re-runs the board's own query inside that book).
- Runtime shelf⇄coverflow toggle on the cover board. `CALIBRE_MCP_BOARD_STYLE` now sets the
  *initial* style; both variants ship in one widget.

### Changed

- The board no longer opens the browser viewer ("Read") — **Open** (local viewer) replaces
  it; the book card keeps per-format browser Read alongside Download.
- Widgets degrade per capability: hosts that refuse chat messages hide the message-backed
  buttons (`data-nomsg`), hosts that refuse links hide Read/Download/zoom (`data-noread`);
  Open is never hidden.

## [0.5.2] — 2026-07-19

### Added

- Coverflow search-results widget: a second visual style for the in-chat cover board (3D
  cover flow with reflections), selectable via `CALIBRE_MCP_BOARD_STYLE=shelf|coverflow`
  (default `shelf`). The Claude Desktop bundle exposes it as a "Coverflow search results"
  toggle in extension settings.

### Changed

- The cover-board widget template is now composed from one shared MCP-plumbing core plus
  per-variant visuals, so both styles share the same data flow, handshake, and degradation
  paths.
- `CALIBRE_MCP_BOARD_STYLE` parsing is tolerant: strips pasted quotes, accepts
  boolean-toggle values (`true`/`1`/`yes`) as coverflow.

## [0.5.1] — 2026-07-19

### Fixed

- **Semantic-search degradation is now loud** ([#41], [#46]). `calibre_build_index` and
  `calibre_semantic_search` report `semanticAvailable` and `semanticReason` in structured
  output, and an automatic keyword-only downgrade now leads the text response with a warning
  instead of reading as unqualified success.
- **"Embedding model missing" guidance now covers every install type** ([#47]). One universal
  message with steps for the Claude Desktop `.mcpb` extension, npx/global npm, and dev
  checkouts — each ending with the required server restart (installing the model while the
  server is running never takes effect on Node 24).
- **Embedder/reranker load failures have stable semantics** ([#45]). A missing
  `@huggingface/transformers` stays a stable coded error (restart after install), while
  transient load failures (e.g. a flaky model download) are no longer cached and can succeed
  on retry.

### Added

- **`calibre_ping` semantic status block** ([#48]) for one-call diagnosis: model id and
  dimension, dependency installed (disk-level check), in-process load state, model cache
  presence, indexed book/vector counts, and a restart-required flag — mirrored into the text
  response.
- Docs: firsthand probe of Node 24's failed-import negative caching
  (`docs/node24-import-retry-probe.md`, [#44]).
- The calibre-mcp skill now documents `calibre_merge_books` (tool map: 16).

## [0.5.0] — 2026-07-19

### Added

- **`calibre_merge_books`** ([#50]) — merge duplicate book records, mirroring Calibre's GUI
  merge (M / Alt+M / Shift+M): moves formats from source books into an explicit target
  (target's copy wins conflicts), merges metadata per Calibre's per-field rules (fill-if-empty,
  tag/identifier unions computed client-side, `\n\n`-concat comments, full custom-column
  support by datatype), then trashes the sources — always recoverable, never `--permanent`.
  `mode=safe` keeps sources, `mode=formatsOnly` moves formats only. Dry-run plan (survivor,
  per-format disposition, metadata diff, advisory dissimilarity warning) unless `confirm=true`;
  execution is a step ledger with delete always last, so a partial failure never loses data
  and re-running safely completes the merge ([#33] semantics). 17th model-facing tool, gated
  behind `CALIBRE_MCP_ENABLE_WRITE`.

### Fixed

- **`calibre_update_book` could report a committed write as failed** ([#33]). Routed writes
  commit server-side before `calibredb` replies, so a failing post-write re-read or a CLI
  timeout could turn a successful write into a tool error. The diff re-read now degrades to a
  success result with the intended-value diff, and CLI timeouts are verified against a re-read:
  confirmed writes report success, unconfirmed ones steer the model to check with
  `calibre_get_book` before retrying. The same verify-on-timeout treatment applies to the
  `calibre_bulk_update` apply loop.
- **`calibre_list_categories` rejected `(?i)`-style inline flags in `valueFilter`** ([#30]).
  JS `RegExp` doesn't accept PCRE/Python inline flags, so patterns like `(?i)o.?reilly|packt`
  failed with "Invalid group" — despite matching already being case-insensitive. Leading
  `(?flags)` groups are now stripped and folded into the RegExp flags; flags JS can't express
  (e.g. `x`) get an explicit message instead of a parser error. Mid-pattern (scoped) inline
  flags are still rejected, since JS has no equivalent.

[#30]: https://github.com/caelum29/calibre-mcp/issues/30
[#33]: https://github.com/caelum29/calibre-mcp/issues/33
[#41]: https://github.com/caelum29/calibre-mcp/issues/41
[#44]: https://github.com/caelum29/calibre-mcp/issues/44
[#45]: https://github.com/caelum29/calibre-mcp/issues/45
[#46]: https://github.com/caelum29/calibre-mcp/issues/46
[#47]: https://github.com/caelum29/calibre-mcp/issues/47
[#48]: https://github.com/caelum29/calibre-mcp/issues/48
[#50]: https://github.com/caelum29/calibre-mcp/issues/50

## [0.4.2] — 2026-07-19

### Added

- **`calibre_get_content` gains a numeric `offset` param** ([#28]). Jump straight to a char
  position — e.g. a search passage's `charStart` — instead of hand-encoding a cursor token.
  Mutually exclusive with `cursor`, tolerant coercion, and an explicit error when the offset is
  past the end of the book. The "Invalid cursor" error and the `calibre_semantic_search` header
  hint now point to `offset`, closing the search→content interop gap.

### Fixed

- **`structure=true` returned generic `Chapter N` placeholders instead of real chapter titles**
  ([#29]). Bare headings are now enriched with the title line typeset below them, and per-page
  running headers no longer steal the chapter start from the real titled heading.

[#28]: https://github.com/caelum29/calibre-mcp/issues/28
[#29]: https://github.com/caelum29/calibre-mcp/issues/29

## [0.4.1] — 2026-07-18

### Fixed

- **`calibre_get_content` forward pagination was unusable in clients that drop
  `structuredContent`** ([#26]). The `nextCursor` token now also appears in the text block
  ("More remains — continue with cursor: `<token>`"), so pagination works even when a client
  only surfaces the text content. Invalid or hand-constructed cursors (e.g. `char:N`) now return
  an actionable error instead of silently restarting at offset 0, and a cursor minted for a
  different book/format errors explicitly rather than returning wrong content. The `structure=true`
  chapter table now includes a cursor column, and the `cursor` param is documented as an opaque
  token to be passed back verbatim.

[#26]: https://github.com/caelum29/calibre-mcp/issues/26

## [0.4.0] — 2026-07-18

### Added

- **In-chat cover board widget** on `calibre_search` and `calibre_semantic_search` (library
  scope only) ([#19], [#22], D-017). A vanilla-JS carousel rendered via MCP Apps (`io.mcp/ui`
  extension, SEP-1865), with covers loaded from the Content Server thumbnail endpoint and a
  generated placeholder fallback for books without one. Supports keyboard navigation; a Read
  button opens the book directly in Calibre's server UI via `ui/open-link`. Only renders on
  hosts that support MCP Apps — other clients get the plain text/resource_link result unchanged.
- **Book detail card widget** on `calibre_get_book`: cover, rating, series, a facts grid, tags,
  per-format Read buttons, and a "Similar" action that kicks off a semantic-search follow-up.
- **`include_cover` param on `calibre_get_book`** (default `false`) — opt in to a base64 cover
  image block in the tool result for clients that want it inline without the widget.

[#19]: https://github.com/caelum29/calibre-mcp/issues/19
[#22]: https://github.com/caelum29/calibre-mcp/issues/22

### Changed

- Added a widget-internal `calibre_board_data` tool (hidden from the model via
  `_meta.ui.visibility: ["app"]`), backed by a server-side board cache, so the cover-board widget
  can still fetch its data on hosts (e.g. Claude Desktop) that strip `structuredContent` from the
  tool-result notification. The model-facing tool surface stays at 15 tools + ping.

## [0.3.0] — 2026-07-18

### Added

- **Front-matter demotion in `calibre_semantic_search scope=book`** ([#18]). TOC, praise-page,
  and foreword text is keyword-dense but semantically empty, so it used to win exactly the
  definitional queries ("what is a bounded context") where body content is wanted. Chunks that
  lie mostly before the first detected chapter are now flagged `front_matter` at index time
  (additive schema migration — existing indexes keep working, books pick the flag up on
  re-index) and are stable-partitioned below body matches after the rerank stage, labeled
  `[front matter]`, with a note in the header. Nothing is filtered out — foreword/TOC queries
  still work. Validated by the new `front-matter-trap` retrieval-eval kind (D-016).
- **`calibre_search scope=book` now steers definitional queries to the semantic path**: the
  tool description warns that calibredb FTS snippets often land in front matter, and when the
  target book has a semantic index the result includes an in-band tip pointing at
  `calibre_semantic_search scope=book`.

[#18]: https://github.com/caelum29/calibre-mcp/issues/18

### Fixed

- **Large books are no longer silently skipped by the indexer.** The book-download cap was a
  hardcoded 64 MB in the HTTP layer that `calibre_build_index` never overrode, so any book whose
  *served* payload exceeded it failed with "Book file exceeds the size limit" — 28 of 795 books
  (3.5%) in a real library. The cap is now configurable via `CALIBRE_MCP_MAX_BOOK_BYTES` and
  defaults to 256 MB. Note the cap must be sized against what the **Content Server serves**, not
  the file on disk: the server can return a far heavier copy (an 8 MB PDF served as 70 MB), which
  is why a seemingly generous disk-sized limit still dropped books.
- **EPUB extraction no longer dies on modern CSS.** Calibre's own markdown text writer raises
  `ValueError: could not convert string to float: 'calc(1em / 2)'` on ebooks using `calc()`, which
  failed extraction outright and dropped the book from the index. `ebook-convert` now retries once
  with `--txt-output-formatting=plain` when markdown conversion fails, keeping markdown (whose
  headings chunking relies on) as the preferred path. Timeouts are not retried.

## [0.2.1] — 2026-07-11

### Added

- **structuredContent mirroring for semantic search and content extraction** —
  `calibre_semantic_search` now mirrors ranked hits into `structuredContent`
  (`results[]` for library scope, `passages[]` for book scope), and
  `calibre_get_content` mirrors its excerpt into `structuredContent.text`.
  Structured-only MCP clients that drop text content blocks no longer lose the
  actual search/read payload.

### Changed

- **`localWrite` classification for index-directory writes** — `calibre_build_index`
  writes the server's own semantic-index directory, not the user's library, so it's
  intentionally left ungated. That carve-out is now explicit via a new
  `ToolDescriptor.localWrite` marker plus a boot-time invariant
  (`assertWriteClassification()`) that fails loud if any non-read-only tool declares
  neither `write` nor `localWrite` — no more silently unclassified mutators.

## [0.2.0] — 2026-07-09

The semantic-search suite. **Breaking for existing indexes**: `INDEX_VERSION` bumped
2 → 3 (chunking v3 changes chunk boundaries) — run `calibre_build_index` again to
rebuild before using semantic/hybrid search.

### Added

- **Cross-encoder rerank stage** (`bge-reranker-v2-m3`, q8) — always-on second pass for
  hybrid and vector search results, pool cap 30 candidates, model pre-downloaded at
  build time, `CALIBRE_MCP_RERANK` env var as an escape hatch to disable it (D-011).
- **Chunking v3** — drops the old fixed-overlap window and budgets chunks in real
  model tokens instead of characters, for tighter and more consistent chunk sizes.
  `INDEX_VERSION` is now `3`; existing indexes must be rebuilt.
- **Weighted FTS + hybrid fusion** — a new `book_meta` FTS column (weighted bm25) feeds
  a weighted-RRF fusion seam alongside vector search, improving keyword/metadata recall
  in hybrid mode.
- **Golden-query retrieval eval harness** — 50 labeled EN+RU queries over a fixture
  corpus (`pnpm eval`), with committed baseline, reranker, and model-bake-off reports
  for regression tracking.
- Per-library candidate-vector cache for faster repeat semantic queries.

### Changed

- Semantic embedding model reaffirmed as `multilingual-e5-small` after a model
  bake-off against alternatives (D-012/D-013).

### Fixed

- `bookId` is now accepted as an alias for `id` on single-book tools.
- nDCG@k no longer double-counts label credit on duplicate-label positions (could
  previously exceed 1.0).

## [0.1.6] — 2026-07-07

### Added

- **`calibre_get_content` `structure` param + `calibre-distill` skill** (idea 08) — the
  extractor can now return a book's chapter structure (heading detection with Cyrillic
  chapter-word support and ToC awareness), and a companion `calibre-distill` skill turns a
  single book into a compressed, cursor-linked Agent Skill. No new tool (one param on an
  existing tool); tool count stays at 15.
- **`calibre-distill-topic` companion skill** — multi-book topic synthesis (the D1.7
  distributable artifact class): synthesizes one topic across ≥3 library books into a
  single concept-keyed Agent Skill with a mandatory "where the sources disagree or
  complement" section, an ISBN bibliography-as-L4 block, and a `kind: topic-aggregate`
  `distill.manifest.yaml`. Zero new MCP tools; cross-linked both ways with
  `calibre-distill`.
- **Legal-gate verifier** (`src/domain/distill/legal-gate.ts` + `scripts/legal-gate.mjs`) —
  mechanical D1.4 admission checks for generated distill skills: 8-gram verbatim-shingle
  overlap (with title/author allowlist), quote budget (25 words/quote, 200/skill), ≥20×
  compression floor, heading-match (L4 block exempt), content-cursor leak detection, and
  attribution presence. CLI reads the skill dir + manifest, pulls source text via the
  Content Server, prints a per-check report, exits 0/1. Zero new deps, zero new tools.

### Changed

- **`calibre-distill` skill: Rule 7 enforced** — the Step 7 verbatim-reproduction
  instructions (exact-syntax code examples, reproduced tables, faithful worked examples,
  verbatim chapter headings) are replaced with re-authoring instructions; Quality Rule 7
  gains a numeric quote budget (25 words/quote, 200/skill) and generated skills now carry
  a mandatory attribution block ("buy the book" line included).

### Docs

- `docs/PRODUCT-DECISIONS.md`: D1.7 prototype-validation findings folded in; **D3**
  resolves the registry shape (git-convention rail on GitHub surfaced as a Claude Code
  plugin marketplace, single regenerated index file, PR → CI legal-gate submission,
  zero-overhead private half). PRODUCT-VISION §8 items 1–3 marked resolved.

## [0.1.5] — 2026-07-02

### Added

- **`calibre_extract_isbn`** — the kiwidude Extract-ISBN capability. Scans a book's own
  text (front matter, then back-matter tail) for a checksum-valid ISBN and stamps it into
  the `isbn` identifier. Gated write, preview-first: `apply=false` (default) reports the
  ISBN found without writing; `apply=true` writes it. Merges into existing identifiers so
  a `doi`/`asin` is never clobbered. This brings the tool count to 15.

### Changed

- The ISBN text-scanner (shared by `calibre_extract_isbn` and `calibre_recover_metadata`)
  is hardened to match the kiwidude plugin's behaviour: prefer ISBN-13 over ISBN-10,
  require a Bookland prefix (977/978/979) on 13-digit runs, reject all-same-digit runs
  (which pass the ISBN-10 checksum), and scan front matter then the tail. This also
  sharpens `calibre_recover_metadata`'s lookup key.

## [0.1.4] — 2026-07-02

### Fixed

- `calibre_add_book` no longer hangs. Adding a book routed through the Content Server
  spawned a Calibre import worker whose orphaned process kept the library write lock,
  hanging the tool (~4 min) and stalling other tools' reads afterward. Subprocesses are
  now run in their own process group and force-killed as a group on timeout, so nothing
  is left holding the lock. The same hardening applies to text-extraction conversions
  (`ebook-convert`), and `calibre_add_book` now allows up to 120s for genuinely slow
  imports/conversions.

## [0.1.3] — 2026-07-02

Hardening pass from an integration smoke-test run — no breaking changes.

### Added

- `calibre_build_index` now supports a **keyword-only** index build path, so building
  a search index no longer requires the optional `@huggingface/transformers`
  (embeddings) dependency to be installed.

### Fixed

- `calibre_semantic_search` now gives honest, actionable messaging in keyword-only
  mode instead of implying vector/semantic results are available.
- `calibre_recover_metadata`'s ISBN text-scan is now bounded, so it can no longer hang
  the stdio server on pathological book text.
- Resolved a hang in `calibre_find_duplicates` / `calibre_quality_report` on large
  libraries.

### Performance

- `select-books` now fetches `/ajax/books` in parallel batches (instead of serially)
  and logs per-stage timing to stderr, speeding up any tool that selects books by
  query (`calibre_bulk_update`, `calibre_find_duplicates`, `calibre_quality_report`,
  `calibre_build_index`).

## [0.1.2] — 2026-07-02

### Fixed

- MCPB: a blank optional config field with no manifest default (e.g. **calibredb
  binary**) could leak its raw `${user_config.x}` placeholder into the environment
  un-substituted. The server treated that literal as a real value, so `calibredb`
  auto-detection never ran and every call failed with `calibredb not found at
  "${user_config.calibredb_path}"`. Blank fields now correctly fall through to
  auto-detect (`calibredb_path`, `library`, `index_dir`, `add_roots`).

## [0.1.1] — 2026-07-02

### Added

- Published to the official [MCP Registry](https://registry.modelcontextprotocol.io) as
  `io.github.caelum29/calibre-mcp` (`server.json`).
- Automated release pipeline: on a `v*` tag, CI publishes to npm (with provenance),
  attaches the `.mcpb` bundle to the GitHub release, and updates the MCP Registry.

No functional changes to the server.

## [0.1.0] — 2026-07-02

First public release.

### Added

- **15 tools** over the Calibre Content Server (stdio transport):
  - Read: `calibre_search` (metadata + full-text, library- or book-scoped),
    `calibre_get_book`, `calibre_get_content` (cursor-walkable excerpts),
    `calibre_list_categories`, `calibre_list_libraries`, `calibre_ping`
  - Semantic: `calibre_semantic_search` (hybrid vector + keyword retrieval,
    multilingual `multilingual-e5-small` embeddings, RU/EN cross-lingual),
    `calibre_build_index`
  - Curation: `calibre_find_duplicates` (merge-safety scoring),
    `calibre_quality_report`, `calibre_recover_metadata` (Open Library →
    Google Books, preview-only)
  - Write (gated off by default): `calibre_update_book`, `calibre_bulk_update`
    (selection required, preview-first), `calibre_add_book` (path-whitelisted),
    `calibre_remove_book` (confirm-required dry-run)
- Library auto-detection (server default via `/ajax/library-info`) and
  cross-platform `calibredb` discovery (macOS / Windows / Linux / `PATH`).
- npm package (`npx calibre-mcp`) and Claude Desktop one-click `.mcpb` bundle
  (embeddings excluded from the bundle to stay small; available via npx).
- Serialization-hardened inputs (Zod coercion on every tool) against the
  known client-side `-32602` args-as-strings bug.

[0.1.1]: https://github.com/caelum29/calibre-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/caelum29/calibre-mcp/releases/tag/v0.1.0
