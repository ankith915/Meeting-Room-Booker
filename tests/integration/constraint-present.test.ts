/**
 * T012 — the constraint exists, by name.
 *
 * plan.md risk 2: a future `drizzle-kit push` or a regenerated migration could
 * silently drop bookings_no_overlap. Every other test in the suite would keep
 * passing, because they exercise paths that also have application-layer
 * checks. This test is the tripwire: it asserts the guarantee itself, so its
 * loss is loud rather than silent.
 */

import { describe, it, expect } from 'vitest';
import { guaranteeDefinition } from '@/lib/server/bookings';

describe('T012: the guarantee is present in the database', () => {
  it('bookings_no_overlap exists', async () => {
    const def = await guaranteeDefinition();
    expect(def, 'bookings_no_overlap is MISSING — the guarantee is gone').not.toBeNull();
  });

  it('it is a GiST exclusion constraint', async () => {
    const def = (await guaranteeDefinition()) ?? '';
    expect(def).toMatch(/EXCLUDE USING gist/i);
  });

  it('it is scoped per room (EC-004)', async () => {
    const def = (await guaranteeDefinition()) ?? '';
    expect(def).toMatch(/room_id WITH =/);
  });

  it('it tests range OVERLAP, not equality (EC-002)', async () => {
    const def = (await guaranteeDefinition()) ?? '';
    expect(def).toMatch(/WITH &&/);
  });

  it('it uses half-open bounds, so adjacent bookings are legal (EC-003)', async () => {
    const def = (await guaranteeDefinition()) ?? '';
    expect(def).toContain("'[)'");
  });

  it('it is partial on confirmed, so cancelled bookings free the slot (EC-005)', async () => {
    const def = (await guaranteeDefinition()) ?? '';
    expect(def).toMatch(/WHERE .*status = 'confirmed'/);
  });
});
