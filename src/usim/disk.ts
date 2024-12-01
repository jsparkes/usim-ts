import * as trace from './trace';
import * as fs from 'fs';
import mmap from '@riaskov/mmap-io';
import { read_phy_mem, write_phy_mem } from './memory';
import { assert_xbus_interrupt, deassert_xbus_interrupt } from './ucode';
import { octal } from './util';

const LABEL_LABL = 0o114204405140;
const LABEL_BLANK = 0o20020020020;

const DISKS_MAX = 8;

class Disk {
  fd: number = 0;
  mm: Buffer | undefined;
  mmsz: number = 0;
  cyls: number = 0;
  heads: number = 0;
  blocks_per_track: number = 0;
}

const DISKS = new Array<Disk>(DISKS_MAX);
const BLOCKSZ = 256 * 4;

let disk_status = 1;
let disk_cmd = 0;
let disk_clp = 0;
let disk_ma = 0;
const disk_ecc = 0;
let disk_da = 0;
let cur_unit = 0;
let cur_cyl = 0;
let cur_head = 0;
let cur_block = 0;
let disk_interrupt_delay = 0;

function disk_read(unit: number, block_no: number): Uint32Array {
  const offset = block_no * BLOCKSZ;
  if (offset >= DISKS[unit].mmsz) { trace.error(trace.DISK, `disk: reading offset ${offset} past end of disk image ${DISKS[unit].mmsz}`); }
  trace.debug(trace.DISK, `disk: reading block ${block_no}, offset ${offset}`);
  const buf = DISKS[unit].mm?.slice(offset, offset + BLOCKSZ);
  if (buf) { return new Uint32Array(buf); }
  // This should never happen!
  else { return new Uint32Array(BLOCKSZ); }
}

function disk_write(unit: number, block_no: number, buffer: Uint32Array): void {
  const offset = block_no * BLOCKSZ;
  if (offset >= DISKS[unit].mmsz) { trace.error(trace.DISK, `disk: writing offset ${offset} past end of disk image ${DISKS[unit].mmsz}`); }
  trace.debug(trace.DISK, `disk: writing block ${block_no}, offset ${offset}`);
  if (DISKS[unit].mm) { Buffer.from(buffer, 0, buffer.length).copy(DISKS[unit].mm, offset); }
}

function disk_read_block(vma: number, unit: number, cyl: number, head: number, block: number): void {
  const block_no = cyl * DISKS[unit].blocks_per_track * DISKS[unit].heads + head * DISKS[unit].blocks_per_track + block;
  const buffer = disk_read(unit, block_no);
  for (let i = 0; i < 256; i++) {
    write_phy_mem(vma + i, buffer[i]);
  }
}

function disk_write_block(vma: number, unit: number, cyl: number, head: number, block: number) {
  const buffer = new Uint32Array(256);

  const block_no = cyl * DISKS[unit].blocks_per_track * DISKS[unit].heads + head * DISKS[unit].blocks_per_track + block;
  for (let i = 0; i < 256; i++) {
    buffer[i] = read_phy_mem(vma + i) ?? 0;
  }
  disk_write(unit, block_no, buffer);
}

function disk_throw_interrupt(): void {
  trace.debug(trace.DISK, 'disk: throw interrupt');
  disk_status |= 1 << 3;
  assert_xbus_interrupt();
}

function disk_future_interrupt() {
  disk_interrupt_delay = 100;
  disk_interrupt_delay = 2500;
}

function disk_show_cur_addr() {
  trace.debug(
    trace.DISK,
    `disk: unit ${octal(cur_unit)}, CHB ${octal(cur_cyl)}/${octal(cur_head)}/${octal(cur_block)}`
  );
}

function disk_decode_addr() {
  cur_unit = (disk_da >> 28) & 0o7;
  cur_cyl = (disk_da >> 16) & 0o7777;
  cur_head = (disk_da >> 8) & 0o377;
  cur_block = disk_da & 0o377;
}

function disk_undecode_addr() {
  disk_da = ((cur_unit & 0o7) << 28) | ((cur_cyl & 0o7777) << 16) | ((cur_head & 0o377) << 8) | (cur_block & 0o377);
}

function disk_incr_block(unit: number) {
  cur_block++;
  if (cur_block >= DISKS[unit].blocks_per_track) {
    cur_block = 0;
    cur_head++;
    if (cur_head >= DISKS[unit].heads) {
      cur_head = 0;
      cur_cyl++;
    }
    // Should we error or wrap around?
  }
}

function disk_ccw(disk_fn: (vma: number, unit: number, cyl: number, head: number, block: number)) {
  let ccw = 0;
  let vma = 0;

  disk_decode_addr();
  /*
   * Process CCW's.
   */
  for (let i = 0; i < 65535; i++) {
    let ccw = read_phy_mem(disk_clp);
    if (!ccw) {
      /*
       * Huh. what to do now?
       */
      trace.error(trace.DISK, `disk: mem[clp=${octal(disk_clp)}] yielded fault (no page)`);
      return;
    }
    trace.debug(trace.DISK, `disk: mem[clp=${octal(disk_clp)}] -> ccw ${octal(ccw)}`);
    vma = ccw & ~0o377;
    disk_ma = vma;
    disk_show_cur_addr();
    disk_fn(vma, cur_unit, cur_cyl, cur_head, cur_block);
    if ((ccw & 1) == 0) {
      trace.debug(trace.DISK, "disk: last ccw");
      break;
    }
    disk_incr_block(cur_unit);
    disk_clp++;
  }
  disk_undecode_addr();
  if (disk_cmd & 0o4000) {
    disk_future_interrupt();
  }
}

function disk_start_read() {
  disk_ccw(disk_read_block);
}

function
  disk_start_read_compare() {
  trace.debug(trace.DISK, "disk_start_read_compare!");
  disk_decode_addr();
  disk_show_cur_addr();
}

function disk_start_write() {
  disk_ccw(disk_write_block);
}

function disk_start() {
  switch (disk_cmd & 0o1777) {
    case 0:
      trace.info(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} read");
      disk_start_read();
      break;
    case 0o10:
      trace.info(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} read compare");
      disk_start_read_compare();
      break;
    case 0o11:
      trace.info(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} write");
      disk_start_write();
      break;
    case 0o1005:
      trace.info(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} recalibrate");
      break;
    case 0o405:
      trace.info(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} fault clear");
      break;
    default:
      trace.warning(trace.DISK, "disk: start, cmd ${octal(disk_cmd)} unknown");
      return false;
  }
  return true;
}

export function disk_xbus_read(offset: number): number {
  switch (offset) {
    case 0o370:
      trace.info(trace.DISK, "disk: read status\n");
      return disk_status;
      break;
    case 0o371:
      trace.info(trace.DISK, "disk: read ma\n");
      return disk_ma;
      break;
    case 0o372:
      trace.info(trace.DISK, "disk: read da\n");
      return disk_da;
      break;
    case 0o373:
      trace.info(trace.DISK, "disk: read ecc\n");
      return disk_ecc;
      break;
    case 0o374:
      trace.info(trace.DISK, "disk: status read\n");
      return disk_status;
      break;
    case 0o375:
      return disk_clp;
      break;
    case 0o376:
      return disk_da;
      break;
    case 0o377:
      return 0;
      break;
    default:
      trace.warning(trace.DISK, `disk: unknown reg read ${octal(offset)}%o`);
      break;
  }
  return 0;
}

export function disk_xbus_write(offset: number, v: number): void {
  switch (offset) {
    case 0o370:
      trace.info(trace.DISK, `disk: load status ${octal(v)}`);
      break;
    case 0o374:
      disk_cmd = v;
      if ((disk_cmd & 0o6000) == 0)
        deassert_xbus_interrupt();
      trace.info(trace.DISK, `disk: load cmd ${octal(v)}`);
      break;
    case 0o375:
      trace.info(trace.DISK, `disk: load clp ${octal(v)} (phys page ${octal(v << 8)}`);
      disk_clp = v;
      break;
    case 0o376:
      disk_da = v;
      trace.info(trace.DISK, `disk: load da ${octal(v)}`);
      break;
    case 0o377:
      disk_start();
      break;
    default:
      trace.warning(trace.DISK, `disk: unknown reg write ${octal(offset)}  <- ${octal(v)}`);
      break;
  }
}

export function disk_poll(): void {
  if (disk_interrupt_delay) {
    if (--disk_interrupt_delay == 0) {
      disk_throw_interrupt();
    }
  }
}


export function disk_init(unit: number, filename: string) {
  if (unit >= DISKS_MAX) {
    trace.error(trace.USIM, `disk: only 8 disk devices are supported`);
    return -1;
  }
  trace.info(trace.USIM, `disk: opening ${filename} as unit ${unit}`);

  DISKS[unit].fd = fs.openSync(filename, "r+");
  if (DISKS[unit].fd < 0) {
    DISKS[unit].fd = 0;
    trace.error(trace.USIM, `disk: open ${filename} failed`);
    return -1;
  }
  DISKS[unit].mmsz = fs.fstatSync(DISKS[unit].fd).size;
  trace.info(trace.USIM, `disk: size: ${DISKS[unit].mmsz} bytes`);
  if (DISKS[unit].mmsz == 0) {
    trace.error(trace.USIM, `disk: ${filename} can't mmap an empty file`);
    fs.close(DISKS[unit].fd);
    DISKS[unit].fd = 0;
    return -1;
  }
  DISKS[unit].mm = mmap.map(fs.fstatSync(DISKS[unit].fd).size, mmap.PROT_WRITE, mmap.MAP_SHARED, DISKS[unit].fd);
  mmap.advise(DISKS[unit].mm, mmap.MADV_RANDOM);
  // if (DISKS[unit].mm == MAP_FAILED)
  // 	err(1, "mmap");
  const label = disk_read(unit, 0);
  if (label[0] != LABEL_LABL) {
    trace.warning(trace.USIM, `disk: invalid pack label (${octal(label[0])}) - disk image ignored`);
    fs.close(DISKS[unit].fd);
    DISKS[unit].fd = 0;
    return -1;
  }
  DISKS[unit].cyls = label[2];
  DISKS[unit].heads = label[3];
  DISKS[unit].blocks_per_track = label[4];
  trace.info(trace.USIM, `disk: image CHB ${octal(DISKS[unit].cyls)}/${octal(DISKS[unit].heads)}/${octal(DISKS[unit].blocks_per_track)}`);
  return 0;
}
