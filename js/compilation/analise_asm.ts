/**
 * analise_asm.ts: um resumo estruturado de um .asm do SAPHO, para a IA
 * raciocinar sem reler o texto inteiro: quantas instrucoes, por opcode e por
 * familia, os rotulos, os lacos e os mnemonicos que a tabela nao conhece.
 *
 * Puro: recebe o texto e a tabela de opcodes, e nao le nada. Morava dentro do
 * `AuroraAPI.project.analyzeAsm` (js/api/aurora_api.js), misturado com achar e
 * ler o arquivo, e por isso nao tinha teste.
 *
 * Compilado por `tsc` (npm run build:ts) num analise_asm.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Um opcode da tabela do yanc: so o que a analise usa. */
export interface OpcodeConhecido {
  mnemonic: string;
  family?: string;
}

/** Um laco: um salto para tras, ate um rotulo definido antes dele. */
export interface LacoDoAsm {
  label: string;
  labelLine: number;
  branchLine: number;
  branchMnemonic: string;
  bodyInstructions: number;
}

/** O resumo do .asm. */
export interface AnaliseDoAsm {
  total: number;
  byOpcode: Record<string, number>;
  byFamily: Record<string, number>;
  labels: Array<{ name: string; line: number }>;
  loops: LacoDoAsm[];
  /** Mnemonicos que nao estao na tabela de opcodes (sapho_rules). */
  unknownMnemonics: string[];
}

/**
 * Analisa o texto. Sem tabela de opcodes, todo identificador em maiusculas
 * no lugar do mnemonico conta como instrucao, e todos saem como desconhecidos.
 */
export function analisarAsm(text: string, opcodes: readonly OpcodeConhecido[] = []): AnaliseDoAsm {
  const mneSet = new Set(opcodes.map((o) => o.mnemonic));
  const families = new Map(opcodes.map((o) => [o.mnemonic, o.family]));

  const byOpcode: Record<string, number> = Object.create(null);
  const byFamily: Record<string, number> = Object.create(null);
  const labelDefs: Array<{ name: string; line: number }> = [];
  const branches: Array<{ from: number; target: string; mnemonic: string }> = [];
  const unknownMnemonics: string[] = [];

  const lines = text.split(/\r?\n/);
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip block-end comments (`//...`) but keep the body.
    const noComment = raw.replace(/\/\/.*$/, '').trim();
    if (!noComment) continue;
    // Header directives (#PRNAME, #NUBITS, ...) are not instructions.
    if (noComment.startsWith('#')) continue;

    // Pull every leading `@label` (a single .asm line can carry
    // several labels, e.g. `@main @L1 LOD 1`).
    let rest = noComment;
    while (rest.startsWith('@')) {
      const m = /^@([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(rest);
      if (!m) break;
      labelDefs.push({ name: m[1], line: i + 1 });
      rest = m[2];
    }
    if (!rest) continue;

    // First whitespace-separated token after labels = mnemonic.
    const tokens = rest.split(/\s+/);
    const mne = tokens[0];
    if (!mne) continue;
    // Mnemonics are uppercase letters/digits/underscore.
    if (!/^[A-Z][A-Z0-9_]*$/.test(mne)) continue;

    total++;
    byOpcode[mne] = (byOpcode[mne] || 0) + 1;
    const fam = families.get(mne) || 'other';
    byFamily[fam] = (byFamily[fam] || 0) + 1;

    if (!mneSet.has(mne) && unknownMnemonics.indexOf(mne) < 0) {
      unknownMnemonics.push(mne);
    }

    // Branches: JMP/JIZ/CAL take a single label-name operand. Record
    // so we can identify loops below.
    if (mne === 'JMP' || mne === 'JIZ' || mne === 'CAL') {
      const tgt = tokens[1];
      if (tgt && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tgt)) {
        branches.push({ from: i + 1, target: tgt, mnemonic: mne });
      }
    }
  }

  // Loop detection: a branch is a back-edge if its target label was
  // defined on or before the branch's own line (classic JMP-loop).
  // For each loop we estimate body size as branch_line − label_line.
  const labelLine = new Map<string, number>();
  for (const l of labelDefs) {
    if (!labelLine.has(l.name)) labelLine.set(l.name, l.line);
  }
  const loops: LacoDoAsm[] = [];
  for (const b of branches) {
    const lineOfLabel = labelLine.get(b.target);
    if (lineOfLabel == null) continue;
    if (lineOfLabel <= b.from) {
      loops.push({
        label:   b.target,
        labelLine: lineOfLabel,
        branchLine: b.from,
        branchMnemonic: b.mnemonic,
        bodyInstructions: Math.max(0, b.from - lineOfLabel),
      });
    }
  }
  loops.sort((a, b) => b.bodyInstructions - a.bodyInstructions);

  return { total, byOpcode, byFamily, labels: labelDefs, loops, unknownMnemonics };
}
