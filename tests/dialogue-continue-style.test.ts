import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The "Click to continue" prompt moves, stops while a reply is pending, and respects reduced motion. */
const css = new TextDecoder().decode(readFileSync('src/styles.css'));

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('dialogue continue prompt', () => {
  it('animates while waiting for the player', () => {
    expect(rule('.dialogue-continue')).toMatch(/animation:\s*continue-nudge .* infinite/);
    expect(css).toContain('@keyframes continue-nudge');
    expect(css).toContain('@keyframes continue-arrow');
  });

  it('stops once the click is sent', () => {
    expect(rule('.dialogue.waiting .dialogue-continue')).toContain('animation: none');
  });

  it('holds still for reduced motion', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(css.slice(at, at + 200)).toMatch(/\.dialogue-continue[\s\S]*animation: none/);
  });
});
