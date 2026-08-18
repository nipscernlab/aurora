import { describe, it, expect } from 'vitest';
import pkg from '../../main/ai/native_tools.js';

const { NATIVE_TOOLS, DISALLOWED_TOOLS } = pkg;

// The native surface the Claude Code engines hand the model. This list is the
// ONLY thing standing between the assistant and the CLI's full built-in set:
// none of it passes Aurora's Allow/Deny card, which gates mcp__aurora__* only.
describe('NATIVE_TOOLS (allowlist)', () => {
    it('is a non-empty list of unique names', () => {
        expect(Array.isArray(NATIVE_TOOLS)).toBe(true);
        expect(NATIVE_TOOLS.length).toBeGreaterThan(0);
        expect(new Set(NATIVE_TOOLS).size).toBe(NATIVE_TOOLS.length);
    });

    // Read is load-bearing, not a convenience: the image-attachment flow writes
    // a temp file in main and the model reads it back. Dropping it breaks
    // sending images to the assistant.
    it('keeps Read — the image-attachment flow depends on it', () => {
        expect(NATIVE_TOOLS).toContain('Read');
    });

    // ToolSearch is how the model discovers the mcp__aurora__* surface when it
    // is deferred; without it Aurora's own tools can be unreachable.
    it('keeps ToolSearch — MCP discovery depends on it', () => {
        expect(NATIVE_TOOLS).toContain('ToolSearch');
    });

    // Each of these was live before the allowlist landed. They are named
    // individually so re-adding one fails HERE, with the reason attached,
    // instead of shipping silently.
    it.each([
        ['Bash', 'shells around the compile pipeline, ungated'],
        ['Write', 'writes files without the Allow/Deny card'],
        ['Edit', 'edits files without the Allow/Deny card'],
        ['AskUserQuestion', 'self-resolves CLI-side under bypassPermissions — no card ever renders'],
        ['Task', 'spawns subagents: uncapped subscription spend, invisible to the tool chips'],
        ['Workflow', 'spawns DOZENS of agents; opt-in by design and Aurora has no opt-in'],
        ['Artifact', 'publishes a local file as a page hosted on claude.ai — outward distribution'],
        ['CronCreate', 'schedules cloud agents that run with nobody watching'],
        ['CronDelete', 'same cron surface'],
        ['CronList', 'same cron surface'],
        ['RemoteTrigger', 'launches agents in a remote cloud environment'],
        ['ScheduleWakeup', 'schedules unattended wake-ups'],
        ['PushNotification', "sends to the user's phone"],
        ['EnterWorktree', "creates/switches git worktrees under the IDE, no card"],
        ['ExitWorktree', 'same worktree surface'],
        ['SendMessage', 'only addresses Task/Workflow subagents'],
        ['Monitor', 'exists to watch background Bash, which is off'],
        ['ReportFindings', 'renders into a host UI Aurora does not implement — output would vanish'],
        ['DesignSync', 'undocumented in the SDK; unrelated to SAPHO'],
    ])('does not expose %s (%s)', (tool) => {
        expect(NATIVE_TOOLS).not.toContain(tool);
    });
});

describe('DISALLOWED_TOOLS (hard deny)', () => {
    it('is a non-empty list of unique names', () => {
        expect(Array.isArray(DISALLOWED_TOOLS)).toBe(true);
        expect(DISALLOWED_TOOLS.length).toBeGreaterThan(0);
        expect(new Set(DISALLOWED_TOOLS).size).toBe(DISALLOWED_TOOLS.length);
    });

    // Both lists reach the CLI on the same run. A name in both is incoherent:
    // it would say "available" and "denied" at once.
    it('never contradicts the allowlist', () => {
        const both = DISALLOWED_TOOLS.filter((t) => NATIVE_TOOLS.includes(t));
        expect(both).toEqual([]);
    });

    it('hard-denies the destructive built-ins even if the allowlist slips', () => {
        for (const t of ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'AskUserQuestion']) {
            expect(DISALLOWED_TOOLS).toContain(t);
        }
    });
});
