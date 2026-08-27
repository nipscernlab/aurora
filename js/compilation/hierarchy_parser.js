// @ts-check
/**
 * hierarchy_parser.js: pure parsing of Yosys `write_json` output into AURORA's
 * in-memory module-hierarchy tree.
 *
 * Extracted from compilation_module.js (A2 god-file decomposition). These
 * functions are PURE, no DOM, no `window`, no instance state, so the data
 * model can be unit-tested in isolation and the god-file shrinks. The DOM
 * renderer that consumes the tree stays separate (in compilation_module.js for
 * now; a later extraction moves it to hierarchy_view.js).
 *
 * Tree shape returned by parseYosysHierarchy:
 *   { name, filePath, lineNumber,
 *     children: [ { instanceName, type:'instance', moduleDefinition: <node> } ] }
 */

// Yosys cell types that are synthesis primitives / gates, not user modules:
// filtered out so the hierarchy shows only the design's own modules.
const PRIMITIVE_PATTERNS = [
  /^\$_/,
  /^\$paramod\$_/,
  /^\$lut/i,
  /^\$(and|or|xor|not|buf|mux|add|sub|mul|div|mod|pow|eq|ne|lt|le|gt|ge)/i,
  /^\$(dff|dffe|adff|adffe|sdff|sdffe|dlatch|dlatchsr)/i,
  /^\$(mem|memrd|memwr)/i,
  /^\$(assert|assume|cover|check)/i,
  /^\$reduce_/i,
  /^\$logic_/i,
  /^\$shift/i,
];

/**
 * Strip Yosys' mangled identifier down to the user-facing module/instance name,
 * and pull out an embedded source-file path if present.
 * @param {string} yosysName
 * @returns {{ cleanName: string, filePath: string|null }}
 */
function parseYosysIdentifier(yosysName) {
  let cleanName = yosysName;
  let filePath = null;
  const pathRegex = /([a-zA-Z]:\\[^:]+\.v)|(\/[^:]+\.v)/;
  const match = yosysName.match(pathRegex);
  if (match) filePath = match[1] || match[2] || null;
  if (filePath) cleanName = cleanName.split(filePath)[0];
  if (cleanName.startsWith('$paramod')) {
    const parts = cleanName.split('\\');
    if (parts.length >= 2) cleanName = parts[1];
  }
  cleanName = cleanName
    .replace(/\$[a-f0-9]{32,}/g, '')
    .replace(/^\$[0-9]+\$/g, '')
    .replace(/[$\\]+$/, '')
    .replace(/^[$\\]+/, '');
  if (!cleanName.trim()) cleanName = yosysName.split('\\').pop() || 'unknown';
  return { cleanName, filePath };
}

/**
 * Parse a Yosys `src` attribute ("path.v:line.col-line.col") into file + line.
 * @param {string} sourceAttr
 * @returns {{ filePath: string, lineNumber: number }|null}
 */
function extractFileInfoFromSource(sourceAttr) {
  if (!sourceAttr) return null;
  const match = sourceAttr.match(/^(.+\.v):(\d+)\.\d+(?:-\d+\.\d+)?$/);
  if (!match) return null;
  return { filePath: match[1], lineNumber: parseInt(match[2], 10) };
}

/**
 * Build the design's module hierarchy from Yosys `write_json` output.
 * @param {{ modules?: Record<string, any> }} jsonData
 * @param {string} topLevelModule  the design's top module (clean name)
 * @returns {{ name:string, filePath:string|null, lineNumber:number|null, children:any[] }}
 */
function parseYosysHierarchy(jsonData, topLevelModule) {
  const modules = (jsonData && jsonData.modules) || {};
  const memo = new Map();

  const isPrimitive = (moduleName) => {
    const cleanName = parseYosysIdentifier(moduleName).cleanName;
    if (PRIMITIVE_PATTERNS.some((pattern) => pattern.test(cleanName))) return true;
    if (!modules[moduleName]) return true;
    const moduleData = modules[moduleName];
    if (!moduleData.attributes || !moduleData.attributes.src) {
      const hasCells = moduleData.cells && Object.keys(moduleData.cells).length > 0;
      return !hasCells;
    }
    return false;
  };

  const buildDefinitionTree = (moduleName) => {
    if (memo.has(moduleName)) return memo.get(moduleName);
    if (isPrimitive(moduleName)) return null;
    const moduleData = modules[moduleName];
    const { cleanName, filePath } = parseYosysIdentifier(moduleName);
    if (!moduleData) return null;

    let sourceFilePath = filePath;
    let sourceLineNumber = null;
    if (moduleData.attributes && moduleData.attributes.src) {
      const fileInfo = extractFileInfoFromSource(moduleData.attributes.src);
      if (fileInfo) {
        sourceFilePath = fileInfo.filePath;
        sourceLineNumber = fileInfo.lineNumber;
      }
    }

    const definitionNode = {
      name: cleanName,
      filePath: sourceFilePath,
      lineNumber: sourceLineNumber,
      children: [],
    };
    memo.set(moduleName, definitionNode);

    const cells = moduleData.cells || {};
    for (const [cellName, cellData] of Object.entries(cells)) {
      const subModuleDefinition = buildDefinitionTree(cellData.type);
      if (subModuleDefinition) {
        definitionNode.children.push({
          instanceName: parseYosysIdentifier(cellName).cleanName,
          type: 'instance',
          moduleDefinition: subModuleDefinition,
        });
      }
    }
    return definitionNode;
  };

  const originalTopLevelName = Object.keys(modules).find(
    (key) => parseYosysIdentifier(key).cleanName === topLevelModule,
  );

  if (!originalTopLevelName) {
    console.error(`Top module "${topLevelModule}" not found.`);
    return { name: topLevelModule, filePath: null, lineNumber: null, children: [] };
  }

  const hierarchyTree = buildDefinitionTree(originalTopLevelName);
  console.log(`Hierarchy built: ${memo.size} user modules found`);
  return hierarchyTree;
}

export { parseYosysIdentifier, extractFileInfoFromSource, parseYosysHierarchy };
