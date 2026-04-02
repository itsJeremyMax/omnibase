# Changelog

## [0.1.28](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.27...omnibase-mcp-v0.1.28) (2026-04-02)


### Features

* add omnibase logo and banner ([f307f34](https://github.com/itsJeremyMax/omnibase/commit/f307f34be387883df6e0c24c722412d08b69c467))


### Bug Fixes

* install unixodbc-dev headers for ODBC driver builds in CI ([0402b0d](https://github.com/itsJeremyMax/omnibase/commit/0402b0da1d04e6c1601cbc19aed4ea09782bd3bf))

## [0.1.27](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.26...omnibase-mcp-v0.1.27) (2026-04-02)


### Features

* add reviewer-suggested MCP tool enhancements ([b2d948d](https://github.com/itsJeremyMax/omnibase/commit/b2d948d920d31cc7b5808d89da0166b42e5fc0a0))
* dynamic driver plugin architecture ([a9786d3](https://github.com/itsJeremyMax/omnibase/commit/a9786d3ae1bea9ccf3f8729ca1bd62cb522a82f2))


### Bug Fixes

* add --help flag and error on unknown CLI commands ([c9fc15c](https://github.com/itsJeremyMax/omnibase/commit/c9fc15c5172e4ea03acc30630bee41fbe3f8cf3f))
* decouple release pipeline from release-please output ([c442629](https://github.com/itsJeremyMax/omnibase/commit/c4426294cff06ec2ad3c3df88077881e32afa894))
* harden driver system with audit fixes, checksum verification, and bug fixes ([c39b1f8](https://github.com/itsJeremyMax/omnibase/commit/c39b1f8ee1b4744dec9559958cb29465e1a42392))
* update go base image to 1.26 to match sidecar go.mod requirement ([#37](https://github.com/itsJeremyMax/omnibase/issues/37)) ([b56603a](https://github.com/itsJeremyMax/omnibase/commit/b56603aaf21ce634e4e4ad2300c135fcf31047fc))

## [0.1.26](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.25...omnibase-mcp-v0.1.26) (2026-03-31)


### Features

* add CLI upgrade command with update checking and changelog display ([28daa3e](https://github.com/itsJeremyMax/omnibase/commit/28daa3e1455fdc9a6733debb00d6df9ee3fb7095))
* add connection health dashboard via `status` command ([b7a1ae7](https://github.com/itsJeremyMax/omnibase/commit/b7a1ae7b9b328ac9ed77c871e3942bd8f2e159a8))
* add custom tools - user-defined MCP tools via config ([8b357fd](https://github.com/itsJeremyMax/omnibase/commit/8b357fd47557af3361cf196d6ba6aca6c1f29f67))
* add exact_counts parameter to list_tables for accurate row counts ([8dd47d8](https://github.com/itsJeremyMax/omnibase/commit/8dd47d880f9bd5ae75bef60c110654a8da041817))
* add multi-statement custom tools with transaction support ([3a8c6f0](https://github.com/itsJeremyMax/omnibase/commit/3a8c6f07cd28ca71b39c03b3b0b4107e89af4606))
* add query audit log with history tool and CLI ([7964058](https://github.com/itsJeremyMax/omnibase/commit/796405858e1344116907dba2d311c5229996c075))
* add schema-aware autocomplete hints in tool descriptions ([9688273](https://github.com/itsJeremyMax/omnibase/commit/96882731524683fd5cbe04b66d4508d20492f63d))
* add SHA-256 checksum verification and archives for sidecar releases ([676d074](https://github.com/itsJeremyMax/omnibase/commit/676d0741b2a633a82347dc829c2c811963a0ef6c))
* add tool composition with compose pipelines ([6a4807b](https://github.com/itsJeremyMax/omnibase/commit/6a4807ba852dbf432b2f31a180104f6dd5d8332c))
* add tools test command for dry-running custom tools ([492fcd0](https://github.com/itsJeremyMax/omnibase/commit/492fcd0b157dbdcf62fa7fe5aed5ef58341baf7c))
* auto-generate tool descriptions from SQL comments ([dacd8fe](https://github.com/itsJeremyMax/omnibase/commit/dacd8fec090580ecacc0501f472011d2ca3818d8))
* initial release of omnibase ([608d016](https://github.com/itsJeremyMax/omnibase/commit/608d01698b68e4088bc5b1c33144cd09a9dab591))
* sidecar version management and improved onboarding ([0e60853](https://github.com/itsJeremyMax/omnibase/commit/0e60853ff6776b1ecefc842d408d716c662341aa))


### Bug Fixes

* ci workflow improvements ([d6f5286](https://github.com/itsJeremyMax/omnibase/commit/d6f52867c6aa90fbf345d7a37cad99385292c9ea))
* drop provenance/OIDC and use token-only npm publish ([736e16b](https://github.com/itsJeremyMax/omnibase/commit/736e16b5522a73613bf8619a640d5acd855b3be2))
* find correct .npmrc location for token removal ([7f09beb](https://github.com/itsJeremyMax/omnibase/commit/7f09beba40e4c4f84b1624f0a83b2ffc1c1ca727))
* include README in npm registry publish payload ([7f8d3ec](https://github.com/itsJeremyMax/omnibase/commit/7f8d3ec54acf3eca55fdabc55acac3db5a4f1e6a))
* increase postinstall test timeout and ensure sidecar is executable ([588116a](https://github.com/itsJeremyMax/omnibase/commit/588116ac54ebdd6e51e175dde833ae5369e84a46))
* make defaults section optional in config ([a05cf4a](https://github.com/itsJeremyMax/omnibase/commit/a05cf4ab935ad382fa2ccd5538234553e8a7ce2d))
* npm trusted publishing auth ([9622fd7](https://github.com/itsJeremyMax/omnibase/commit/9622fd7ac1cbb0cafad132d557eb270a255720ee))
* properly configure OIDC Trusted Publishing for npm ([78552d1](https://github.com/itsJeremyMax/omnibase/commit/78552d1e612a88a867c78f581159e2d439e40e9d))
* remove provenance config and force node24 for release-please ([f0f7574](https://github.com/itsJeremyMax/omnibase/commit/f0f75741771426988df1163b62d813ba35663d8f))
* remove registry-url from setup-node for trusted publishing ([7248c32](https://github.com/itsJeremyMax/omnibase/commit/7248c32411b22bf00ba30e6ca245beb951dda25c))
* restore registry-url and ensure npm &gt;= 11.5.1 for OIDC ([6b5953d](https://github.com/itsJeremyMax/omnibase/commit/6b5953d1c79a3db006cb5cee9f506f4e652d17dc))
* revert readme from publish payload to avoid Cloudflare WAF block ([014f1f9](https://github.com/itsJeremyMax/omnibase/commit/014f1f9d401e2e62ec622a3417d5f3674fcbd9b5))
* run CI on release-please branches ([80ccc2d](https://github.com/itsJeremyMax/omnibase/commit/80ccc2de94f03a399e7f1abed8a951a793e7517d))
* sidecar build failures in CI ([06dd285](https://github.com/itsJeremyMax/omnibase/commit/06dd2857a29ae8d8a988c89b489293ab212fb6d0))
* strip auth token placeholder so npm uses OIDC ([3ee23ad](https://github.com/itsJeremyMax/omnibase/commit/3ee23adbaa51e8ba708b3b470c4f77f09c475cb1))
* unset NODE_AUTH_TOKEN instead of emptying it ([ea176c8](https://github.com/itsJeremyMax/omnibase/commit/ea176c80243b8106047dbe1c856cc5ae95869559))
* update integration tests for exact_counts and add CI concurrency ([2a07923](https://github.com/itsJeremyMax/omnibase/commit/2a079236c51521f52c0bd6582b1d6d0de232fe4a))
* upgrade npm to latest before publish ([5ec174a](https://github.com/itsJeremyMax/omnibase/commit/5ec174a9a62cc9febf156eddd04bcff461fe8080))
* use bash shell for windows sidecar build ([d84893a](https://github.com/itsJeremyMax/omnibase/commit/d84893a64c17f96500d8954f7f4e8971049f6503))
* use correct release tag format in sidecar download URL ([6822aa6](https://github.com/itsJeremyMax/omnibase/commit/6822aa697a24a1062f9655fca46dc03831150b79))
* use direct registry API for npm publish ([9a612e4](https://github.com/itsJeremyMax/omnibase/commit/9a612e44e9178d291f60a5918690eb06510ae938))
* use granular access token for npm publish ([7969e49](https://github.com/itsJeremyMax/omnibase/commit/7969e49afe6669587d8d2886650200042c3b7d3c))
* use OIDC Trusted Publishing for npm auth ([05fecbf](https://github.com/itsJeremyMax/omnibase/commit/05fecbfd116e7bb39a88aa7254558383f858ca8b))
* use PAT for release-please to trigger CI on PRs ([681c823](https://github.com/itsJeremyMax/omnibase/commit/681c8238fe4f6fe2d2993b03b560879c277e7307))

## [0.1.25](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.24...omnibase-mcp-v0.1.25) (2026-03-31)


### Features

* add CLI upgrade command with update checking and changelog display ([28daa3e](https://github.com/itsJeremyMax/omnibase/commit/28daa3e1455fdc9a6733debb00d6df9ee3fb7095))
* add connection health dashboard via `status` command ([b7a1ae7](https://github.com/itsJeremyMax/omnibase/commit/b7a1ae7b9b328ac9ed77c871e3942bd8f2e159a8))
* add custom tools - user-defined MCP tools via config ([8b357fd](https://github.com/itsJeremyMax/omnibase/commit/8b357fd47557af3361cf196d6ba6aca6c1f29f67))
* add multi-statement custom tools with transaction support ([3a8c6f0](https://github.com/itsJeremyMax/omnibase/commit/3a8c6f07cd28ca71b39c03b3b0b4107e89af4606))
* add query audit log with history tool and CLI ([7964058](https://github.com/itsJeremyMax/omnibase/commit/796405858e1344116907dba2d311c5229996c075))
* add schema-aware autocomplete hints in tool descriptions ([9688273](https://github.com/itsJeremyMax/omnibase/commit/96882731524683fd5cbe04b66d4508d20492f63d))
* add SHA-256 checksum verification and archives for sidecar releases ([676d074](https://github.com/itsJeremyMax/omnibase/commit/676d0741b2a633a82347dc829c2c811963a0ef6c))
* add tool composition with compose pipelines ([6a4807b](https://github.com/itsJeremyMax/omnibase/commit/6a4807ba852dbf432b2f31a180104f6dd5d8332c))
* add tools test command for dry-running custom tools ([492fcd0](https://github.com/itsJeremyMax/omnibase/commit/492fcd0b157dbdcf62fa7fe5aed5ef58341baf7c))
* auto-generate tool descriptions from SQL comments ([dacd8fe](https://github.com/itsJeremyMax/omnibase/commit/dacd8fec090580ecacc0501f472011d2ca3818d8))

## [0.1.24](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.23...omnibase-mcp-v0.1.24) (2026-03-30)


### Bug Fixes

* revert readme from publish payload to avoid Cloudflare WAF block ([014f1f9](https://github.com/itsJeremyMax/omnibase/commit/014f1f9d401e2e62ec622a3417d5f3674fcbd9b5))

## [0.1.23](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.22...omnibase-mcp-v0.1.23) (2026-03-30)


### Bug Fixes

* include README in npm registry publish payload ([7f8d3ec](https://github.com/itsJeremyMax/omnibase/commit/7f8d3ec54acf3eca55fdabc55acac3db5a4f1e6a))
* make defaults section optional in config ([a05cf4a](https://github.com/itsJeremyMax/omnibase/commit/a05cf4ab935ad382fa2ccd5538234553e8a7ce2d))

## [0.1.22](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.21...omnibase-mcp-v0.1.22) (2026-03-30)


### Features

* add exact_counts parameter to list_tables for accurate row counts ([8dd47d8](https://github.com/itsJeremyMax/omnibase/commit/8dd47d880f9bd5ae75bef60c110654a8da041817))


### Bug Fixes

* update integration tests for exact_counts and add CI concurrency ([2a07923](https://github.com/itsJeremyMax/omnibase/commit/2a079236c51521f52c0bd6582b1d6d0de232fe4a))

## [0.1.21](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.20...omnibase-mcp-v0.1.21) (2026-03-28)


### Features

* sidecar version management and improved onboarding ([0e60853](https://github.com/itsJeremyMax/omnibase/commit/0e60853ff6776b1ecefc842d408d716c662341aa))


### Bug Fixes

* increase postinstall test timeout and ensure sidecar is executable ([588116a](https://github.com/itsJeremyMax/omnibase/commit/588116ac54ebdd6e51e175dde833ae5369e84a46))

## [0.1.20](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.19...omnibase-mcp-v0.1.20) (2026-03-28)


### Bug Fixes

* use correct release tag format in sidecar download URL ([6822aa6](https://github.com/itsJeremyMax/omnibase/commit/6822aa697a24a1062f9655fca46dc03831150b79))

## [0.1.19](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.18...omnibase-mcp-v0.1.19) (2026-03-28)


### Bug Fixes

* use direct registry API for npm publish ([9a612e4](https://github.com/itsJeremyMax/omnibase/commit/9a612e44e9178d291f60a5918690eb06510ae938))

## [0.1.18](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.17...omnibase-mcp-v0.1.18) (2026-03-28)


### Bug Fixes

* remove provenance config and force node24 for release-please ([f0f7574](https://github.com/itsJeremyMax/omnibase/commit/f0f75741771426988df1163b62d813ba35663d8f))

## [0.1.17](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.16...omnibase-mcp-v0.1.17) (2026-03-28)


### Bug Fixes

* drop provenance/OIDC and use token-only npm publish ([736e16b](https://github.com/itsJeremyMax/omnibase/commit/736e16b5522a73613bf8619a640d5acd855b3be2))

## [0.1.16](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.15...omnibase-mcp-v0.1.16) (2026-03-28)


### Bug Fixes

* use granular access token for npm publish ([7969e49](https://github.com/itsJeremyMax/omnibase/commit/7969e49afe6669587d8d2886650200042c3b7d3c))

## [0.1.15](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.14...omnibase-mcp-v0.1.15) (2026-03-28)


### Bug Fixes

* restore registry-url and ensure npm &gt;= 11.5.1 for OIDC ([6b5953d](https://github.com/itsJeremyMax/omnibase/commit/6b5953d1c79a3db006cb5cee9f506f4e652d17dc))

## [0.1.14](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.13...omnibase-mcp-v0.1.14) (2026-03-28)


### Bug Fixes

* unset NODE_AUTH_TOKEN instead of emptying it ([ea176c8](https://github.com/itsJeremyMax/omnibase/commit/ea176c80243b8106047dbe1c856cc5ae95869559))

## [0.1.13](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.12...omnibase-mcp-v0.1.13) (2026-03-28)


### Bug Fixes

* properly configure OIDC Trusted Publishing for npm ([78552d1](https://github.com/itsJeremyMax/omnibase/commit/78552d1e612a88a867c78f581159e2d439e40e9d))

## [0.1.12](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.11...omnibase-mcp-v0.1.12) (2026-03-28)


### Bug Fixes

* use OIDC Trusted Publishing for npm auth ([05fecbf](https://github.com/itsJeremyMax/omnibase/commit/05fecbfd116e7bb39a88aa7254558383f858ca8b))

## [0.1.11](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.10...omnibase-mcp-v0.1.11) (2026-03-28)


### Bug Fixes

* find correct .npmrc location for token removal ([7f09beb](https://github.com/itsJeremyMax/omnibase/commit/7f09beba40e4c4f84b1624f0a83b2ffc1c1ca727))

## [0.1.10](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.9...omnibase-mcp-v0.1.10) (2026-03-28)


### Bug Fixes

* strip auth token placeholder so npm uses OIDC ([3ee23ad](https://github.com/itsJeremyMax/omnibase/commit/3ee23adbaa51e8ba708b3b470c4f77f09c475cb1))

## [0.1.9](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.8...omnibase-mcp-v0.1.9) (2026-03-28)


### Bug Fixes

* upgrade npm to latest before publish ([5ec174a](https://github.com/itsJeremyMax/omnibase/commit/5ec174a9a62cc9febf156eddd04bcff461fe8080))

## [0.1.8](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.7...omnibase-mcp-v0.1.8) (2026-03-28)


### Bug Fixes

* npm trusted publishing auth ([9622fd7](https://github.com/itsJeremyMax/omnibase/commit/9622fd7ac1cbb0cafad132d557eb270a255720ee))

## [0.1.7](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.6...omnibase-mcp-v0.1.7) (2026-03-28)


### Bug Fixes

* remove registry-url from setup-node for trusted publishing ([7248c32](https://github.com/itsJeremyMax/omnibase/commit/7248c32411b22bf00ba30e6ca245beb951dda25c))

## [0.1.6](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.5...omnibase-mcp-v0.1.6) (2026-03-28)


### Bug Fixes

* use bash shell for windows sidecar build ([d84893a](https://github.com/itsJeremyMax/omnibase/commit/d84893a64c17f96500d8954f7f4e8971049f6503))

## [0.1.5](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.4...omnibase-mcp-v0.1.5) (2026-03-28)


### Bug Fixes

* run CI on release-please branches ([80ccc2d](https://github.com/itsJeremyMax/omnibase/commit/80ccc2de94f03a399e7f1abed8a951a793e7517d))
* sidecar build failures in CI ([06dd285](https://github.com/itsJeremyMax/omnibase/commit/06dd2857a29ae8d8a988c89b489293ab212fb6d0))
* use PAT for release-please to trigger CI on PRs ([681c823](https://github.com/itsJeremyMax/omnibase/commit/681c8238fe4f6fe2d2993b03b560879c277e7307))

## [0.1.4](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.3...omnibase-mcp-v0.1.4) (2026-03-28)


### Features

* initial release of omnibase ([608d016](https://github.com/itsJeremyMax/omnibase/commit/608d01698b68e4088bc5b1c33144cd09a9dab591))


### Bug Fixes

* ci workflow improvements ([d6f5286](https://github.com/itsJeremyMax/omnibase/commit/d6f52867c6aa90fbf345d7a37cad99385292c9ea))

## [0.1.3](https://github.com/itsJeremyMax/omnibase/compare/omnibase-mcp-v0.1.2...omnibase-mcp-v0.1.3) (2026-03-28)


### Features

* initial release of omnibase ([608d016](https://github.com/itsJeremyMax/omnibase/commit/608d01698b68e4088bc5b1c33144cd09a9dab591))
