import { disk_xbus_read, disk_xbus_write } from "./disk";
import { iob_unibus_read, iob_unibus_write } from "./iob";
import * as trace from "./trace";
import { tv_read, tv_write, tv_xbus_read, tv_xbus_write } from "./tv";
import {
  interrupt_status_reg,
  restore_state,
  set_interrupt_status_reg,
  trace_memory_location,
} from "./ucode";
import {
  MFMEM,
  uexec
} from "./uexec";
import { warm_boot_flag } from "./usim";
import { octal } from "./misc";

export class MemoryBlock {
  readonly buffer = new Uint32Array(256); // 1024 bytes
  readonly length = this.buffer.length;
  
  constructor() { }
  at(index: number) {
    return this.buffer[index];
  }
  put(index: number, value: number): number {
    this.buffer[index] = value;
    return 0;
  }
}

export let PhysPages: Map<number, MemoryBlock>;
const phys_ram_pages = 8192; // 2 MW

export function get_page(pn: number): MemoryBlock {
  if (!PhysPages.get(pn)) {
    trace.debug(
      trace.MISC,
      `memory: get_page adding phys ram page ${octal(pn)}`
    );
    PhysPages.set(pn, new MemoryBlock());
  }
  let page = PhysPages.get(pn);
  if (!page) {
    // shut up stupid compiler
    return new MemoryBlock();
  }
  return page;
}

export function read_phy_mem(paddr: number): number | undefined {
  let pn = paddr >> 8;
  if (pn > phys_ram_pages) {
    trace.error(
      trace.MISC,
      `memory: reading memory out of range ${octal(paddr)} page ${octal(pn)}`
    );
    return undefined;
  }
  let offset = paddr & 0o377;
  let page = get_page(pn);
  if (page) return page?.at(offset);
  return undefined;
}

export function write_phy_mem(paddr: number, value: number): number {
  let pn = paddr >> 8;
  if (pn > phys_ram_pages) {
    trace.error(
      trace.MISC,
      `memory: reading memory out of range ${octal(paddr)} page ${octal(pn)}`
    );
    return -1;
  }
  let offset = paddr & 0o377;
  let page = PhysPages.get(pn);
  if (!page) {
    trace.error(
      trace.MISC,
      `memory: writing memory non-existent ${octal(paddr)} page ${octal(pn)}`
    );
    return -1;
  }
  return page.put(offset, value);
}

// L1/L2 mapping
export let l1_map = new Uint32Array(2048);
export let l2_map = new Uint32Array(1024);

export class vtop {
  addr: number = 0;
  offset: number = 0;
  map: number = 0;
  l1_map: number = 0;
}

export function map_vtop(virt: number): vtop {
  virt = virt & 0o77777777; /* 24 bit address. */
  var v: vtop = new vtop();
  /*
   * Frame buffer.
   */
  if ((virt & 0o77700000) == 0o77000000) {
    if (virt >= 0o77051757 && virt <= 0o77051763) {
      trace.debug(trace.MISC, "disk run light");
    }
    v.offset = virt & 0o377;
    // no access, no write permissions
    v.addr = (1 << 22) | (1 << 23) | 0o36000;
    return v;
  }
  /*
   * Color.
   */
  if ((virt & 0o77700000) == 0o77200000) {
    v.offset = virt & 0o377;
    // no access, no write permissions
    v.addr = (1 << 22) | (1 << 23) | 0o36000;
    return v;
  }
  /*
   * This should be moved below - I'm not sure it has to happen
   * anymore.
   */
  if ((virt & 0o77777400) == 0o77377400) {
    v.offset = virt & 0o377;
    v.addr = (1 << 22) | (1 << 23) | 0o36777;
    return v;
  }
  /*
   * 11 bit L1 index.
   */
  let l1_index = (virt >> 13) & 0o3777;
  let l1 = l1_map[l1_index] & 0o37;
  v.l1_map = l1;
  /*
   * 10 bit L2 index.
   */
  let l2_index = (l1 << 5) | ((virt >> 8) & 0o37);
  let l2 = l2_map[l2_index];
  v.offset = virt & 0o377;
  /* if(virt == 0xfbfc5c) { // 076776134 */
  /*      printf("l1_index: %x, l1: %x, l2_index: %x, l2: %x\n", l1_index, l1, l2_index, l2); */
  /* } */
  v.map = l2;
  return v;
}

// Virtual memory
export class Memory {
  write_fault_bit = 0;
  access_fault_bit = 0;;
  page_fault_flag = false;
};

export let memory = new Memory();

export function unibus_read(offset: number): number {
  switch (offset) {
    case 0o00:
      trace.info(trace.UNIBUS, "unibus: read spy: IR<15-0>\n");
      return 0;
    case 0o02:
      trace.info(trace.UNIBUS, "unibus: read spy: IR<31-16>\n");
      return 0;
    case 0o04:
      trace.info(trace.UNIBUS, "unibus: read spy: IR<47-32>\n");
      return 0;
    case 0o10:
      trace.info(trace.UNIBUS, "unibus: read spy: OPC\n");
      return 0;
    case 0o12:
      trace.info(trace.UNIBUS, "unibus: read spy: PC\n");
      return 0;
    case 0o14:
      trace.info(trace.UNIBUS, "unibus: read spy: OB<15-0>\n");
      return 0;
    case 0o16:
      trace.info(trace.UNIBUS, "unibus: read spy: OB<31-16>\n");
      return 0;
    case 0o20:
      trace.info(trace.UNIBUS, "unibus: read spy: flag register 1\n");
      return 0;
    case 0o22:
      trace.info(trace.UNIBUS, "unibus: read spy: flag register 2\n");
      return 0;
    case 0o24:
      trace.info(trace.UNIBUS, "unibus: read spy: M<15-0>\n");
      return 0;
    case 0o26:
      trace.info(trace.UNIBUS, "unibus: read spy: M<31-16>\n");
      return 0;
    case 0o30:
      trace.info(trace.UNIBUS, "unibus: read spy: A<15-0>\n");
      return 0;
    case 0o32:
      trace.info(trace.UNIBUS, "unibus: read spy: A<31-16>\n");
      return 0;
    case 0o34:
      trace.info(trace.UNIBUS, "unibus: read spy: ST<15-0>>\n");
      return 0;
    case 0o36:
      trace.info(trace.UNIBUS, "unibus: read spy: ST<31-16>\n");
      return 0;
    case 0o40:
      trace.info(trace.UNIBUS, "unibus: read interrupt status\n");
      return 0;
    case 0o44:
      trace.info(trace.UNIBUS, "unibus: read error status\n");
      return 0;
    case 0o100:
      trace.info(
        trace.UNIBUS,
        "unibus: read lashup: debugee selected address\n"
      );
      return 0;
    case 0o104:
      trace.info(trace.UNIBUS, "unibus: read lashup: debugee status info\n");
      return 0;
    default:
      return 0;
  }
}

/*
 * Read virtual memory, returns -1 on fault and 0 if OK.
 */
export function vmRead(vaddr: number): number {
  memory.access_fault_bit = 0;
  memory.write_fault_bit = 0;
  memory.page_fault_flag = false;
  /*
   * 14 bit page number.
   */
  let vtop = map_vtop(vaddr);
  let pn = vtop.map & 0o37777;
  if ((vtop.map & (1 << 23)) == 0) {
    /*
     * No access permission.
     */
    memory.access_fault_bit = 1;
    memory.page_fault_flag = true;
    uexec.OPC = pn;
    trace.error(trace.UCODE, `vmRead(vaddr=${vaddr.toString(8)}) access fault`);
    return 0;
  }
  let page = PhysPages.get(pn);
  if (pn < 0o20000 && page) {
    trace_memory_location(true, vaddr, MFMEM[1]);
    return page.at(vtop.offset);
  }
  /*
   * Simulate fixed number of RAM pages (< 2MW?).
   */
  if (pn >= phys_ram_pages && pn <= 0o35777) {
    return -1;
  }
  switch (pn) {
    case 0o36000:
      /*
       * Inhibit color probe.
       */
      if ((vaddr & 0o77700000) == 0o77200000) {
        return 0;
      }
      let offset = vaddr & 0o77777;
      return tv_read(offset);
    case 0o36777 /* Disk & TV controller on XBUS. */:
      if (vtop.offset >= 0o370) {
        /* Disk. */
        return disk_xbus_read(vtop.offset);
      }
      if (vtop.offset == 0o360) {
        /* TV. */
        return tv_xbus_read(vtop.offset);
      }
      trace.debug(
        trace.UCODE,
        `xbus read ${octal(vtop.offset)} ${octal(vaddr)}`
      );
      return 0;
    case 0o37764 /* Extra xbus devices. */:
      return iob_unibus_read(vtop.offset << 1);
    case 0o37766 /* Unibus. */:
      return unibus_read(vtop.offset);
  }
  /*
   * Page fault.
   */
  if (!page) {
    memory.page_fault_flag = true;
    uexec.OPC = pn;
    trace.error(trace.UCODE, `vmRead(vaddr=${octal(vaddr)}) page fault`);
    return 0;
  }
  trace_memory_location(true, vaddr, MFMEM[1]);
  return page.at(vtop.offset);
}

export function unibus_write(offset: number, v: number) {
  switch (offset) {
    case 0o00:
      trace.info(
        trace.UNIBUS,
        `unibus: write spy: DEBUG-IR<15-0>: ${octal(v)}`
      );
      break;
    case 0o02:
      trace.info(
        trace.UNIBUS,
        `unibus: write spy: DEBUG-IR<31-16>: ${octal(v)}`
      );
      break;
    case 0o04:
      trace.info(
        trace.UNIBUS,
        `unibus: write spy: DEBUG-IR<47-32>: ${octal(v)}`
      );
      break;
    case 0o06:
      trace.info(
        trace.UNIBUS,
        `unibus: write spy: clock control register: ${octal(v)}`
      );
      break;
    case 0o10:
      trace.info(
        trace.UNIBUS,
        `unibus: write spy: OPC control register: ${octal(v)}`
      );
      break;
    case 0o12:
      trace.info(trace.UNIBUS, `unibus: write spy: mode register: ${octal(v)}`);
      if ((v & 0o44) == 0o44) {
        trace.debug(trace.UCODE, "unibus: disabling prom enable flag");
        uexec.prom_enabled_flag = false;
        if (warm_boot_flag) restore_state(ucfg.usim_state_filename);
      }
      if (v & 2) {
        trace.debug(trace.UCODE, "unibus: normal speed");
      }
      break;
    case 0o40:
      trace.info(trace.UNIBUS, `unibus: write interrupt status ${octal(v)}`);
      set_interrupt_status_reg(
        (interrupt_status_reg & ~0o036001) | (v & 0o036001)
      );
      break;
    case 0o42:
      trace.info(trace.UNIBUS, `unibus: write interrupt stim ${octal(v)}`);
      set_interrupt_status_reg(
        (interrupt_status_reg & ~0o101774) | (v & 0o101774)
      );
      break;
    case 0o44:
      trace.info(trace.UNIBUS, `unibus: clear bus error ${octal(v)}`);
      break;
    case 0o100:
      trace.info(
        trace.UNIBUS,
        `unibus: write lashup: selected debugee address <17-31>: ${octal(v)}`
      );
      break;
    case 0o114:
      trace.info(
        trace.UNIBUS,
        `unibus: write lashup: selected debugee address <1-16>: ${octal(v)}`
      );
      break;
    case 0o110:
      trace.info(
        trace.UNIBUS,
        `unibus: write lashup: additional debugee info: ${octal(v)}`
      );
      break;
    default:
      if (offset >= 0o140 && offset <= 0o176) {
        trace.info(trace.UNIBUS, `unibus: mapping reg ${octal(offset)}`);
        break;
      }
      trace.warning(
        trace.UNIBUS,
        `unibus: write? v ${octal(v)}, offset ${octal(offset)}`
      );
      break;
  }
}

export function vmWrite(vaddr: number, v: number): number {
  trace_memory_location(false, vaddr, MFMEM[1]);

  memory.write_fault_bit = 0;
  memory.access_fault_bit = 0;
  memory.page_fault_flag = false;
  /*
   * 14 bit page number.
   */
  const vtop = map_vtop(vaddr);
  var pn = vtop.map & 0o37777;
  if ((vtop.map & (1 << 23)) == 0) {
    /*
     * No access permission.
     */
    memory.access_fault_bit = 1;
    memory.page_fault_flag = true;
    uexec.OPC = pn;
    trace.error(trace.UCODE, `vmWrite(vaddr=${octal(vaddr)}) access fault`);
    return -1;
  }
  if ((vtop.map & (1 << 22)) == 0) {
    /*
     * No write permission.
     */
    memory.write_fault_bit = 1;
    memory.page_fault_flag = true;
    uexec.OPC = pn;
    trace.error(trace.UCODE, `vmWrite(vaddr=${octal(vaddr)}) write fault`);
    return -1;
  }
  var page = get_page(pn);
  if (pn < 0.2 && page) {
    page.put(vtop.offset, v);
    return 0;
  }
  switch (pn) {
    case 0o36000:
      /*
       * Inhibit color probe.
       */
      if ((vaddr & 0o77700000) == 0o77200000) {
        return 0;
      }
      vtop.offset = vaddr & 0o77777;
      tv_write(vtop.offset, v);
      return 0;
    case 0o36777 /* Disk & TV controller on XBUS. */:
      if (vtop.offset >= 0o370) {
        disk_xbus_write(vtop.offset, v);
      }
      if (vtop.offset == 0o360) {
        tv_xbus_write(vtop.offset, v);
      }
      return 0;
    case 0o37760:
      trace.debug(
        trace.TV,
        `tv: reg write ${octal(vaddr)} offset ${octal(vtop.offset)}, v ${octal(
          v
        )}`
      );
      return 0;
    case 0o37764 /* Extra xbus devices. */:
      vtop.offset <<= 1;
      trace.debug(
        trace.UNIBUS,
        `unibus: iob v ${octal(vaddr)}, offset ${octal(vtop.offset)}`
      );
      iob_unibus_write(vtop.offset, v);
      return 0;
    case 0o37766 /* Unibus. */:
      vtop.offset <<= 1;
      unibus_write(vtop.offset, v);
      return 0;
  }
  /*
   * Catch questionable accesses.
   */
  if (pn >= 0o36000) {
    trace.warning(
      trace.UCODE,
      `??: reg write vaddr ${octal(vaddr)} pn ${pn}, offset ${octal(
        vtop.offset
      )} v ${octal(v)}`
    );
  }
  page = get_page(pn);

  // if (undefined(page)) {
  // 	/*
  // 	 * Page fault.
  // 	 */
  // 	page_fault_flag = 1;
  // 	opc = pn;
  // 	return;
  // }
  page.put(vtop.offset, v);
  return 0;
}
