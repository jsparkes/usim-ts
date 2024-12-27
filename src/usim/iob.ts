import { octal } from './misc';
import * as trace from './trace';
import { assert_unibus_interrupt } from './ucode';

export let iob_csr = 0;
let iob_usec = 0;
let start_time = new Date().getMilliseconds() * 1000;

export function set_iob_csr(n: number) {
  iob_csr = n;
}

function get_us_clock(): number {
  let now = new Date().getMilliseconds() * 1000;
  let diff = now - start_time;
  return diff;
}

let iob_scancode = -1;
let iob_mouse_x = -1;
let iob_mouse_y = -1;

// command status register (CSR) get/set
// if interrupt is enabled, it also generates the interrupt
// https://tumbleweed.nu/r/lm-3/uv/cadr.html#Command_002fStatus-register-_0028CSR_0029

// keyboard ready CSR<5>
export function iob_is_keyboard_ready_set(): boolean {
  return ((iob_csr & (1 << 5)) != 0);
}

export function iob_set_keyboard_ready(scancode: number): void {
  if (scancode == cold_boot_scancode) {
    trace.info(trace.IOB, `iob: triggering cold reboot`);
    reboot_requested = true;
  }
  else if (scancode == warm_boot_scancode) {
    trace.info(trace.IOB, `iob: triggering warm reboot`);
    reboot_requested = true;
  }
  iob_scancode = scancode;
  iob_csr |= (1 << 5);
  // keyboard interrupt enabled ?
  if ((iob_csr & (1 << 2)) != 0) {
    assert_unibus_interrupt(0o260);
  }
}

export function iob_clear_keyboard_ready(): void {
  iob_csr &= ~(1 << 5);
}

// mouse ready CSR<4>
export function iob_is_mouse_ready_set(): boolean {
  return ((iob_csr & (1 << 4)) != 0);
}

export function iob_set_mouse_ready
  (
    mouse_x: number,
    mouse_rawx: number,
    mouse_y: number,
    mouse_rawy: number,
    mouse_head: number,
    mouse_middle: number,
    mouse_tail: number): void {
  iob_mouse_x = (mouse_rawx << 12) | (mouse_rawy << 14) | (mouse_x & 0x7777);
  iob_mouse_y = (mouse_tail << 12) | (mouse_middle << 13) | (mouse_head << 14) | (mouse_y & 0x7777);
  iob_csr |= (1 << 4);
  // mouse interrupt enabled ?
  if ((iob_csr & (1 << 1)) != 0) {
    assert_unibus_interrupt(0o264);
  }
}

export function iob_clear_mouse_ready(): void {
  iob_csr &= ~(1 << 4);
}

export function iob_unibus_read(offset: number): number {
  let v = 0;		/* For now default to zero. */
  switch (offset) {

    // #if WITH_SDL3

    // 	case 0100:
    // 		{
    // 			*pv = iob_scancode & 0177777;
    // 			INFO(TRACE_IOB, "iob: kbd low %011o\n", *pv);
    // 			iob_clear_keyboard_ready();
    // 		}
    // 		break;
    // 	case 0102:
    // 		{
    // 			*pv = (iob_scancode >> 16) & 0177777;
    // 			INFO(TRACE_IOB, "iob: kbd high %011o\n", *pv);
    // 			// CSR cleared above when reading 0100
    // 		}
    // 		break;
    // 	case 0104:
    // 		{
    // 			*pv = iob_mouse_y;
    // 			INFO(TRACE_IOB, "iob: mouse y %011o\n", *pv);
    // 			iob_clear_mouse_ready();
    // 		}
    // 		break;
    // 	case 0106:
    // 		{
    // 			*pv = iob_mouse_x;
    // 			INFO(TRACE_IOB, "iob: mouse x %011o\n", *pv);
    // 			// CSR cleared above when reading 0104
    // 		}
    // 		break;

    // #else

    case 0o100:
      v = kbd_scancode & 0o177777;
      trace.info(trace.IOB, `iob: kbd low ${octal(v)}`);
      iob_csr &= ~(1 << 5);	/* Clear CSR<5>. */
      break;
    case 0o102:
      v = (kbd_scancode >> 16) & 0o177777;
      trace.info(trace.IOB, `iob: kbd high ${octal(v)}`);
      iob_csr &= ~(1 << 5);	/* Clear CSR<5>. */
      break;
    case 0o104:
      v = (mouse_tail << 12) | (mouse_middle << 13) | (mouse_head << 14) | (mouse_y & 0o7777);
      trace.info(trace.IOB, `iob: mouse y ${octal(v)}`);
      iob_csr &= ~(1 << 4);	/* Clear CSR<4>. */
      break;
    case 0o106:
      v = (mouse_rawx << 12) | (mouse_rawy << 14) | (mouse_x & 07p777);
      trace.info(trace.IOB, `iob: mouse x ${octal(v)}`);
      break;

    // #endif

    case 0o110:
      trace.info(trace.IOB, "iob: beep");
      /* 
       * This is triggered by older code that does a %UNIBUS-READ. 
       */
      // MMcM: It's the number of microseconds between triggers of the
      //   flip-flop.  That is, half the wavelength.  So the frequency is, I
      //   think, (/ 1e6 (* #o1350 2)).  So I guess 672Hz. And duration is
      //   only .13sec.
      // #if WITH_X11
      // 		x11_beep();
      // #elif WITH_SDL2
      // 		sdl2_beep(-1);
      // #elif WITH_SDL3
      // 		sdl3_audio_beep(-1);
      // #else
      // 		fprintf(stderr, "\a");	/* Beep! */
      // #endif
      break;
    case 0o112:
      v = iob_csr;
      trace.info(trace.IOB, `iob: kbd csr ${octal(v)}`);
      break;
    case 0o120:
      iob_usec = get_us_clock();
      v = iob_usec & 0xffff;
      trace.info(trace.IOB, "iob: usec clock low");
      break;
    case 0o122:
      v = iob_usec >> 16;
      trace.info(trace.IOB, "iob: usec clock high");
      break;
    case 0o124:
      v = 0;
      trace.info(trace.IOB, "iob: 60hz clock");
      break;
    case 0o140:		/* ch_csr -- command and status register */
      v = uch11_get_csr();
      break;
    case 0o142:		/* ch_myaddr -- interface address */
      v = uch11_myaddr;
      trace.info(trace.IOB, `iob: chaos read my-number ${octal(v)}`);
      break;
    case 0o144:		/* ch_rbf -- read buffer */
      v = uch11_get_rcv_buffer();
      trace.info(trace.IOB, `iob: chaos read rcv buffer ${octal(v)}`);
      break;
    case 0o146:		/* ch_rbc -- read bit counter */
      v = uch11_get_bit_count();
      trace.info(trace.IOB, `iob: chaos read bit-count ${octal(v)}`);
      break;
    case 0o150:		/* ch_nop -- unused */
      break;
    case 0o152:		/* ch_xmt -- initiate transmission */
      v = uch11_myaddr;
      trace.info(trace.IOB, `iob: chaos read xmt => ${octal(v)}`);
      uch11_xmit_pkt();
      break;
    case 0o160:
    case 0o162:
    case 0o164:
    case 0o166:
      trace.info(trace.IOB, `iob: uart read ---!!! ${octal(offset)}`);
      break;
    default:
      if (offset > 0o140 && offset <= 0o153)
        trace.info(trace.IOB, `iob: chaos read other ${octal(offset)}`);
      uch11_xmit_pkt();
      break;
  }
}

export function iob_unibus_write(offset: number, v: number): void {
  switch (offset) {
    case 0o100:
      trace.info(trace.IOB, "iob: write kbd low");
      break;
    case 0o102:
      trace.info(trace.IOB, "iob: write kbd high");
      break;
    case 0o104:
      trace.info(trace.IOB, "iob: write mouse y");
      break;
    case 0o106:
      trace.info(trace.IOB, "iob: mouse x");
      break;
    case 0o110:
      trace.info(trace.IOB, "iob: beep");
      /* 
       * Triggered via %BEEP.
       */
      // #if WITH_X11
      // 		x11_beep();
      // #elif WITH_SDL2
      // 		sdl2_beep(v);
      // #elif WITH_SDL3
      // 		sdl3_audio_beep(v);
      // #else
      fprintf(stderr, "\a");	/* Beep! */
      // #endif
      break;
    case 0o112:
      trace.info(trace.IOB, "iob: write kbd csr");
      iob_csr = (iob_csr & ~0o17) | (v & 0o17);
      break;
    case 0o120:
      trace.info(trace.IOB, "iob: write usec clock high");
      break;
    case 0o122:
      trace.info(trace.IOB, "iob: usec clock low");
      break;
    case 0o124:
      trace.info(trace.IOB, "iob: start 60hz clock");
      break;
    case 0o140:		/* ch_csr -- command and status register */
      trace.info(trace.IOB, `iob: chaos write ${octal(v)}`);
      uch11_set_csr(v);
      break;
    case 0o142:		/* write buffer */
      trace.info(trace.IOB, `iob: chaos write-buffer write ${octal(v)}`);
      uch11_put_xmit_buffer(v);
      break;
    case 0o144:		/* ch_rbf -- read buffer */
    case 0o146:		/* ch_rbc -- read bit counter */
    case 0o150:		/* ch_nop -- unused */
    case 0o152:		/* ch_xmt -- initiate transmission */
      break;
    case 0o160:
    case 0o162:
    case 0o164:
    case 0o166:
      trace.info(trace.IOB, `iob: uart write ---!!! ${octal(v)}`;
      break;
    default:
      if (offset > 0o140 && offset <= 0o152)
        trace.info(trace.IOB, "iob: chaos write other");
      break;
  }
}

export function iob_poll(): void {
  #if WITH_SDL3;
  #else;
  mouse_poll();
  #endif;
  // there is no kbd_poll; handled by events
  uch11_poll();
}
