/**
 * hierarchy_parser.ts: pure parsing of Yosys `write_json` output into AURORA's
 * in-memory module-hierarchy tree.
 *
 * Extracted from compilation_module.js (A2 god-file decomposition). These
 * functions are PURE, no DOM, no `window`, no instance state, so the data
 * model can be unit-tested in isolation and the god-file shrinks. The DOM
 * renderer that consumes the tree is hierarchy_view.js.
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
 */
function parseYosysIdentifier(yosysName: string): { cleanName: string; filePath: string|null; } {
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
 */
function extractFileInfoFromSource(sourceAttr: string): { filePath: string; lineNumber: number; }|null {
  if (!sourceAttr) return null;
  const match = sourceAttr.match(/^(.+\.v):(\d+)\.\d+(?:-\d+\.\d+)?$/);
  if (!match) return null;
  return { filePath: match[1], lineNumber: parseInt(match[2], 10) };
}

/** Um modulo do `write_json` do Yosys, so com o que o parser le. */
interface ModuloDoYosys {
  attributes?: { src?: string };
  cells?: Record<string, { type: string }>;
}

interface InstanciaDaHierarquia {
  instanceName: string;
  type: 'instance';
  moduleDefinition: NoDaHierarquia;
}

/** Um modulo do projeto na arvore. Duas instancias do mesmo modulo apontam para o mesmo no. */
export interface NoDaHierarquia {
  name: string;
  filePath: string | null;
  lineNumber: number | null;
  children: InstanciaDaHierarquia[];
}

/**
 * Build the design's module hierarchy from Yosys `write_json` output.
 *
 * Devolve null quando o proprio topo parece primitivo (sem `src` e sem
 * celulas), o mesmo que o `.js` devolvia sem declarar.
 * @param topLevelModule  the design's top module (clean name)
 */
function parseYosysHierarchy(
  jsonData: { modules?: Record<string, ModuloDoYosys> } | null | undefined,
  topLevelModule: string,
): NoDaHierarquia | null {
  const modules = (jsonData && jsonData.modules) || {};
  const memo = new Map<string, NoDaHierarquia>();

  const isPrimitive = (moduleName: string) => {
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

  const buildDefinitionTree = (moduleName: string): NoDaHierarquia | null => {
    const visto = memo.get(moduleName);
    if (visto) return visto;
    if (isPrimitive(moduleName)) return null;
    const moduleData = modules[moduleName];
    const { cleanName, filePath } = parseYosysIdentifier(moduleName);
    if (!moduleData) return null;

    let sourceFilePath = filePath;
    let sourceLineNumber: number | null = null;
    if (moduleData.attributes && moduleData.attributes.src) {
      const fileInfo = extractFileInfoFromSource(moduleData.attributes.src);
      if (fileInfo) {
        sourceFilePath = fileInfo.filePath;
        sourceLineNumber = fileInfo.lineNumber;
      }
    }

    const definitionNode: NoDaHierarquia = {
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
