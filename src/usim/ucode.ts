import * as fs from 'fs';
import { disk_poll } from './disk';
import { idle_check } from './idle';
import { iob_poll } from './iob';
import { write_phy_mem } from './memory';
import * as trace from './trace';
import { tv_poll } from './tv';
import { halted, inhibit, MFMEM, p0_pc, p1, p1_pc, PROM, prom_enabled_flag, setinhibit } from './uexec';
import { sym_find_by_type_val, SymbolType } from './usym';
import { hex, octal, read16le, read32pdp } from './misc';

let cycles = 0;

let full_trace_lc = 0;
let full_trace_repeat_counter = 0;
let full_trace_last_lc = 0;

function run() {
  p1 = 0;
  p0_pc = 0;
  p1_pc = 0;
  setinhibit(false);
  write_phy_mem(0, 0);
  while (!halted) {
    if (cycles == 0) {
      p0 = p1 = 0;
      p1_pc = 0;
      setinhibit(false);)
    }
    idle_check(cycles);
    disk_poll();
    if ((cycles & 0x0ffff) == 0) {
      iob_poll();
      tv_poll();
    }
    cycles++;
    if (cycles == 0)
      cycles = 1;
    /// Move this to usim.c ...
    if (!prom_enabled_flag) {
      if (full_trace_lc > 0
        && (MFMEM[1] & 0xffffff) == full_trace_lc
        && ++full_trace_repeat_counter == 4
        && full_trace_last_lc != (MFMEM[1] & 0xffffff)) {
        trace.info(trace.ANY, `Enabling full tracing at lc #x${hex(MFMEM[1])}`);
        trace.set_trace_level('DEBUG');
        trace.set_trace_facilities([trace.UCODE, trace.MICROCODE]);
      }
      check_npc_dump();
      full_trace_last_lc = MFMEM[1];
    }
    step();
  }
}

function printlbl(type: SymbolType, loc: number) {
  let offset = 0;
  let l = sym_find_by_type_val(prom_enabled_flag ? & sym_prom : & sym_mcr, type, loc);
  if (l === "") {
    console.log(`${octal(loc)}`);
  } else {
    if (offset == 0)
      console.log(`(${l})`);
    else
      console.log(`(${l} ${octal(offset)}`);
  }
}

export function read_prom(file: string) {
  const fd = fs.openSync(file, "rb");
  if (fd < 0) {
    console.log(`failed to open file ${file}`);
    process.exit(1);
  }
  const code = read32pdp(fd);
  const start = read32pdp(fd);
  const size = read32pdp(fd);
  trace.info(trace.USIM, `prom (${file}): code: ${code}, start: ${start}, size: ${size}`);
  let loc = start;
  for (let i = 0; i < size; i++) {
    const w1 = read16le(fd);
    const w2 = read16le(fd);
    const w3 = read16le(fd);
    const w4 = read16le(fd);
    PROM[loc] = (w1 << 48) | (w2 << 32) | (w3 << 16) | (w4 << 0);
    loc++;
  }
  return 0;
}

// Mark: interrupt handling

export let interrupt_status_reg = 0;
export let interrupt_pending_flag = 0;

export function set_interrupt_status_reg(value: number) {
  interrupt_status_reg = value;
  interrupt_pending_flag = (interrupt_status_reg & 0o140000) ? 1 : 0;
}




export function trace_memory_location(
  is_read: boolean,
  vaddr: number,
  lc: number
) { }

export function restore_state(filename: string): void { }

export function assert_unibus_interrupt(vector: number): void {
  /*
   * Unibus interrupts enabled?
   */
  if (interrupt_status_reg & 0o2000) {
    trace.info(trace.INT, "assert: unibus interrupt (enabled)");
    set_interrupt_status_reg((interrupt_status_reg & ~0o1774) | 0o100000 | (vector & 0o1774));
  } else {
    trace.info(trace.INT, "assert: unibus interrupt (disabled)");
	}
}

export function deassert_unibus_interrupt(): void {
  if (interrupt_status_reg & 0o100000) {
    trace.info(trace.INT, "deassert: unibus interrupt");
    set_interrupt_status_reg(interrupt_status_reg & ~(0o1774 | 0o100000));
  }
}

