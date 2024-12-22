import * as trace from './trace';

/*
 * This is an index into knight_modifier_map or cadet_modifier_map,
 * which is used via kbd_modifier_map (which if KBD_NoSymbol means the
 * modifier is unmapped).
 */
export const KBD_NoSymbol = -1;
export const KBD_SHIFT = 0;	/* SHIFT BITS */
export const KBD_TOP = 1;	/* TOP BITS */
export const KBD_CONTROL = 2;	/* CONTROL BITS */
export const KBD_META = 3;	/* META BITS */
export const KBD_SHIFT_LOCK = 4;	/* SHIFT LOCK / CAPS LOCK ON CADET */
/* The	following do not exsit on the Knight keyboard. */
export const KBD_MODE_LOCK = 5;
export const KBD_GREEK = 6;
export const KBD_REPEAT = 7;
export const KBD_ALT_LOCK = 8;
export const KBD_HYPER = 9;
export const KBD_SUPER = 10;

export const kbd_type = 1;  // Cadet keyboard only
