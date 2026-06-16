# Code signing (B2)

The NSIS installer and the auto-updater are currently **unsigned**, so Windows
SmartScreen warns on first run and the updater only verifies the `sha512` in
`latest.yml`. This doc is the setup to fix that; the wiring placeholder lives in
`.github/workflows/release.yml`.

## Option A — SignPath.io (free for OSS, recommended)

SignPath offers free certificates + signing for open-source projects.

1. Apply for the OSS plan at <https://about.signpath.io/product/open-source>
   (needs an approval — this is the external blocker; the rest is in-repo).
2. Create a SignPath *project* + *signing policy* for the release artifact.
3. Add repo secrets: `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID`.
4. In `release.yml`, after **Build & publish**, sign the uploaded `.exe` with the
   [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request)
   action, then re-upload the signed binary + refreshed `latest.yml`.

## Option B — Azure Trusted Signing

Pay-as-you-go (~$10/mo). electron-builder signs inline when these env vars are
present on the Windows runner:

```
CSC_LINK=<base64 .pfx or cert path>
CSC_KEY_PASSWORD=<password>
```

electron-builder then signs the NSIS target automatically — no extra step. Store
both as repo secrets and expose them as `env:` on the **Build & publish** step.

## Verify

After signing, `signtool verify /pa dist\sapho-aurora-Setup-vX.Y.Z.exe` must pass
and SmartScreen should stop warning once the cert builds reputation. Also publish
`SHA256SUMS.txt` next to the release assets (pairs with the downloader-side
verification in `components/Scripts/lib/checksum.js`).
