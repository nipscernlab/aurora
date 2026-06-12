/**
 * simulator_preference.js — Qual simulador roda no botao Wave.
 *
 * Default: iverilog (toolchain bundlada em components/Packages/msys).
 * Alternativa: verilator — transpila pra C++, builda com g++, executa
 * binario nativo. Tipicamente 10-100x mais rapido que vvp em testbenches
 * longos, ao custo de stricter linting e dependencia adicional
 * (verilator + g++).
 *
 * Escopo: global (uma flag pro app inteiro), persistida em localStorage.
 * Per-projeto/per-testbench foi descartado pra evitar inflar o WaveStore
 * — a escolha de toolchain e do usuario, nao da testbench.
 *
 * Quem le: js/compilation/compilation_module.js (branch em runGtkWave).
 * Quem escreve: js/wave/wave_config_manager.js (toggle no modal).
 */

const STORAGE_KEY = 'aurora.waveSimulator';
const VALID = new Set(['iverilog', 'verilator']);

/**
 * Le a escolha atual. Retorna 'iverilog' como fallback se nada estiver
 * salvo ou o valor for desconhecido. Nunca lanca — chamado em hot paths
 * (cada clique no Wave), entao defensivo a corrupcao do storage.
 */
export function getSimulator() {
    try {
        const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
        return VALID.has(v) ? v : 'iverilog';
    } catch (_e) {
        return 'iverilog';
    }
}

/**
 * Persiste a escolha. Valores invalidos sao normalizados pra 'iverilog'.
 * Idempotente.
 */
export function setSimulator(value) {
    const normalized = VALID.has(value) ? value : 'iverilog';
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, normalized);
        }
    } catch (_e) { /* storage cheio / private mode — ignora */ }
    return normalized;
}
