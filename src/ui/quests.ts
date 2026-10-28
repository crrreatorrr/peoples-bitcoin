/**
 * OSRS-style quest list (a side-panel tab) and quest journal (a window). Quest
 * names are red until started, yellow while in progress and green once
 * complete; clicking one opens its journal.
 */
import type { Content } from '../sim/content';
import { questPoints, type QuestHint } from '../sim/quests';
import type { QuestDef } from '../sim/schemas';
import type { GameState, SimContext } from '../sim/state';
import { span } from './tooltips';

type QuestStatus = 'not-started' | 'started' | 'complete';

/** Reward unlock flags, in words. */
const UNLOCK_TEXT: Record<string, string> = {
  bunker: 'Your own bunker, and the Construction skill',
};

function statusOf(state: GameState, quest: QuestDef): QuestStatus {
  const progress = state.player.quests[quest.id];
  return !progress ? 'not-started' : progress.complete ? 'complete' : 'started';
}

export class QuestList {
  readonly el = document.createElement('div');
  private key = '';

  constructor(
    private readonly ctx: SimContext,
    private readonly openJournal: (questId: string) => void,
  ) {
    this.el.className = 'quests';
  }

  update(state: GameState, hint: QuestHint | null): void {
    const quests = [...this.ctx.content.quests.values()];
    const statuses = quests.map((q) => statusOf(state, q));
    const key = JSON.stringify([statuses, hint?.text]);
    if (key === this.key) return;
    this.key = key;

    const { earned, total } = questPoints(state.player, this.ctx);
    const blocks: Node[] = [span('quest-points', `Quest Points: ${earned}/${total}`)];
    if (hint) blocks.push(span('quest-hint', `Next: ${hint.text}`));
    const list = document.createElement('div');
    list.className = 'quest-list';
    quests.forEach((quest, i) => {
      const button = document.createElement('button');
      button.className = `quest-name ${statuses[i]}`;
      button.textContent = quest.name;
      button.title = 'Read the quest journal';
      button.addEventListener('click', () => this.openJournal(quest.id));
      list.append(button);
    });
    blocks.push(list);
    this.el.replaceChildren(...blocks);
  }
}

export class QuestJournal {
  readonly el = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly body = document.createElement('div');
  private questId: string | null = null;
  private key = '';

  constructor(
    root: HTMLElement,
    private readonly content: Content,
  ) {
    this.el.className = 'quest-journal panel';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(this.title, close);
    this.body.className = 'journal-body';
    this.el.append(header, this.body);
    root.append(this.el);
  }

  open(questId: string): void {
    this.questId = questId;
    this.key = '';
    this.el.hidden = false;
  }

  close(): void {
    this.questId = null;
    this.el.hidden = true;
  }

  update(state: GameState): void {
    const quest = this.questId ? this.content.quests.get(this.questId) : undefined;
    if (!quest) return;
    const progress = state.player.quests[quest.id];
    const key = JSON.stringify([quest.id, progress]);
    if (key === this.key) return;
    this.key = key;

    this.title.textContent = quest.name;
    const lines: Node[] = [];
    if (quest.summary) lines.push(span('journal-summary', quest.summary));
    if (!progress) {
      const npc = quest.startNpc ? this.content.npcs.get(quest.startNpc)?.name : null;
      lines.push(
        span('journal-line', npc ? `I can start this quest by talking to ${npc}.` : 'Not started.'),
      );
    } else {
      // Like an OSRS journal, an ordered quest only reveals the step you're on.
      const firstOpen = quest.steps.findIndex((s) => !progress.done.includes(s.id));
      quest.steps.forEach((step, i) => {
        const done = progress.done.includes(step.id);
        if (quest.ordered && !done && i !== firstOpen) return;
        lines.push(span(`journal-line${done ? ' done' : ''}`, step.text));
      });
      if (progress.complete) lines.push(span('journal-complete', 'QUEST COMPLETE!'));
    }
    lines.push(span('journal-heading', 'Rewards'));
    for (const text of this.rewardLines(quest)) lines.push(span('journal-reward', text));
    this.body.replaceChildren(...lines);
  }

  private rewardLines(quest: QuestDef): string[] {
    const lines = [`${quest.points} Quest Point${quest.points === 1 ? '' : 's'}`];
    const r = quest.reward;
    if (!r) return lines;
    if (r.unlock) lines.push(UNLOCK_TEXT[r.unlock] ?? `Unlocks: ${r.unlock}`);
    if (r.usd > 0) lines.push(`$${r.usd.toLocaleString('en-US')} worth of $BITCOIN`);
    for (const s of r.items) {
      lines.push(`${s.qty} × ${this.content.items.get(s.item)?.name ?? s.item}`);
    }
    for (const [skillId, xp] of Object.entries(r.xp)) {
      const skill = this.content.skills.get(skillId)?.name ?? skillId;
      lines.push(`${xp.toLocaleString('en-US')} ${skill} XP`);
    }
    return lines;
  }
}
