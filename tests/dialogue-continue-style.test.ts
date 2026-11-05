import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The "Click to continue" prompt stays still: no bob, pulse, blink, or fade loop.
 * The same rule covers any continue or advance prompt in dialogue, chat, or a
 * terminal text box.
 */
const css = new TextDecoder().decode(readFileSync('src/styles.css'));

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

/** Rule bodies outside @keyframes, so a one-shot effect elsewhere is not a prompt. */
const ruleBodies = (): { selector: string; body: string }[] => {
  const withoutKeyframes = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  return [...withoutKeyframes.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
};

describe('dialogue continue prompt', () => {
  it('stays static and readable', () => {
    const prompt = rule('.dialogue-continue');
    expect(prompt).toMatch(/color:\s*#0a2a8a/);
    expect(prompt).toMatch(/font-size:\s*18px/);
    expect(prompt).not.toMatch(/animation\s*:/);
    expect(prompt).not.toMatch(/transform\s*:/);
    expect(css).not.toMatch(/continue-nudge|continue-arrow/);
    expect(css).not.toContain('.dialogue-continue::after');
  });

  it('dims in place after the click, without looping', () => {
    const waiting = rule('.dialogue.waiting .dialogue-continue');
    expect(waiting).toMatch(/opacity:\s*0\.45/);
    expect(waiting).not.toMatch(/animation\s*:/);
    expect(waiting).not.toMatch(/@keyframes/);
  });

  it('does not loop a dialogue, chat, or terminal advance prompt', () => {
    const looping = ruleBodies().filter(
      (block) =>
        /animation\s*:[^;]*\binfinite\b/.test(block.body) &&
        /dialogue|chat|terminal|cutscene|continue|advance/i.test(block.selector),
    );
    expect(looping).toEqual([]);
  });
});
