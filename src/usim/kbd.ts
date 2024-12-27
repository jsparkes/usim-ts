import { iob_csr, set_iob_csr } from './iob';
import { octal, Queue } from './misc';
import * as trace from './trace';
import { assert_unibus_interrupt } from './ucode';

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
let kbd_scancode = 0;

export const KEY_QUEUE_LEN = 10;
const key_queue = new Queue<number>();

export function kbd_queue_key_event(ev: number): number {
	const v = (1 << 16) | ev;
    if (key_queue.length <= KEY_QUEUE_LEN) {
        key_queue.push(v);
    } else {
        trace.warning(trace.KBD, `kbd_queue_key_event() - iob key queue full!`);
		if (!(iob_csr & (1 << 5)) && (iob_csr & (1 << 2))) {
			set_iob_csr(iob_csr | 1 << 5);
            trace.warning(trace.KBD, `kbd_queue_key_event() - generating interrupt`);
			assert_unibus_interrupt(0o260);
		}
    }
    return key_queue.length;
}

export function kbd_dequeue_key_event(): void
{
	if (iob_csr & (1 << 5))	/* Already something to be read. */
		return;
	if (key_queue.length < KEY_QUEUE_LEN) {
		const v = key_queue.shift();
        trace.debug(trace.KBD, `kbd_dequeue_key_event() - dequeuing 0%o (queue length before ${key_queue.length}`);
        if (v) {
            kbd_scancode = (1 << 16) | v;
		    if (iob_csr & (1 << 2))	/* Keyboard interrupt enabled? */
			   set_iob_csr(iob_csr | 1 << 5);
            trace.warning(trace.KBD, `kbd_dequeue_key_event() - generating interrupt (queue length after ${key_queue.length})`);
			assert_unibus_interrupt(0o260);
		}
	}
}

export function kbd_event(code: number, keydown:boolean): void
{
	trace.debug(trace.KBD, `kbd_event(code=${octal(code)}, keydown=${keydown}`);
	const v = ((keydown ? 0 : 1) << 8) | code;
	if (iob_csr & (1 << 5))
		kbd_queue_key_event(v);	/* Already something there, queue this. */
	else {
		kbd_scancode = (1 << 16) | v;
        trace.debug(trace.KBD, `kbd_event() - kbd_scancode = ${octal(kbd_scancode)})`);
		if (iob_csr & (1 << 2)) {
			set_iob_csr(iob_csr | 1 << 5);
			assert_unibus_interrupt(0o260);
		}
	}
}

// kbd_cold_boot_key -- ???

/*
  You hold down all four control and meta keys on your keyboard,
and hit return if you want to use the same virtual memory as now,
or rubout if you want to load a new copy of virtual memory.  Hitting
other keys is undefined.

The incantations used for warm-booting and cold-booting involve holding
down all four control and meta keys simultaneously (the two to the left
of the space bar and the two to the right of the space bar), and striking
RUBOUT for a cold-boot or RETURN for a warm-boot.  This combination
of keys is extremely difficult to type accidentally.

RMS@MIT-AI 01/02/79 05:17:38
To: (BUG LISPM) at MIT-AI
C-M-C-M-digit should load the band for that digit.

;Enter here from the PROM.  Virtual memory is not valid yet.
(LOC 6)
PROM	(JUMP-NOT-EQUAL-XCT-NEXT Q-R A-ZERO PROM)    ;These 2 instructions duplicate the prom
       ((Q-R) ADD Q-R A-MINUS-ONE)
;;; Decide whether to restore virtual memory from saved band on disk, i.e.
;;; whether this is a cold boot or a warm boot.  If the keyboard has input
;;; available, and the character was RETURN (rather than RUBOUT), it's a warm boot.
	(CALL-XCT-NEXT PHYS-MEM-READ)
       ((VMA) (A-CONSTANT 17772045))		;Unibus address 764112 (KBD CSR)
	(JUMP-IF-BIT-CLEAR (BYTE-FIELD 1 5) MD	;If keyboard is not ready,
		COLD-BOOT)			; assume we are supposed to cold-boot
	(CALL-XCT-NEXT PHYS-MEM-READ)
       ((VMA) (A-CONSTANT 17772040))		;Unibus address 764100 (KBD LOW)
	((MD) (BYTE-FIELD 6 0) MD)		;Get keycode
	(JUMP-EQUAL MD (A-CONSTANT 46) COLD-BOOT)	;This is cold-boot if key is RUBOUT
	((MD) (A-CONSTANT 46))			;Standardize mode.  Mostly, set to NORMAL speed
	(CALL-XCT-NEXT PHYS-MEM-WRITE)		;40 is PROM-DISABLE, 2 is NORMAL speed.
       ((VMA) (A-CONSTANT 17773005))		;Unibus 766012
	(JUMP BEG0000)

// ukbd -- cadet prom

;Is request to boot machine if both controls and both metas are held
;down, along with rubout or return.  We have just sent the key-down codes
;for all of those keys.  We now send a boot character, then set a flag preventing
;sending of up-codes until the next down-code.  This gives the machine time
;to load microcode and read the character to see whether
;it is a warm or cold boot, before sending any other characters, such as up-codes.
;  meta		45 / 165
;  control	20 / 26
;  rubout	23 
;  return	136
; The locking keys are in bytes 1, 3, and 12, conveniently out of the way
;A boot code:
;  15-10	1
;  9-6		0
;  5-0		46 (octal) if cold, 62 (octal) if warm.

check-boot
	(mov r1 (/# bootflag))		;Establish addressibility for later
	(mov r0 (/# 64))		;Check one meta key
	(mov a @r0)
	(xrl a (/# 1_5))
	(jnz not-boot)
	(mov r0 (/# 76))		;Check other meta key
	(mov a @r0)
	(xrl a (/# 1_5))
	(jnz not-boot)
	(mov r0 (/# 62))		;Check byte containing controls and rubout
	(mov a @r0)
	(xrl a (/# (+ 1_0 1_6 1_3)))
	(jz cold-boot)			;Both controls and rubout => cold-boot
	(xrl a (/# 1_3))
	(jnz not-boot)
	(mov r0 (/# 73))		;Check for return
	(mov a @r0)
	(xrl a (/# 1_6))
	(jnz not-boot)
warm-boot
	(mov r2 (/# 62_1))
	(jmp send-boot)

cold-boot
	(mov r2 (/# 46_1))
send-boot
	(mov r3 (/# 174_1))		;1's in bits 14-10
	(mov r4 (/# 363))		;Source ID 1 (new keyboard), 1 in bit 15
	(mov @r1 (/# 377))		;Set bootflag
	(jmp send)			;Transmit character and return

not-boot
	(mov @r1 (/# 0))		;Clear bootflag
	(ret)

*/
 
export function kbd_warm_boot_key()		// Is this even needed?
{
	// 062 == KNIGHT_cr? -- seems to be a keyboard event and not a "return"!
	// kbd_event(0o50, false);	/* Send a Return to get the machine booted. */
	// set_iob_csr(iob_csr | 1 << 5);	/* Set CSR<5>. */
	// assert_unibus_interrupt(0o260);
}

/*
 * Takes a string, and returns the equivalent Lisp Machine character
 * code.  Returns LMCH_NoSymbol on error.
 */
export function kbd_lmchar( key: string): number
{
   for (let i = 0; i < lmchar_map.length; i++) {
       if (streq(key, lmchar_map[i].name) == true)
           return lmchar_map[i].lmchar;
   }
   return LMCH_NoSymbol;
}

