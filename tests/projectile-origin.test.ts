import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { THROW_RELEASE_MS } from '../src/render/animate';
import { Tracers } from '../src/render/effects';
import { gearModel, MUZZLE, THROW_ORIGIN } from '../src/render/gear';

describe('Sproto projectile origins', () => {
  it.each(['pistol', 'sniper', 'minigun'])('launches from the posed %s muzzle', (weapon) => {
    const scene = new THREE.Scene();
    const shooter = new THREE.Group();
    const gear = gearModel(weapon)!.model;
    const muzzle = gear.getObjectByName(MUZZLE)!;
    shooter.add(gear);
    scene.add(shooter);
    const tracers = new Tracers(scene);
    const arrived = vi.fn();
    const flight = tracers.fire(shooter.position, new THREE.Vector3(4, 0, 4), 'shot', 0, {
      origin: () => muzzle.getWorldPosition(new THREE.Vector3()),
      onArrive: arrived,
    });
    const shot = scene.children[1];
    shooter.rotation.y = Math.PI / 2;
    gear.position.set(1, 2, 3);
    const start = muzzle.getWorldPosition(new THREE.Vector3());

    tracers.update(0);
    expect(shot.position).toEqual(start);
    gear.position.y += 2;
    tracers.update(flight / 2);
    expect(shot.position).toEqual(start.clone().lerp(new THREE.Vector3(4, 0.8, 4), 0.5));
    tracers.update(flight);
    expect(scene.children).not.toContain(shot);
    expect(arrived).toHaveBeenCalledTimes(1);
  });

  it('waits for the throw and launches the rock from its position in the hand', () => {
    const scene = new THREE.Scene();
    const heldRock = gearModel('rock')!.model;
    const origin = heldRock.getObjectByName(THROW_ORIGIN)!;
    scene.add(heldRock);
    const tracers = new Tracers(scene);
    tracers.fire(heldRock.position, new THREE.Vector3(3, 0, 0), 'rock', 0, {
      origin: () => origin.getWorldPosition(new THREE.Vector3()),
      delayMs: THROW_RELEASE_MS,
    });
    const shot = scene.children[1];
    tracers.update(THROW_RELEASE_MS - 1);
    expect(shot.visible).toBe(false);
    heldRock.position.set(1, 2, 3);
    tracers.update(THROW_RELEASE_MS + 1);
    expect(shot.visible).toBe(true);
    expect(shot.position).toEqual(origin.getWorldPosition(new THREE.Vector3()));
  });
});
