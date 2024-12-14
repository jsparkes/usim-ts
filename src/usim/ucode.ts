import * as fs from 'fs';
import { disk_poll } from './disk';
import { idle_check } from './idle';
import { iob_poll } from './iob';
import { get_page, l1_map, l2_map, memory, vmRead, write_phy_mem } from './memory';
import * as trace from './trace';
import { tv_poll } from './tv';
import { AMEM, DMEM, IMEM, MFMEM, MMEM, PDL, PROM, spc, spcptr, uexec } from './uexec';
import { sym_find_by_type_val, SymbolType } from './usym';
import { dump_write_data, dump_write_header, dump_write_segment, dump_write_value, hex, octal, read16le, read32le, read32pdp, Stack, str4, write32le } from './misc';
import { sym_mcr } from './usim';

let cycles = 0;

let full_trace_lc = 0;
let full_trace_repeat_counter = 0;
let full_trace_last_lc = 0;

function run() {
  uexec.p1 = 0;
  uexec.p0_pc = 0;
  uexec.p1_pc = 0;
  uexec.inhibit = false;
  write_phy_mem(0, 0);
  while (!uexec.halted) {
    if (cycles == 0) {
      uexec.p0 = uexec.p1 = 0;
      uexec.p1_pc = 0;
      uexec.inhibit = false;
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
    if (!uexec.prom_enabled_flag) {
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
  let l = sym_find_by_type_val(uexec.prom_enabled_flag ? sym_prom : sym_mcr, type, loc);
  if (l === "") {
    process.stdout.write(`${octal(loc)}`);
  } else {
    if (offset == 0)
      process.stdout.write(`(${l})`);
    else
      process.stdout.write(`(${l} ${octal(offset)}`);
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

export function
  assert_xbus_interrupt(): void {
  trace.info(trace.INT, `ssert: xbus interrupt (${octal(interrupt_status_reg)})`);
  set_interrupt_status_reg(interrupt_status_reg | 0o40000);
}

export function
  deassert_xbus_interrupt(): void {
  if (interrupt_status_reg & 0o40000) {
    trace.info(trace.INT, "deassert: xbus interrupt");
    set_interrupt_status_reg(interrupt_status_reg & ~0o40000);
  }
}

/// Mark:

const MAX_PDL_HISTORY = 4096;

class PDLHistory {
  read_write_indexer_npc = 0;
  index = 0;
  value = 0;
  lc = 0;
}

let pdl_history = new Array<PDLHistory>(MAX_PDL_HISTORY);
let pdl_history_next = 0;

class PCHistory {
  pc = 0;
}

let MAX_PC_HISTORY = 4096;

let pc_history = new Array<PCHistory>(MAX_PC_HISTORY);
let pc_history_head = 0;

export function record_pc_history(pc: number) {
  pc_history[pc_history_head].pc = pc;
  pc_history_head = (pc_history_head + 1) % MAX_PC_HISTORY;
}

function show_pc_history(verbose: boolean): void {
  console.log("Micro PC History (OPC's), oldest first:	\n");
  let head = pc_history_head;
  for (let i = 0; i < MAX_PC_HISTORY; i++) {
    let pc = pc_history[head].pc;
    head = (head + 1) % MAX_PC_HISTORY;
    if (pc == 0)
      break;
    process.stdout.write(` ${octal(pc)}\t`);
    printlbl(SymbolType.I_MEM, pc);
    if (uexec.prom_enabled_flag)
      process.stdout.write("\t...in the PROM.");
    process.stdout.write("\n");
    if (verbose) {
      if (uexec.prom_enabled_flag)
        process.stdout.write(`\t${uinst_desc(PROM[pc], sym_prom)}`);
      else
        process.stdout.write(`\t${uinst_desc(IMEM[pc], sym_mcr)}`);
    }
  }
}


const MAX_LC_HISTORY = 20000;

class LCHistory {
  instr = 0;
  lc = 0;
};

let lc_history = Array<LCHistory>(MAX_LC_HISTORY);
let lc_history_head = 0;

function record_lc_history(): void {
  let oafb = memory.access_fault_bit;
  let owfb = memory.write_fault_bit;
  let opff = memory.page_fault_flag;
  let instr = vmRead(MFMEM[1] >> 2);
  memory.access_fault_bit = oafb;
  memory.write_fault_bit = owfb;
  memory.page_fault_flag = opff;
  lc_history[lc_history_head].instr = (MFMEM[1] & 2) ? (instr >> 16) & 0xffff : (instr & 0xffff);
  lc_history[lc_history_head].lc = MFMEM[1];
  lc_history_head = (lc_history_head + 1) % MAX_LC_HISTORY;
};

function show_lc_history(): void {
  console.log("Complete backtrace follows:\n");
  let head = lc_history_head;
  for (let i = 0; i < MAX_LC_HISTORY; i++) {
    let instr = lc_history[head].instr;
    let loc = lc_history[head].lc & 0o377777777;
    head = (head + 1) % MAX_LC_HISTORY;
    /*
     * Skip printing out obviously empty entries.
     */
    if (loc == 0 && instr == 0)
      continue;
    console.log(`${octal(loc)}`);
  }
  console.log("\n");
}

function show_spc_stack() {
  if (spcptr == 0)
    return;
  console.log("Backtrace of microcode subroutine stack:\n");
  for (let i = spcptr; i >= 0; i--) {
    let pc = spc[i] & 0o37777;
    process.stdout.write(`${octal(i)} ${octal(spc[i])} `);
    printlbl(SymbolType.I_MEM, pc);
    process.stdout.write("\n");
  }
}

function show_mmem(): void {
  process.stdout.write("M-MEM:\n");
  /* *INDENT-OFF* */
  for (let i = 0; i < 32; i += 4) {
    process.stdout.write(`\tM[${i}] ${octal(MMEM[i + 0])} ${octal(MMEM[i + 1])} ${octal(MMEM[i + 2])} ${octal(MMEM[i + 3])}\n`);
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function show_amem(): void {
  process.stdout.write("A-MEM:\n");
  /* *INDENT-OFF* */
  for (let i = 0; i < 1024; i += 4) {
    process.stdout.write(`\tA[${octal(i)}] ${octal(AMEM[i + 0])} ${octal(AMEM[i + 1])} ${octal(AMEM[i + 2])} ${octal(AMEM[i + 3])}\n`);
    let skipped = 0;
    while (
      AMEM[i + 0] == AMEM[i + 0 + 4] &&
      AMEM[i + 1] == AMEM[i + 1 + 4] &&
      AMEM[i + 2] == AMEM[i + 2 + 4] &&
      AMEM[i + 3] == AMEM[i + 3 + 4] &&
      i < 1024) {
      if (skipped == 0)
        process.stdout.write("\t...\n");
      skipped++;
      i += 4;
    }
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function show_ammem_sym(): void {
  process.stdout.write("A/M-MEMORY BY SYMBOL:\n");
  for (let i = 0; i < 1024; i++) {
    let l = sym_find_by_type_val(uexec.prom_enabled_flag ? sym_prom : sym_mcr, SymbolType.A_MEM, i);
    if (l) {
      process.stdout.write(`\t${octal(i)} ${l} ${octal(AMEM[i])}`);
      if (i < 32) {
        l = sym_find_by_type_val(uexec.prom_enabled_flag ? sym_prom : sym_mcr, SymbolType.M_MEM, i);
        if (l) {
          process.stdout.write(`  ${l} ${octal(MMEM[i])}`);
        }
      }
      process.stdout.write("\n");
    }
  }
  process.stdout.write("\n");
}

function show_spc(): void {
  process.stdout.write("SPC STACK:\n");
  process.stdout.write(`\tSPC POINTER: ${spcptr}\n`);
  /* *INDENT-OFF* */
  for (let i = 0; i < 32; i += 4) {
    process.stdout.write(`\tSPC[${octal(i, 2)}] ${octal(spc[i + 0], 11)} ${octal(spc[i + 1], 11)} ${octal(spc[i + 2], 11)} ${octal(spc[i + 3])}\n`);
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function show_pdl(): void {
  process.stdout.write("PDL MEMORY:\n");
  process.stdout.write(`\tPDL POINTER: ${octal(MFMEM[0o0014])} PDL INDEX: ${octal(MFMEM[0o0013])}\n`);
  /* *INDENT-OFF* */
  for (let i = 0; i < 1024; i += 4) {
    process.stdout.write(`\tPDL[${octal(i, 4)}] ${octal(PDL[i + 0], 11)} ${octal(PDL[i + 1], 11)} ${octal(PDL[i + 2], 11)} ${octal(PDL[i + 3], 11)}\n`);
    let skipped = 0;
    while (
      PDL[i + 0] == PDL[i + 0 + 4] &&
      PDL[i + 1] == PDL[i + 1 + 4] &&
      PDL[i + 2] == PDL[i + 2 + 4] &&
      PDL[i + 3] == PDL[i + 3 + 4] &&
      i < 1024) {
      if (skipped == 0)
        process.stdout.write("\t...\n");
      skipped++;
      i += 4;
    }
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function show_l1_map(): void {
  process.stdout.write("L1 MAP:\n");
  /* *INDENT-OFF* */
  for (let i = 0; i < 2048; i += 4) {
    process.stdout.write(`\tL1[${octal(i, 4)}] ${octal(l1_map[i + 0], 11)} ${octal(l1_map[i + 1], 11)} ${octal(l1_map[i + 2], 11)} ${octal(l1_map[i + 3], 11)}\m`);
    let skipped = 0;
    while (
      l1_map[i + 0] == l1_map[i + 0 + 4] &&
      l1_map[i + 1] == l1_map[i + 1 + 4] &&
      l1_map[i + 2] == l1_map[i + 2 + 4] &&
      l1_map[i + 3] == l1_map[i + 3 + 4] &&
      i < 2048) {
      if (skipped == 0)
        process.stdout.write("\t...\n");
      skipped++;
      i += 4;
    }
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function show_l2_map(): void {
  process.stdout.write("L2 MAP:\n");
  /* *INDENT-OFF* */
  for (let i = 0; i < 1024; i += 4) {
    process.stdout.write(`\tL2[${octal(i, 4)}] ${octal(l2_map[i + 0], 11)} ${octal(l2_map[i + 1], 11)} ${octal(l2_map[i + 2], 11)} ${octal(l2_map[i + 3], 11)}\n`);
    let skipped = 0;
    while (
      l2_map[i + 0] == l2_map[i + 0 + 4] &&
      l2_map[i + 1] == l2_map[i + 1 + 4] &&
      l2_map[i + 2] == l2_map[i + 2 + 4] &&
      l2_map[i + 3] == l2_map[i + 3 + 4] &&
      i < 1024) {
      if (skipped == 0)
        process.stdout.write("\t...\n");
      skipped++;
      i += 4;
    }
  }
  /* *INDENT-ON* */
  process.stdout.write("\n");
}

function dump_state(verbose: boolean): void {
  let pc = 0;
  /*
   * Find most recent PC.
   */
  let head = pc_history_head;
  for (let i = 0; i < MAX_PC_HISTORY; i++) {
    pc = pc_history[head].pc;
    head = (head + 1) % MAX_PC_HISTORY;
  }
  process.stdout.write("***********************************************\n");
  process.stdout.write(`PC=${octal(pc, 5)}\t`);
  printlbl(SymbolType.I_MEM, pc);
  if (uexec.prom_enabled_flag)
    process.stdout.write("\t...in the PROM.");
  process.stdout.write("\n");
  if (uexec.prom_enabled_flag)
    process.stdout.write(`IR=${uinst_desc(PROM[pc], sym_prom)}\n`);
  else
    process.stdout.write(`IR=${uinst_desc(IMEM[pc], sym_mcr)}\n`);
  show_pc_history(verbose);
  show_spc_stack();
  if (verbose) {
    show_lc_history();
    show_mmem();
    show_amem();
    show_ammem_sym();
    show_spc();
    show_pdl();
    show_l1_map();
    show_l2_map();
  }
  if (ucfg.usim_state_filename === "") {
    let fn = `usim-${ucfg.chaos_myname}.state`;
    save_state(fn.toLowerCase());
  } else {
    save_state(ucfg.usim_state_filename);
  }
  if (ucfg.usim_screenshot_filename === "") {
    let fn = `usim-${ucfg.chaos_myname}.pbm`;
    tv_screenshot(fn.toLowerCase);
  } else {
    tv_screenshot(ucfg.usim_screenshot_filename);
  }
}

const DUMP_FILE_MAGIC = str4("LMDF");
const DUMP_FILE_VERSION: number = 0x0001;
const PAGES_TO_SAVE: number = 8192;

let restored = false;

export function restore_state(fn: string): void {
  if (restored == true) {
    trace.debug(trace.USIM, "mem: state already restored\n");
    return;
  }
  restored = true;
  trace.info(trace.USIM, `usim: restoring state from ${fn}\n`);
  let fd = fs.openSync(fn, "r");
  if (fd < 0) {
    trace.warning(trace.USIM, "usim: failed to open state file\n");
    return;
  }
  let magic = read32le(fd);
  let version = read32le(fd);
  if (magic != DUMP_FILE_MAGIC) {
    trace.warning(trace.USIM, "usim: magic value in state file is not right\n");
    fs.closeSync(fd);
    return;
  }
  if (version != DUMP_FILE_VERSION) {
    trace.warning(trace.USIM, "usim: version value in state file is not right\n");
    fs.closeSync(fd);
    return;
  }
  let s = dump_find_segment(fd, "PMEM");
  if (s == -1)
    return;
  if (s != PAGES_TO_SAVE * 256) {
    trace.warning(trace.USIM, `usim: PMEM segment has incorrect size (expected ${PAGES_TO_SAVE * 256}, was ${s}`);
    fs.closeSync(fd);
    return;
  }
  for (let i = 0; i < PAGES_TO_SAVE; i++) {
    let mb = get_page(i);
    let ret = fs.readSync(fd, mb.buffer);
    if (ret < 0) {
      trace.warning(trace.USIM, `usim (restore_state): read error; ret ${ret}, size ${mb.buffer.length}`);
      fs.closeSync(fd);
      return;
    }
  }
  trace.info(trace.USIM, `usim: restored ${PAGES_TO_SAVE * 256} physical pages`);
  fs.closeSync(fd);
}

function dump_ucode_things(fd: number): void
{
	dump_write_value(fd, str4("MCPC"), pc_history[(pc_history_head - 1 + MAX_PC_HISTORY) % MAX_PC_HISTORY].pc);	/* Microcode PC */
	dump_write_value(fd, str4("USTP"), spcptr);	/* Microcode stack pointer */
	dump_write_value(fd, str4("RMD_"), MFMEM[0o30]);	/* MD register */
	dump_write_value(fd, str4("RVMA"), MFMEM[0o20]);	/* VMA register */
	dump_write_value(fd, str4("RQ__"), uexec.q);	/* Q register */
	dump_write_value(fd, str4("ROPC"), uexec.OPC);	/* OPC register */
	dump_write_value(fd, str4("ROAL"), MFMEM[0o16]);	/* OA-REG-LOW register */
	dump_write_value(fd, str4("ROAH"), MFMEM[0o17]);	/* OA-REG-HIGH register */
	dump_write_segment(fd, str4("DMEM"), DMEM.length, DMEM);	/* Dispatch memory */
	dump_write_segment(fd, str4("IMEM"), IMEM.length, DMEM);	/* Instruction memory */
	dump_write_segment(fd, str4("USTK"), spc.length, spc);	/* Microcode stack */
	dump_write_header(fd, str4("PCHL"), MAX_PC_HISTORY);	/* Microcode PC history list */
	for (let i = 0; i < MAX_PC_HISTORY; i++) {
		write32le(fd, pc_history[(pc_history_head - i - 1 + MAX_PC_HISTORY) % MAX_PC_HISTORY].pc);
	}
	dump_write_header(fd, "PDHL"), (4 * MAX_PDL_HISTORY));	/* PDL action history list */
	for (let i = 0; i < MAX_PDL_HISTORY; i++) {
		write32le(fd, pdl_history[(pdl_history_next - i - 1 + MAX_PDL_HISTORY) % MAX_PDL_HISTORY].read_write_indexer_npc);
		write32le(fd, pdl_history[(pdl_history_next - i - 1 + MAX_PDL_HISTORY) % MAX_PDL_HISTORY].index);
		write32le(fd, pdl_history[(pdl_history_next - i - 1 + MAX_PDL_HISTORY) % MAX_PDL_HISTORY].value);
		write32le(fd, pdl_history[(pdl_history_next - i - 1 + MAX_PDL_HISTORY) % MAX_PDL_HISTORY].lc);
	}
}

function save_state(fn: string): void
{
	const fd = fs.openSync(fn, "w+", 0o666);
	if (fd < 0) {
    trace.warning(trace.USIM, `usim: failed to save state file ${fn}`);
		return;
	}
  trace.info(trace.USIM, `usim: dumping state to ${fn}`);
	write32le(fd, DUMP_FILE_MAGIC);
	write32le(fd, DUMP_FILE_VERSION);
	dump_write_value(fd, str4("PDLI"), MFMEM[0o13]);	/* PDL index */
	dump_write_value(fd, str4("PDLP"), MFMEM[0o14]);	/* PDL pointer */
	dump_write_value(fd, str4("LCLV"), MFMEM[0o01]);	/* LC - last value */
	dump_write_header(fd, str4("LCHL"), MAX_LC_HISTORY);	/* LC - history list */
	for (let i = 0; i < MAX_LC_HISTORY; i++) {
		write32le(fd, lc_history[(lc_history_head - i - 1 + MAX_LC_HISTORY) % MAX_LC_HISTORY].lc);
	}
	dump_ucode_things(fd);
	dump_write_segment(fd, str4("L1MP"), sizeof(l1_map) / 4, (uint32_t *) l1_map);	/* Level 1 Memory Map */
	dump_write_segment(fd, str4("L2MP"), sizeof(l2_map) / 4, (uint32_t *) l2_map);	/* Level 2 Memory Map */
	dump_write_segment(fd, str4("PDLM"), sizeof(pdl) / 4, (uint32_t *) pdl);	/* PDL Memory */
	dump_write_segment(fd, str4("AMEM"), sizeof(amem) / 4, (uint32_t *) amem);	/* A-Memory */
	dump_write_segment(fd, str4("MMEM"), sizeof(mmem) / 4, (uint32_t *) mmem);	/* M-Memory */
	dump_write_header(fd, str4("PMEM"), PAGES_TO_SAVE * 256);	/* Physical Memory */
	for (let i = 0; i < PAGES_TO_SAVE; i++)
		dump_write_data(fd, 256 * 4, get_page(i));
	/*
	 * Dummy End-of-File marker tag.  This must be the last tag
	 * written to the file
	 */
	dump_write_header(fd, str4("EOF_"), 0);
	fs.closeSync(fd);
}


