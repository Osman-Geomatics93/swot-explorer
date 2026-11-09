import { expect, it } from 'vitest';
import { completeOrder, moveInOrder } from '@/state/layers';

const top = (order: string[], active: string[]) => completeOrder(order).filter((id) => active.includes(id));

it('defaults: points over lines over lakes over study areas', () => {
  const active = ['areas', 'preview-lakes', 'preview-reaches', 'preview-nodes'];
  expect(top([], active)).toEqual(['preview-nodes', 'preview-reaches', 'preview-lakes', 'areas']);
});

it('moves a layer past the next visible layer, skipping layers not on the map', () => {
  const active = ['preview-reaches', 'preview-lakes', 'areas']; // no nodes, pieces or footprints shown
  let order = completeOrder([]);
  order = moveInOrder(order, 'preview-lakes', -1, active);
  expect(top(order, active)).toEqual(['preview-lakes', 'preview-reaches', 'areas']);
  order = moveInOrder(order, 'preview-lakes', 1, active);
  order = moveInOrder(order, 'preview-lakes', 1, active);
  expect(top(order, active)).toEqual(['preview-reaches', 'areas', 'preview-lakes']);
});

it('does nothing at the ends', () => {
  const active = ['preview-reaches', 'areas'];
  const order = completeOrder([]);
  expect(moveInOrder(order, 'preview-reaches', -1, active)).toBe(order);
  expect(moveInOrder(order, 'areas', 1, active)).toBe(order);
});

it('keeps a saved order and slots new layer groups in at their default place', () => {
  const saved = ['areas', 'preview-lakes']; // e.g. saved before other groups existed
  const full = completeOrder(saved);
  expect(full.indexOf('areas')).toBeLessThan(full.indexOf('preview-lakes'));
  expect(full).toContain('preview-nodes');
  expect(new Set(full).size).toBe(full.length);
});
