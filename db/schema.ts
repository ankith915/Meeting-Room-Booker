/**
 * Drizzle schema — rooms and bookings.
 *
 * Mirrors specs/001-meeting-room-booker/data-model.md.
 *
 * IMPORTANT: the non-overlap guarantee is NOT in this file. drizzle-kit cannot
 * express EXCLUDE constraints or CREATE EXTENSION, so bookings_no_overlap lives
 * in the hand-written drizzle/0001_exclusion_constraint.sql. Never run
 * `drizzle-kit push` against this schema — it does not know about that
 * constraint and will offer to drop it (plan.md risk 2).
 */

import {
  pgTable, uuid, text, integer, boolean, time, timestamp, pgEnum, index, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled']);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    location: text('location').notNull(),
    /** IANA identifier, e.g. "Asia/Kolkata". Drives all rendering (FR-014). */
    timezone: text('timezone').notNull(),
    /** Local wall-clock, not an instant — a recurring daily boundary (A-002). */
    opensAt: time('opens_at').notNull().default('08:00'),
    closesAt: time('closes_at').notNull().default('18:00'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check('rooms_capacity_positive', sql`${t.capacity} > 0`),
    // Forbids a bookable window that crosses local midnight, which makes EC-012
    // structurally impossible rather than a runtime check.
    check('rooms_hours_ordered', sql`${t.closesAt} > ${t.opensAt}`),
    index('rooms_active_idx').on(t.isActive).where(sql`${t.isActive}`),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      // RESTRICT, not CASCADE: rooms are deactivated, never deleted, so history
      // stays inspectable (FR-022). Cascade would silently destroy it.
      .references(() => rooms.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    organiser: text('organiser').notNull(),
    /** UTC instant (FR-021). Inclusive start of the half-open interval. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** UTC instant. EXCLUSIVE end — see FR-005, EC-003. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: bookingStatus('status').notNull().default('confirmed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // STRICT >, not >=. A zero-length interval overlaps nothing, so without
    // this it would slip past conflict detection entirely (EC-006).
    check('bookings_positive_duration', sql`${t.endsAt} > ${t.startsAt}`),
    check('bookings_title_length', sql`length(btrim(${t.title})) between 1 and 200`),
    check('bookings_organiser_present', sql`length(btrim(${t.organiser})) > 0`),
    // Day-schedule retrieval (FR-012).
    index('bookings_room_starts_idx')
      .on(t.roomId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
  ],
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
