import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AnchoredItemSwitchStateModel,
  DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  deriveAnchoredItemSwitchAnchorId,
  deriveAnchoredItemSwitchOpen,
  isWithinAnchoredItemSwitchRelatedTarget,
} from '../../src/hooks/use-anchored-item-switch.ts';

const getItemId = (item) => item.id;

test('deriveAnchoredItemSwitchOpen is true only when activeItem is set', () => {
  assert.equal(deriveAnchoredItemSwitchOpen(null), false);
  assert.equal(deriveAnchoredItemSwitchOpen({ id: 'a' }), true);
});

test('first pointer enter schedules open; after openDelay activeItem is set', () => {
  const model = new AnchoredItemSwitchStateModel(getItemId);
  const itemA = { id: 'a' };

  assert.equal(model.onItemPointerEnter(itemA), 'schedule-open');
  assert.equal(model.open, false);

  assert.equal(model.openScheduledItem(itemA, itemA), true);
  assert.equal(model.open, true);
  assert.equal(model.activeItemId, 'a');
});

test('switching items while open does not close between items', () => {
  const model = new AnchoredItemSwitchStateModel(getItemId);
  const itemA = { id: 'a' };
  const itemB = { id: 'b' };

  model.onItemPointerEnter(itemA);
  model.openScheduledItem(itemA, itemA);
  assert.equal(model.open, true);

  assert.equal(model.onItemPointerEnter(itemB), 'instant-switch');
  assert.equal(model.open, true);
  assert.equal(model.activeItemId, 'b');
  assert.equal(model.anchorItemId, 'b');
});

test('beginClose keeps linger anchor id until cleared', () => {
  const model = new AnchoredItemSwitchStateModel(getItemId);
  const itemA = { id: 'a' };

  model.onItemPointerEnter(itemA);
  model.openScheduledItem(itemA, itemA);
  const closingId = model.beginClose();

  assert.equal(closingId, 'a');
  assert.equal(model.open, false);
  assert.equal(
    deriveAnchoredItemSwitchAnchorId(model.activeItemId, model.lingerAnchorId),
    'a',
  );

  model.clearLingerAnchor();
  assert.equal(model.anchorItemId, null);
});

test('open delay default matches hover-detail-tooltip precedent', () => {
  assert.equal(DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS, 400);
});

test('isWithinAnchoredItemSwitchRelatedTarget returns false for null and non-node targets', () => {
  assert.equal(
    isWithinAnchoredItemSwitchRelatedTarget(null, { triggerZone: null, content: null }),
    false,
  );
  assert.equal(
    isWithinAnchoredItemSwitchRelatedTarget('outside', { triggerZone: null, content: null }),
    false,
  );
});
