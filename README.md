# AList Desktop release channels

| Channel | Source branch | Version tags | Update manifest | GitHub Latest |
| --- | --- | --- | --- | --- |
| 3.x stable | AlistGo/desktop `v2` | `v3.x.y` | `releases/latest/download/latest.json` | Yes |
| 4.x Beta | AlistGo/desktop `v3` | `v4.x.y-beta.N` | `releases/download/beta-v4/latest.json` | No |
| Historical Beta | `v2` | legacy `beta` | unchanged | No |

The historical date-version Beta workflow is manual only. It no longer runs when this repository's main branch changes. Its existing assets remain untouched. Its proxy now reads its own assembled manifest, rather than stable Latest. Stable and legacy tag workflows explicitly select `v2`; stable workflows accept only stable `v3.*` tag events, including manual dispatch checks.

## Publishing a 4.x Beta

1. Review and push the desktop source changes to `AlistGo/desktop` branch `v3`. Local uncommitted changes are not used by CI.
2. Merge this repository's workflow/scripts. Configure `MY_TOKEN` with read access to the private source and its npm packages. Configure `TAURI_SIGNING_PRIVATE_KEY` (or reuse the existing `TAURI_PRIVATE_KEY` through the compatibility mapping) and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, matching the existing updater public key. Keep legacy `TAURI_PRIVATE_KEY` for the 3.x workflow. Do not embed GitHub tokens in the app.
3. Push a new version tag such as `v4.0.0-beta.1` on the release repository, or manually run **Release Desktop 4 Beta** with that tag as input. Manual runs default to `draft_only=true`: validate the draft before choosing publication. A non-`v3` source ref is permitted only in draft mode. Tag pushes perform publication; manual publication requires explicitly turning draft-only off. Use a higher beta number for every published build. The exact `v3` source SHA, stable core version and stable rclone version are resolved once at preparation; all six jobs use those values.
Manual runs default to `draft_only=true`: all builds, signature checks and draft asset/digest checks run, then stop before public publication or any `beta-v4` change. For a production manual publication explicitly set it to false. Alternate `source_ref` values are permitted only in draft mode; production always resolves `v3`.

4. All platform builds must finish. Missing installers, updater signatures, architectures, mismatched versions, invalid signatures, or remote asset digest mismatches stop publication. Artifacts are first staged in Actions, then uploaded to a draft release. Only after validation is the version release published as prerelease with `make_latest=false`.
5. The final step advances `beta-v4` manifests. Those manifests reference the immutable versioned release assets, never files in the channel alias. `provenance.json` records the source SHA, dependency versions and release-workflow commit; `SHA256SUMS` lists bundle hashes.

Concurrent 4.x publications are serialized. Published version releases cannot be overwritten or reused; the channel cannot be moved below an already published Beta. Failed builds leave the channel unchanged. A failure after version publication requires inspecting that release/channel before repair; rerunning an already published tag deliberately fails. GitHub replaces channel assets individually, so channel manifest replacement is not an atomic multi-file operation. Both old and new manifests point to complete version releases.

The matrix builds macOS Intel/Apple Silicon, Linux x86_64/aarch64, and Windows x86_64/arm64. Windows x86_64 includes NSIS and MSI; arm64 uses NSIS. `scripts/version.mjs` in the source maps app `4.x.y-beta.N` to numeric MSI `4.x.y.N`, preserving the application/update SemVer and existing MSI upgrade identity. Numeric MSI bounds are validated before writing versions. Tauri 2 Linux uses WebKitGTK 4.1. All updater archives are verified with minisign before upload, and GitHub-reported SHA-256 digests are checked before publication.

## Installation and recovery

3.x users stay on stable; switching to 4.x is a manual installation after quitting the app and backing up its data. Application identity/data directory are shared; this is not side-by-side installation. An existing `4.0.0` build also needs manual installation to switch to `4.0.0-beta.N`, because SemVer ranks it above that prerelease. Beta then updates only through `beta-v4`. Returning to 3.x may require restoring the backup; newer data is not guaranteed to be backward compatible.

## Local validation

```sh
node --test scripts/v4-release.test.mjs
actionlint .github/workflows/release_v4_beta.yml .github/workflows/release.yml .github/workflows/release_beta.yml .github/workflows/tag.yml
```

Local validation does not prove that runner builds, repository permissions, secrets, code signing, or actual installed-app updates succeed. Validate the first Beta end to end before announcing it. The first release should include a real signed Beta-to-Beta upgrade on each supported platform; release creation alone is not that proof.
