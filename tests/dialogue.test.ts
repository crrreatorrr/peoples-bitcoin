/** Dialogue QA: every NPC dialogue variant can actually be seen. */
import { describe, expect, it } from 'vitest';
import type { NpcDef } from '../src/sim/schemas';
import { content } from './helpers';

type Variant = NpcDef['dialogue'][number];

/** Every quest that must be complete before `questId` can start. */
function prerequisites(questId: string): Set<string> {
  const c = content();
  const out = new Set<string>();
  const visit = (id: string) => {
    for (const r of c.quests.get(id)?.requires ?? []) {
      if (!out.has(r)) {
        out.add(r);
        visit(r);
      }
    }
  };
  visit(questId);
  return out;
}

/** True when `earlier` matches whenever `later` would, so `later` never shows (variants are first-match). */
function shadows(earlier: Variant, later: Variant): boolean {
  if (earlier.choice && earlier.choice !== later.choice) return false;
  if (earlier.status === 'complete') {
    if (later.quest === earlier.quest) return later.status === 'complete';
    return prerequisites(later.quest).has(earlier.quest);
  }
  if (later.quest !== earlier.quest || later.status !== 'started') return false;
  if (!earlier.step) return true;
  return later.step !== undefined && later.step.every((s) => earlier.step!.includes(s));
}

describe('NPC dialogue', () => {
  it('has no variant hidden behind an earlier one', () => {
    const hidden: string[] = [];
    for (const npc of content().npcs.values()) {
      npc.dialogue.forEach((later, i) => {
        const j = npc.dialogue.slice(0, i).findIndex((earlier) => shadows(earlier, later));
        if (j >= 0)
          hidden.push(`${npc.id}: ${later.quest} ${later.status} ${later.step ?? ''} by #${j}`);
      });
    }
    expect(hidden).toEqual([]);
  });

  it("has no 'quest complete' lines that the next quest always talks over", () => {
    // Talking starts any quest this NPC gives, before the lines are picked. So when finishing
    // `d.quest` makes the next quest available, the next quest's own lines always win.
    const c = content();
    const unseen: string[] = [];
    for (const npc of c.npcs.values()) {
      const covers = (quest: string, status: Variant['status'], step?: string) =>
        npc.dialogue.some(
          (d) =>
            d.quest === quest &&
            d.status === status &&
            !d.choice &&
            (!d.step || (step !== undefined && d.step.includes(step))),
        );
      for (const d of npc.dialogue.filter((v) => v.status === 'complete')) {
        // Handing a quest in to this NPC shows its 'complete' lines once, before the next one starts.
        const last = c.quests.get(d.quest)!.steps.at(-1)!.trigger;
        if ((last.type === 'talk' || last.type === 'deliver') && last.npc === npc.id) continue;
        const before = new Set([d.quest, ...prerequisites(d.quest)]);
        const next = [...c.quests.values()].find(
          (q) =>
            q.startNpc === npc.id &&
            !before.has(q.id) &&
            q.requires.every((r) => before.has(r)) &&
            q.steps.every(
              // a step that is talking to this NPC is done by the time the lines are picked
              (s) =>
                (s.trigger.type === 'talk' && s.trigger.npc === npc.id) ||
                covers(q.id, 'started', s.id),
            ) &&
            (covers(q.id, 'complete') ||
              q.steps.some(
                (s) =>
                  s.trigger.type === 'choice' &&
                  s.trigger.ids.every((id) =>
                    npc.dialogue.some((v) => v.quest === q.id && v.choice === id),
                  ),
              )),
        );
        if (next) unseen.push(`${npc.id}: ${d.quest} complete (always ${next.id})`);
      }
    }
    expect(unseen).toEqual([]);
  });

  it('keys no lines to a "talk to me" step, which is done before the lines are picked', () => {
    const c = content();
    const dead: string[] = [];
    for (const npc of c.npcs.values()) {
      for (const d of npc.dialogue) {
        const steps = c.quests.get(d.quest)!.steps;
        const live = (d.step ?? ['*']).some((id) => {
          const t = steps.find((s) => s.id === id)?.trigger;
          return !(t?.type === 'talk' && t.npc === npc.id);
        });
        if (!live) dead.push(`${npc.id}: ${d.quest} ${d.step?.join(',')}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('points variants at real quests and steps', () => {
    const c = content();
    for (const npc of c.npcs.values()) {
      for (const d of npc.dialogue) {
        const quest = c.quests.get(d.quest);
        expect(quest, `${npc.id}: ${d.quest}`).toBeDefined();
        for (const s of d.step ?? []) {
          expect(
            quest!.steps.some((st) => st.id === s),
            `${npc.id}: ${d.quest} has no step '${s}'`,
          ).toBe(true);
        }
      }
    }
  });
});
