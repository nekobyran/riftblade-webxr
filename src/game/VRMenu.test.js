import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  VRMenu,
  VR_MENU_MODES,
  VR_MENU_PAGE_SIZE,
  createVRMenuState,
  reduceVRMenuAction,
} from './VRMenu.js';

const TRACKS = Array.from({ length: 10 }, (_, index) => ({
  id: `track-${index + 1}`,
  title: `Track ${index + 1}`,
  bpm: 100 + index,
}));

describe('VR menu state', () => {
  it('paginates ten tracks in two pages of five and clamps navigation', () => {
    let state = createVRMenuState({ tracks: TRACKS });
    expect(VR_MENU_PAGE_SIZE).toBe(5);
    expect(state).toMatchObject({ page: 0, pages: 2, selectedTrackId: 'track-1' });

    state = reduceVRMenuAction(state, { type: 'page', delta: 1 }, TRACKS);
    expect(state.page).toBe(1);
    state = reduceVRMenuAction(state, { type: 'page', delta: 99 }, TRACKS);
    expect(state.page).toBe(1);
    state = reduceVRMenuAction(state, { type: 'page', delta: -99 }, TRACKS);
    expect(state.page).toBe(0);
  });

  it('accepts exactly the three supported play modes', () => {
    expect(VR_MENU_MODES).toEqual(['standard', 'auto', 'zen']);
    for (const mode of VR_MENU_MODES) {
      expect(reduceVRMenuAction(createVRMenuState({ tracks: TRACKS }), { type: 'mode', mode }, TRACKS).mode).toBe(mode);
    }
    expect(reduceVRMenuAction(createVRMenuState({ tracks: TRACKS }), { type: 'mode', mode: 'invalid' }, TRACKS).mode).toBe('standard');
  });
});

describe('VR controller interaction', () => {
  it('ray-hovers a track and trigger selection emits the chosen action', () => {
    const onAction = vi.fn();
    const menu = new VRMenu({ tracks: TRACKS, onAction });
    menu.setVisible(true);

    const controller = new THREE.Group();
    // The first hit plane is 0.76 m above the panel origin.
    controller.position.set(0, menu.group.position.y + 0.76, 0);

    expect(menu.updateController(controller)).toEqual({ type: 'track', trackId: 'track-1' });
    expect(menu.hovered?.userData?.menuAction?.trackId).toBe('track-1');
    expect(controller.getObjectByName('rift-menu-ray')?.visible).toBe(true);
    expect(controller.getObjectByName('rift-menu-reticle')?.visible).toBe(true);

    expect(menu.select(controller)).toBe(true);
    expect(menu.state.selectedTrackId).toBe('track-1');
    expect(onAction).toHaveBeenCalledWith(
      { type: 'track', trackId: 'track-1' },
      expect.objectContaining({ selectedTrackId: 'track-1' }),
      expect.any(Object),
    );
    disposeObject(controller);
    menu.dispose();
  });

  it('moves the visible selection page when an external track is selected', () => {
    const menu = new VRMenu({ tracks: TRACKS });
    menu.setTrack('track-8');
    expect(menu.snapshot()).toMatchObject({ page: 1, pages: 2, selectedTrackId: 'track-8' });
    expect(menu.hitTargets.filter((target) => target.userData.menuAction?.type === 'track')).toHaveLength(5);
    menu.dispose();
  });
});

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}
