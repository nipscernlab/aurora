// hierarchy_view.js: DOM renderer for the post-synthesis module hierarchy.
//
// Extracted from compilation_module.js (A2 god-file decomposition #2). Consumes
// the pure tree data model from hierarchy_parser.js and renders it into the
// file-tree's 'hierarchy' sub-container, with expand/collapse + click-to-open
// the module's source. Independent of CompilationModule instance state, the
// hierarchy data is passed in; everything else is globals (window.treeView /
// window.TabManager / window.fileTreeViewController) + Monaco via the imported
// TabManager/EditorManager.
//
// NB: the recursive child builder is `buildHierarchyChildren` (NOT
// `buildHierarchyTree`), `buildHierarchyTree` is a DIFFERENT function imported
// from ../wave/signal_parser.js into compilation_module.js; the rename avoids
// the name clash.

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';

// The whole tree is built into the DOM up front (collapse is CSS-only); a very
// large synthesis can put thousands of rows in the DOM. They're cheap while
// collapsed (.hierarchy-children.collapsed → content-visibility:hidden skips
// their layout/paint), but we flag the size once so a perf report can be traced
// to the design rather than the IDE.
const HIERARCHY_LARGE = 2000;

/**
 * Marca a row do arquivo em foco no Monaco na hierarchy tree (toggle de
 * `.active` em `.hierarchy-item[data-filepath]`). Idempotente.
 */
function refreshHierarchyFocusHighlight() {
  const host = (typeof window !== 'undefined') && window.treeView?.getContainer?.('hierarchy');
  if (!host) return;
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const target = norm(window.TabManager?.getEditingFilePath?.() || '');
  host.querySelectorAll('.hierarchy-item[data-filepath]').forEach((it) => {
    const match = !!target && norm(it.getAttribute('data-filepath')) === target;
    it.classList.toggle('active', match);
  });
}

function goToLineInEditor(editor, lineNumber) {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const totalLines = model.getLineCount();
  const targetLine = Math.max(1, Math.min(lineNumber, totalLines));
  editor.setPosition({ lineNumber: targetLine, column: 1 });
  editor.revealLineInCenter(targetLine);
  editor.focus();
  editor.setSelection({
    startLineNumber: targetLine,
    startColumn: 1,
    endLineNumber: targetLine,
    endColumn: model.getLineMaxColumn(targetLine),
  });
}

async function openModuleFile(filePath, lineNumber = null) {
  try {
    const fileExists = await electronAPI.fileExists(filePath);
    if (!fileExists) {
      // NB: this used to log to a terminal via a static `this.terminalManager`
      // that was always undefined (a latent no-op/throw); console keeps the
      // diagnostic without the broken dependency.
      console.error(`[hierarchy] module file not found: ${filePath}`);
      return;
    }
    const content = await electronAPI.readFile(filePath, { encoding: 'utf8' });
    TabManager.addTab(filePath, content);
    if (lineNumber) {
      setTimeout(() => {
        const editor = EditorManager.getEditorForFile(filePath);
        if (editor) goToLineInEditor(editor, lineNumber);
      }, 100);
    }
  } catch (error) {
    console.error('Error opening module file:', error);
  }
}

function toggleHierarchyItem(itemElement) {
  const toggle = itemElement.querySelector('.hierarchy-toggle');
  const children = itemElement.querySelector('.hierarchy-children');
  if (!toggle || !children) return;
  const isExpanded = children.classList.contains('expanded');
  children.classList.toggle('expanded', !isExpanded);
  children.classList.toggle('collapsed', isExpanded);
  toggle.classList.toggle('expanded', !isExpanded);
}

function createHierarchyItem(instanceNode, type, icon, isExpanded = false) {
  const itemContainer = document.createElement('div');
  itemContainer.className = 'hierarchy-item';

  const moduleDef = instanceNode.moduleDefinition;

  if (moduleDef.filePath) {
    itemContainer.setAttribute('data-filepath', moduleDef.filePath);
    if (moduleDef.lineNumber) {
      itemContainer.setAttribute('data-linenumber', moduleDef.lineNumber);
    }
  }

  const itemElement = document.createElement('div');
  itemElement.className = 'hierarchy-item-content';

  const hasChildren = moduleDef.children && moduleDef.children.length > 0;

  if (hasChildren) {
    const toggle = document.createElement('span');
    toggle.className = `hierarchy-toggle ${isExpanded ? 'expanded' : ''}`;
    // The affordance is a curved-tree node (hollow collapsed, filled accent
    // expanded) drawn via the ::before pseudo in h_tree.css. No glyph child.
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHierarchyItem(itemContainer);
    });
    itemElement.appendChild(toggle);
  } else {
    itemElement.appendChild(document.createElement('span')).className = 'hierarchy-spacer';
  }

  // Icon = the file's tab icon when this module maps to a file, so the hierarchy
  // reads with the SAME glyphs as the verilog/standard trees and the Monaco
  // tabs; fall back to the passed Phosphor glyph for synthetic nodes.
  const fileBase = moduleDef.filePath ? moduleDef.filePath.split(/[\\/]/).pop() : '';
  const resolvedIcon = (fileBase && window.TabManager?.getFileIcon)
    ? window.TabManager.getFileIcon(fileBase)
    : icon;
  itemElement.appendChild(document.createElement('span')).className = 'hierarchy-icon';
  itemElement.querySelector('.hierarchy-icon').innerHTML = `<i class="${resolvedIcon}"></i>`;

  const label = document.createElement('span');
  label.className = 'hierarchy-label';
  label.textContent = instanceNode.instanceName === moduleDef.name
    ? moduleDef.name
    : `${instanceNode.instanceName} (${moduleDef.name})`;
  itemElement.appendChild(label);

  itemContainer.appendChild(itemElement);
  itemContainer.appendChild(document.createElement('div')).className =
    `hierarchy-children ${isExpanded ? 'expanded' : 'collapsed'}`;

  if (moduleDef.filePath) {
    itemElement.style.cursor = 'pointer';
    const fileName = moduleDef.filePath.split(/[\\/]/).pop();
    itemElement.title = `Click to open ${fileName}`;
    itemElement.addEventListener('click', async (e) => {
      if (e.target.closest('.hierarchy-toggle')) return;
      const filePath = itemContainer.getAttribute('data-filepath');
      const lineNumber = itemContainer.getAttribute('data-linenumber');
      if (filePath) {
        await openModuleFile(filePath, lineNumber ? parseInt(lineNumber, 10) : null);
      }
    });
  }

  return itemContainer;
}

function buildHierarchyChildren(parentItem, moduleDefinition) {
  if (!moduleDefinition.children || moduleDefinition.children.length === 0) return;

  const childrenContainer = parentItem.querySelector('.hierarchy-children');
  if (!childrenContainer) return;

  const sortedInstances = [...moduleDefinition.children].sort((a, b) => {
    const nameA = a?.instanceName || '';
    const nameB = b?.instanceName || '';
    return nameA.localeCompare(nameB);
  });

  for (const instanceNode of sortedInstances) {
    const childItem = createHierarchyItem(instanceNode, 'module', 'ph ph-tree-structure');
    childItem.setAttribute('data-type', 'module');
    childrenContainer.appendChild(childItem);
    buildHierarchyChildren(childItem, instanceNode.moduleDefinition);
  }
}

/**
 * Render the module hierarchy into the file-tree's 'hierarchy' sub-container.
 * Preserves expand/collapse state across view switches by leaving the DOM
 * untouched when it already reflects the same data object (the controller
 * re-invokes this every time the hierarchy view becomes active).
 *
 * @param {object|null|undefined} hierarchyData  parsed tree; falls back to the
 *   file-tree view controller's stored copy when omitted.
 */
function renderHierarchy(hierarchyData) {
  // Hierarchy view owns its dedicated subcontainer inside #file-tree, so we can
  // freely innerHTML='' our own without touching the standard tree or the
  // verilog picker (see js/tree/tree_view.js).
  const hostContainer = window.treeView?.getContainer('hierarchy');
  if (!hostContainer) return;

  const data = hierarchyData ?? window.fileTreeViewController?.getHierarchyData?.();
  if (!data) return;

  if (hostContainer.__auroraHierarchyData === data
      && hostContainer.querySelector('.hierarchy-container')) {
    refreshHierarchyFocusHighlight();
    return;
  }
  hostContainer.__auroraHierarchyData = data;
  hostContainer.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'hierarchy-container';

  const topLevelInstance = { instanceName: data.name, type: 'instance', moduleDefinition: data };
  const topItem = createHierarchyItem(topLevelInstance, 'top-level', 'ph ph-cpu', true);
  topItem.setAttribute('data-type', 'top-level');
  container.appendChild(topItem);

  buildHierarchyChildren(topItem, data);
  hostContainer.appendChild(container);

  const nodeCount = container.querySelectorAll('.hierarchy-item').length;
  if (nodeCount > HIERARCHY_LARGE) {
    console.info(`[aurora-tree] large hierarchy: ${nodeCount} modules — collapsed branches are not laid out/painted; expand on demand.`);
  }

  refreshHierarchyFocusHighlight();
}

export { renderHierarchy, refreshHierarchyFocusHighlight };
