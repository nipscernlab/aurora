# Code signing (B2)

The NSIS installer and the auto-updater are currently **unsigned**, so Windows
SmartScreen warns on first run ("Windows protected your PC") and the updater only
verifies the `sha512` in `latest.yml`. This doc is the full runbook to fix that.

---

## TL;DR — do you have to pay?

**No, not for Aurora.** Aurora-IDE is **MIT-licensed open source** (`package.json`
`"license": "MIT"`, repo `nipscernlab/aurora`), so it **qualifies for the free
[SignPath Foundation OSS program](https://signpath.org/)** → **R$0**. The only
"cost" is the application + approval wait (days to a few weeks).

| Path | Cost | Fit for us |
|------|------|------------|
| **SignPath Foundation (OSS)** | **free** | ✅ recommended — Aurora qualifies (MIT, maintained, released, documented). Approved 2026-08-06; org `SAPHO [OSS]`, project `aurora`. |
| **Azure Trusted/Artifact Signing** | ~US$10/mo | ⚠️ availability is geo-limited (US/CA individuals or EU/UK orgs when last checked) — verify before counting on it from Brazil |
| Traditional OV / **EV** cert (DigiCert/Sectigo) | OV ~US$200–400/yr · EV ~US$300–700/yr + USB token | 💸 paid, and see the note below: EV buys nothing extra for SmartScreen |

> **SmartScreen reality check (corrected 2026-08-06).** An earlier version of this
> doc said an EV certificate "earns reputation instantly" while OV fades in
> gradually. **That stopped being true in March 2024** and the claim was pushing us
> toward a purchase that buys nothing. Microsoft's own documentation now states it
> plainly:
>
> > EV certificates no longer bypass SmartScreen. Years ago, signing files with an
> > Extended Validation (EV) code signing certificate would result in positive
> > SmartScreen reputation by default, but this behavior no longer exists. […]
> > Paying a premium for EV solely to avoid SmartScreen warnings is no longer
> > justified.
> > — [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
>
> So OV and EV now behave identically here, which makes the free SignPath OV
> certificate the best available option, not a compromise.
>
> **What signing actually buys:** reputation accrues against the *publisher
> certificate* as well as each file hash. Unsigned, every release starts from zero
> reputation. Signed with a consistent certificate, later releases inherit the
> reputation the certificate has already earned. That inheritance is the real win
> for a project that ships often.
>
> **How long:** no published threshold. Field reports put it at roughly 2–8 weeks
> and hundreds of clean installs (one documented case: 18 days, ~430 installs).
> There is **no** mechanism to request review for consumer endpoints.
>
> **But for the lab there is a shortcut.** Microsoft's doc says enterprise IT admins
> may submit files through the
> [Security Intelligence portal](https://www.microsoft.com/en-us/wdsi/filesubmission),
> which "can accelerate trust for internal or managed deployments". A 30-machine lab
> will never generate the download volume organic reputation needs, so this is the
> path that actually works there. See
> [IMPLANTACAO_LABORATORIO.md](IMPLANTACAO_LABORATORIO.md) §4.

## What the Foundation requires from us

The certificate is free, the obligations are not zero. From
[signpath.org/terms.html](https://signpath.org/terms.html):

- **Two-factor authentication for every contributor.**
- **Defined roles** — Author, Reviewer, Approver — and **every signing request must
  be authorised by an Approver.** This one collides with the fully automatic release
  pipeline: either a human approves each signature, or we negotiate a policy that
  waives approval for verified-origin builds. Settle this before wiring signing into
  `release.yml`.
- **A public "Code signing policy" page** on the project homepage, listing those
  roles and privacy information. This does not exist yet and must be written before
  the first signed release.
- **File metadata** (product name and version) enforced on every signed binary.
- Sign only what is built from our own source. Bundled third-party binaries
  (GTKWave, the YANC toolchain, Surfer, Verible, slang) may ship unsigned — the
  terms allow upstream libraries to be included that way.
- No tooling meant to identify or exploit vulnerabilities; no features that
  compromise user privacy or security; uninstall must be available.

Violations allow suspension without notice and revocation "effective immediately or
retroactively".

**Two consequences worth stating plainly:**

1. **The publisher shown to users will be "SignPath Foundation", not NIPSCERN or
   UFJF.** The certificate is issued to the Foundation. If institutional attribution
   in the Windows publisher line matters, this is the cost of the free programme.
2. **The project is listed publicly** on signpath.org and in
   [SignPath/fdn-website](https://github.com/SignPath/fdn-website).

**Data collected:** from maintainers, name / business email / job title (admins),
plus IP, session and request timestamps, hosted on Azure (EU + US, SCCs), retained
6 months after account termination. **Nothing is collected about end users of the
signed software** — a signature is an offline cryptographic property; it does not
phone home.

### Eligibility note (read once)
SignPath Foundation requires the project's **own** code to be OSS with no
proprietary components published by the maintainer. Aurora is MIT throughout. The
bundled third-party binaries (GTKWave GPL, Surfer EUPL, the SAPHO toolchain, Verible/
slang/clang-format/tree-sitter, etc.) are **arms-length tools we redistribute**, not
our proprietary code — that's fine. The AI CLIs download on demand and aren't shipped.

---

## Option A — SignPath.io (free for OSS, **recommended**)

### Your part (external — only you can do this)

1. **Apply:** go to <https://signpath.org/> → *Apply for Free Code Signing*. Give
   the repo URL (`https://github.com/nipscernlab/aurora`), the download/release page,
   and a one-line description. Approval takes days–weeks (this is the only blocker).
2. **After approval**, in the SignPath web app create:
   - a **Project** (note its *slug*, e.g. `aurora-ide`),
   - a **Signing Policy** for releases (note its *slug*, e.g. `release-signing`),
   - an **Artifact Configuration** that signs the `.exe` (a "Windows PE" file).
3. In the **GitHub repo** (`nipscernlab/aurora`) → *Settings*:
   - **Secrets** → add `SIGNPATH_API_TOKEN` (a SignPath user API token with
     *submitter* permission).
   - **Variables** → add `SIGNPATH_ORG_ID`, `SIGNPATH_PROJECT_SLUG`,
     `SIGNPATH_POLICY_SLUG` (these aren't secret).

### Repo part (CI) — ready to apply

The signing must happen **after** the build and **before** publishing, and because
SignPath returns new bytes, `latest.yml` must be re-hashed (else every auto-update
fails). The re-hash is already written: **`scripts/patch-latest-yml.js`**.

Apply this to `.github/workflows/release.yml` once you have the slugs above. It is
**gated on `SIGNPATH_API_TOKEN`** — until that secret exists, the current unsigned
`Build & publish` step runs unchanged, so this is a no-op for today's releases.

```yaml
# At job level (so steps can branch on whether SignPath is configured):
jobs:
  release:
    runs-on: windows-latest
    permissions: { contents: write }
    env:
      SIGNPATH_API_TOKEN: ${{ secrets.SIGNPATH_API_TOKEN }}
    steps:
      # ... existing checkout / node / npm ci / bootstrap / sentinels /
      #     build:ts / build:renderer steps stay exactly as they are ...

      # ── Path 1: UNSIGNED (today's behaviour — runs while no cert is set) ──
      - name: Build & publish (unsigned)
        if: ${{ env.SIGNPATH_API_TOKEN == '' }}
        run: npx electron-builder --win --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # ── Path 2: SIGNED (runs once SIGNPATH_API_TOKEN is present) ──
      - name: Build installer (no publish)
        if: ${{ env.SIGNPATH_API_TOKEN != '' }}
        run: npx electron-builder --win --x64 --publish never

      - name: Upload unsigned installer for SignPath
        if: ${{ env.SIGNPATH_API_TOKEN != '' }}
        id: upload-unsigned
        uses: actions/upload-artifact@v4
        with:
          name: unsigned-installer
          path: dist/sapho-aurora-Setup-*.exe

      - name: Sign with SignPath
        if: ${{ env.SIGNPATH_API_TOKEN != '' }}
        uses: signpath/github-action-submit-signing-request@v2
        with:
          api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
          organization-id: ${{ vars.SIGNPATH_ORG_ID }}
          project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
          signing-policy-slug: ${{ vars.SIGNPATH_POLICY_SLUG }}
          github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
          wait-for-completion: true
          output-artifact-directory: dist-signed

      - name: Swap in the signed .exe + refresh latest.yml
        if: ${{ env.SIGNPATH_API_TOKEN != '' }}
        shell: pwsh
        run: |
          $signed = Get-ChildItem dist-signed -Recurse -Filter *.exe | Select-Object -First 1
          Copy-Item $signed.FullName (Join-Path 'dist' $signed.Name) -Force
          node scripts/patch-latest-yml.js dist $signed.Name

      - name: Publish signed assets
        if: ${{ env.SIGNPATH_API_TOKEN != '' }}
        shell: pwsh
        env:
          # NOTE (cross-repo): electron-builder's publish config targets a DIFFERENT
          # repo — nipscernlab/sapho (the stable release channel). The default
          # GITHUB_TOKEN can't write there, so use a PAT secret with `contents:write`
          # on nipscernlab/sapho. If your current unsigned release already publishes
          # to sapho, reuse whatever token makes that work.
          GH_TOKEN: ${{ secrets.SAPHO_RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
        run: |
          $tag = '${{ github.event.release.tag_name }}'
          if (-not $tag) { $tag = (git describe --tags --abbrev=0) }
          $exe = (Get-ChildItem dist -Filter sapho-aurora-Setup-*.exe | Select-Object -First 1).FullName
          gh release upload $tag $exe dist/latest.yml --repo nipscernlab/sapho --clobber
```

> **Why this isn't pre-committed to `release.yml`:** it needs your SignPath slugs
> (created post-approval) and a decision on the cross-repo (`aurora → sapho`) publish
> token, and it can only be validated on a real signed release. Paste it when you're
> approved — I can also do it for you in one pass once the slugs + token exist.

### Alternative (avoids the re-hash + cross-repo publish): sign **during** the build
electron-builder's `win.sign` custom hook can call SignPath synchronously so signing
happens inside the build — then `latest.yml` and the existing `--publish always`
(to sapho) stay untouched, and `patch-latest-yml.js` isn't needed. It's more custom
code (a small SignPath REST client) and isn't SignPath's documented path, so the
Action above is the simpler default; this is the fallback if the cross-repo publish
proves fiddly.

---

## Option B — Azure Trusted/Artifact Signing (paid, geo-limited)

~US$9.99/mo. **Check availability first** — currently US/CA individuals or EU/UK
orgs only; Brazil isn't listed, so this is probably not open to us. If it is:
electron-builder signs the NSIS target **inline** when these are present on the
Windows runner (no extra step, no re-hash, publishes as today):

```
CSC_LINK=<base64 .pfx, or a cert path>
CSC_KEY_PASSWORD=<password>
```

Store both as repo secrets and expose them as `env:` on the **Build & publish** step.

---

## Verify (after the first signed release)

```
signtool verify /pa dist\sapho-aurora-Setup-vX.Y.Z.exe   # must pass
```
Then download the published installer and confirm the auto-updater accepts it (no
checksum mismatch in `main/updater.js`). SmartScreen should stop saying "unknown
publisher" immediately, and the reputation prompt fades as downloads accrue. Keep
publishing `SHA256SUMS.txt` next to the assets (pairs with the downloader-side
verification in `components/Scripts/lib/checksum.js`).
