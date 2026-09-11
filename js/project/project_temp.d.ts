/**
 * Tipos de project_temp.js, para os modulos .ts (spec_factory.ts) importarem a
 * Temp do projeto sem o tsc reclamar de modulo sem declaracao. Mesma razao do
 * electron_api.d.ts ao lado do electron_api.js.
 */
export const PROJECT_TEMP_SEGMENTS: readonly ['.aurora', 'Temp'];
export function projectTempDir(projectPath: string): Promise<string>;
