/**
 * cli_manifest.ts: pinned download manifest for the on-demand AI CLIs (B12).
 *
 * Aurora used to BUNDLE the Claude Code and Codex native binaries inside the
 * installer (~460 MB unpacked between the two). They are now fetched on first
 * use instead: the installer ships without them and a user who never touches
 * the subscription CLIs never pays the download. This module pins exactly WHICH
 * npm platform package to fetch, its version, and its Subresource-Integrity
 * hash, per platform.
 *
 * Each platform package is the one that actually holds the native binary:
 *   - Claude:  @anthropic-ai/claude-code-win32-x64   -> claude.exe at the root
 *   - Codex:   @openai/codex @ <ver>-win32-x64       -> the alias target of the
 *              @openai/codex-win32-x64 optional dep; the native binary lives at
 *              vendor/<triple>/bin/codex.exe with bundled ripgrep em codex-path/.
 *
 * OS DADOS MORAM NO cli_manifest.json AO LADO, e nao aqui. Foi assim que este
 * arquivo pode virar .ts: dois scripts leem o manifesto ANTES de existir
 * qualquer build (`npm ci` chama check-pinned-versions, e o `npm run bootstrap`
 * chama sync-cli-manifest antes do build:ts), entao eles nao podem depender do
 * .js emitido. Lendo um .json, nao dependem. De quebra, o sync deixou de
 * reescrever codigo-fonte por expressao regular e passou a reescrever dados.
 *
 * Versions MUST track the base packages declared in package.json
 * (@anthropic-ai/claude-code, @openai/codex). scripts/check-pinned-versions.js
 * fails CI if they drift. The `integrity` strings come straight from the npm
 * registry (`dist.integrity`); cli_downloader verifies the downloaded bytes
 * against them before extraction, so a tampered or truncated download aborts.
 *
 * To bump a CLI: `npm i <base-package>@<ver>` and run
 * `node scripts/sync-cli-manifest.js`, which rewrites the version and the
 * per-platform integrity in the .json from package.json + package-lock.json.
 *
 * Compilado por `tsc` (npm run build:ts) num cli_manifest.js ao lado, e esse
 * .js que o runtime carrega.
 */

import dados from './cli_manifest.json';

/** Os CLIs que a AURORA sabe baixar. */
export type CliKind = 'claude' | 'codex';

export interface PlatformEntry {
  /** Folder/dependency name of the platform package. */
  pkg: string;
  /** Exact version to fetch (o Codex carrega o sufixo da plataforma). */
  version: string;
  /** Full .tgz URL on the npm registry. E o `resolved` do package-lock. */
  tarball: string;
  /** Subresource-Integrity string ("sha512-..."). */
  integrity: string;
  /** Executable path inside the extracted root (POSIX-relative). */
  exe: string;
  /** ripgrep dir inside the extracted root, or null. */
  rg: string | null;
  /**
   * Where `exe` lived in versions this AURORA already shipped. A cache folder
   * of an older version is only recognised as "installed, but outdated" if the
   * binary is found at one of these; without the list an old download reads as
   * absent, and the panel offers a fresh download instead of an update while
   * the old tree still sits on disk.
   */
  exeLegado?: string[];
}

export interface CliEntry extends PlatformEntry {
  kind: string;
  base: string;
  baseVersion: string;
}

interface CliManifest {
  base: string;
  baseVersion: string;
  platforms: Record<string, PlatformEntry>;
}

/**
 * NADA e derivado aqui: versao, tarball e integridade vem do .json como estao,
 * e e o sync que os copia do package-lock. Derivar a URL a partir do nome do
 * pacote pareceu mais limpo por um momento, mas o verificador compara essa URL
 * com o `resolved` do lockfile, e uma regra de derivacao errada passaria por
 * ela em silencio. Dado explicito, comparado com o lockfile, nao passa.
 */
function montar(kind: CliKind): CliManifest {
  const cru = dados[kind];
  const platforms: Record<string, PlatformEntry> = {};
  for (const [chave, p] of Object.entries(cru.platforms)) {
    platforms[chave] = { ...(p as PlatformEntry) };
  }
  return { base: cru.base, baseVersion: cru.version, platforms };
}

export const MANIFEST: Record<CliKind, CliManifest> = {
  claude: montar('claude'),
  codex: montar('codex'),
};

/** Base versions, in lockstep with package.json dependencies. */
export const CLAUDE_VERSION: string = dados.claude.version;
export const CODEX_VERSION: string = dados.codex.version;

/** `process.platform:process.arch`, the manifest's platform key. */
export function platformKey(): string {
  return `${process.platform}:${process.arch}`;
}

/**
 * Manifest entry for a CLI on a platform (defaults to the current one), or null
 * when that CLI is not downloadable here.
 */
export function entryFor(kind: CliKind, key: string = platformKey()): CliEntry | null {
  const cli = MANIFEST[kind];
  if (!cli) return null;
  const p = cli.platforms[key];
  if (!p) return null;
  return { ...p, kind, base: cli.base, baseVersion: cli.baseVersion };
}
