// O auto-merge do Dependabot: so PR que o Dependabot abriu neste repositorio,
// e so o commit que o CI testou. Nome do ramo e mensagem do commit sao
// escolhidos por quem abre o PR, entao nenhum dos dois basta (auditoria de
// 28/10/2026). O workflow nao tem como rodar aqui; o teste fixa as guardas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = YAML.parse(fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'dependabot-automerge.yml'), 'utf8'));
const job = wf.jobs['auto-merge'];
const passo = (nome) => job.steps.find((s) => s.name === nome);

describe('dependabot-automerge.yml', () => {
    it('so roda para CI verde de PR que o Dependabot abriu neste repositorio', () => {
        expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
        expect(job.if).toContain("github.event.workflow_run.actor.login == 'dependabot[bot]'");
        expect(job.if).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    });

    it('acha o PR pelo commit testado, e nao pelo nome do ramo', () => {
        const run = passo('Resolve PR and update type').run;
        expect(run).toContain('repos/$REPO/commits/$HEAD_SHA/pulls');
        expect(run).toContain('.user.login == \\"dependabot[bot]\\"');
        expect(run).toContain('.head.repo.full_name == \\"$REPO\\"');
        expect(run).toContain('.head.sha == \\"$HEAD_SHA\\"');
        expect(run).not.toMatch(/gh pr list[^\n]*--head/);
    });

    it('o merge fica preso ao commit que passou no CI', () => {
        const merge = passo('Merge');
        expect(merge.run).toContain('--match-head-commit "$HEAD_SHA"');
        expect(merge.env.HEAD_SHA).toBe('${{ github.event.workflow_run.head_sha }}');
        expect(merge.run).not.toContain('--auto');
    });
});
