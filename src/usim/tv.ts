import * as trace from './trace';
import * as fs from 'fs';
import { assert_xbus_interrupt, deassert_xbus_interrupt } from './ucode';
import { octal } from './misc';

export let tv_monitor = 1;		/* Default is Other (1). */

export let tv_width = 768;
export let tv_height = 963;
export let tv_bitmap = new Uint32Array(1024 * 1024);

let tv_csr = 0;
let tv_colorbit = 0;

export let tv_background = 0x000000;	// Black
export let tv_foreground = 0xffffff;	// White

let u_minh = 0x7fffffff;
let u_maxh = 0;
let u_minv = 0x7fffffff;
let u_maxv = 0;

function accumulate_update(h: number, v: number, hs: number, vs: number): void {
  if (h < u_minh)
    u_minh = h;
  if (h + hs > u_maxh)
    u_maxh = h + hs;
  if (v < u_minv)
    u_minv = v;
  if (v + vs > u_maxv)
    u_maxv = v + vs;
}

export function tv_update_screen(fn: (minh: number, minv: number, hs: number, vs: number) => number): void {
  const hs = u_maxh - u_minh;
  const vs = u_maxv - u_minv;
  if (u_minh != 0x7fffffff && u_minv != 0x7fffffff && u_maxh && u_maxv) {
    fn(u_minh, u_minv, hs, vs);
  }
  u_minh = 0x7fffffff;
  u_maxh = 0;
  u_minv = 0x7fffffff;
  u_maxv = 0;
}

function tv_post_60hz_interrupt(): void {
  tv_csr |= 1 << 4;
  assert_xbus_interrupt();
}

function sigalrm_handler(arg: any): void {
  tv_post_60hz_interrupt();
}

export function tv_screenshot(fn: string): void {
  const f = fs.openSync(fn, "wb");
  if (f < 0) {
    trace.warning(trace.UCODE, `failed to open: ${fn} for tv_snapshot`);
    return;
  }

  let buf = "P1\n";
  buf += `${tv_width} ${tv_height}\n`;
  fs.writeSync(f, buf);
  buf = "";
  for (let i = 0; i < tv_width * tv_height; i++) {
    if (tv_bitmap[i] == 0)
      buf += "0";
    else
      buf += "1";
    if (i % 70 == 0 && i > 0) {
      fs.writeSync(f, buf);
      buf = "";
    }
    fs.closeSync(f);
  }
}

export function tv_read(offset: number): number {
  offset *= 32;
  if (offset > tv_width * tv_height) {
    trace.warning(trace.TV, `tv: tv_read past end; offset ${octal(offset)}`);
    return 0;
  }
  let bits = 0;
  for (let i = 0; i < 32; i++) {
    if (tv_bitmap[offset + i] == tv_foreground)
      bits |= 1 << i;
  }
  return bits;
}

export function tv_flip_all(): void {
  for (let i = 0; i < tv_width * tv_height / 32; i++) {
    let bits = tv_read(i);
    tv_write(i, ~bits);
  }
}

export function tv_write(offset: number, bits: number): void {
  offset *= 32;
  let v = offset / tv_width;
  let h = offset % tv_width;
  for (let i = 0; i < 32; i++) {
    tv_bitmap[offset + i] = (bits & 1) ? tv_foreground : tv_background;
    bits >>= 1;
  }
  accumulate_update(h, v, 32, 1);
}

export function tv_xbus_read(offset: number) {
  return tv_csr;
}

export function tv_xbus_write(offset: number, bits: number): void {
  tv_csr = bits;
  tv_csr &= ~(1 << 4);

  /*
   * Handle hardware reverse-video functionality.
   */
  if ((bits & 4) != tv_colorbit) {
    tv_colorbit = bits & 4;
    {
      let temp = tv_foreground;
      tv_foreground = tv_background;
      tv_background = temp;
    }
    tv_colorbit = bits & 4;
    tv_flip_all();
  }
  deassert_xbus_interrupt();
}

export function tv_poll() {
  // throw new Error('Function not implemented.');
  //sdl2_event();
}



