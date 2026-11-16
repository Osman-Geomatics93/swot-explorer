# Changelog

All notable changes to SWOT Explorer are listed here. Versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.1] - 2026-11-16

No change to how the extension works. This release adds project files and fixes the tests.

### Added
- `LICENSE.txt`, a copy of `LICENSE` under the file name some journals ask for.
- JOSS paper in `joss/` (paper, references and figure).
- `.zenodo.json`, so Zenodo archives each release as software with a title and description that
  cannot be mistaken for a manuscript.
- This changelog.
- `CONTRIBUTING.md`.
- GitHub Actions: type-check, unit tests and build on every push and pull request, and a draft
  PDF of the JOSS paper.

### Fixed
- The unit tests failed on a fresh clone because two test files read sample granules that are not
  in the repository. Those tests are now skipped when the files are missing.

### Changed
- Software title in `CITATION.cff` and the README shortened to "SWOT Explorer", and the README
  states that the Zenodo DOIs are for the source code only.

## [0.1.0] - 2026-11-09

First public release.
