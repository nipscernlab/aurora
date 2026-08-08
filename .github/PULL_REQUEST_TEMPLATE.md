## Summary

<!-- What does this change do? Why? -->

## Linked issues

<!-- e.g. Fixes #123, Closes #456 -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Documentation update
- [ ] Refactor / cleanup

## How was this tested?

<!--
Walk through what you tried. For UI/compile work, please confirm:
- [ ] Opened a SAPHO project
- [ ] Edited a file in the main pane and a split pane
- [ ] Saved with Ctrl+S
- [ ] Ran each compile button (CMM / ASM / Veri / Wave / PRISM) at least once
-->

## Screenshots / screen recordings (if UI)

## Checklist

- [ ] My code follows the style of this project (indentation per `.editorconfig`:
      4 spaces under `js/`, 2 under `main/`; single quotes; ES modules)
- [ ] I have added comments where the *why* is non-obvious
- [ ] My commits follow Conventional Commits (release-please reads them to pick
      the next version and write the changelog, so do NOT edit `CHANGELOG.md`
      by hand)
- [ ] I have run `npx eslint .` on the files I touched
- [ ] If I changed the editor, tabs, tree or wave flow, I walked the checklist
      in `ARCHITECTURE.md`
- [ ] I have not committed bundled toolchain binaries (they live in releases;
      see CONTRIBUTING.md)
