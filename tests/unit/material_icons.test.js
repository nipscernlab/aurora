// Unit tests for the Material Icon Theme resolver (Folders-view icons).
// The pure resolvers take a manifest object, so no fetch/DOM is needed.
import { describe, it, expect } from 'vitest';
import {
  resolveFolderIconName,
  resolveFileIconName,
  iconUrlFromManifest,
} from '../../js/tree/material_icons.js';

// A tiny stand-in for material-icons.json (VSCode file-icon-theme shape).
const MANIFEST = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  folderNames: { test: 'folder-test', tests: 'folder-test', scripts: 'folder-scripts' },
  folderNamesExpanded: { test: 'folder-test-open', tests: 'folder-test-open' },
  fileExtensions: { js: 'javascript', 'test.js': 'test-js', ts: 'typescript' },
  fileNames: { 'package.json': 'nodejs' },
  iconDefinitions: {
    'folder-test': { iconPath: './../icons/folder-test.svg' },
    javascript: { iconPath: './../icons/javascript.svg' },
    verilog: { iconPath: './../icons/verilog.svg' },
  },
};

describe('resolveFolderIconName', () => {
  it('maps known folder names (incl. plural) to their icon', () => {
    expect(resolveFolderIconName(MANIFEST, 'tests')).toBe('folder-test');
    expect(resolveFolderIconName(MANIFEST, 'Scripts')).toBe('folder-scripts'); // case-insensitive
  });
  it('uses the expanded variant when open', () => {
    expect(resolveFolderIconName(MANIFEST, 'test', true)).toBe('folder-test-open');
  });
  it('falls back to the default folder / folder-open', () => {
    expect(resolveFolderIconName(MANIFEST, 'whatever')).toBe('folder');
    expect(resolveFolderIconName(MANIFEST, 'whatever', true)).toBe('folder-open');
  });
});

describe('resolveFileIconName', () => {
  it('matches exact file names first', () => {
    expect(resolveFileIconName(MANIFEST, 'package.json')).toBe('nodejs');
  });
  it('prefers the longest compound extension', () => {
    expect(resolveFileIconName(MANIFEST, 'app.test.js')).toBe('test-js');
    expect(resolveFileIconName(MANIFEST, 'main.js')).toBe('javascript');
  });
  it('applies the SAPHO override: .v/.vh/.sv are Verilog, not vlang', () => {
    expect(resolveFileIconName(MANIFEST, 'core.v')).toBe('verilog');
    expect(resolveFileIconName(MANIFEST, 'defs.vh')).toBe('verilog');
    expect(resolveFileIconName(MANIFEST, 'top.sv')).toBe('verilog');
  });
  it('falls back to the default file icon', () => {
    expect(resolveFileIconName(MANIFEST, 'mystery.qzx')).toBe('file');
    expect(resolveFileIconName(MANIFEST, 'Makefile')).toBe('file');
  });
});

describe('iconUrlFromManifest', () => {
  it('builds a vendor URL from the iconDefinitions iconPath basename', () => {
    expect(iconUrlFromManifest(MANIFEST, 'folder-test'))
      .toBe('./vendor/material-icons/folder-test.svg');
    expect(iconUrlFromManifest(MANIFEST, 'verilog'))
      .toBe('./vendor/material-icons/verilog.svg');
  });
  it('falls back to <name>.svg when the definition is missing', () => {
    expect(iconUrlFromManifest(MANIFEST, 'nope'))
      .toBe('./vendor/material-icons/nope.svg');
  });
});
