// @ts-check
/**
 * Module-name normalisation for the PRISM hierarchy. Yosys emits
 * decorated names ($paramod\...\, genblk scopes, $-prefixed primitives);
 * these decide which modules are user-clickable and strip them down to the
 * real name the schematic shows.
 *
 * Pure helpers, split out of prism.js (2026-06); see ./index.js.
 */

function cleanModuleName(/** @type {any} */ moduleName) {
  let cleanName = moduleName;

  if (cleanName.startsWith('$paramod')) {
    if (cleanName.includes('\\\\')) {
      const parts = cleanName.split('\\\\');
      if (parts.length >= 2) {
        cleanName = parts[1];
        if (cleanName.includes('\\')) cleanName = cleanName.split('\\')[0];
      }
    } else if (cleanName.includes('\\')) {
      const parts = cleanName.split('\\');
      if (parts.length >= 2) cleanName = parts[1];
    }
  }

  cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');
  cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');
  cleanName = cleanName.replace(/^[$\\]+/, '');
  // Tira prefixos `genblk<N>.` que o yosys adiciona em instancias
  // dentro de generate blocks. Sao so nomes de escopo hierarquico
  // gerados — o usuario quer ver so o nome real ("my_f2i" em vez
  // de "genblk27.my_f2i"). Global pra cobrir genblks aninhados.
  cleanName = cleanName.replace(/(?:\\?genblk\d+\.)+/g, '');
  return cleanName;
}

function isClickableModule(/** @type {any} */ moduleName) {
  const skipPatterns = [
    /^\$_/, /^\$dff/, /^\$mux/, /^\$add/, /^\$sub/, /^\$mul/, /^\$div/, /^\$mod/,
    /^\$eq/, /^\$ne/, /^\$lt/, /^\$le/, /^\$gt/, /^\$ge/, /^\$and/, /^\$or/,
    /^\$xor/, /^\$not/, /^\$reduce/, /^\$logic/, /^\$shift/, /^\$pmux/, /^\$lut/,
    /^\$assert/, /^\$assume/, /^\$cover/, /^\$specify/,
  ];
  for (const pattern of skipPatterns) if (pattern.test(moduleName)) return false;

  return (
    moduleName.startsWith('$paramod') ||
    (!moduleName.startsWith('$') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(moduleName))
  );
}

module.exports = { cleanModuleName, isClickableModule };
