import { map_vtop, memory, vmRead, vmWrite } from './memory';
import { hex, octal } from './misc';
import * as trace from './trace';
import { interrupt_pending_flag } from './ucode';

// I hate the short names as global! -jsparkes

// Stuff some info a class so they can be changed
// directly when imported

class UExec {
    halted = false;
    npc = 0;
    p0 = 0;
    p1 = 0;
    p0_pc = 0;
    p1_pc = 0;
    prom_enabled_flag = true;
    OPC = 0;
    q = 0;
    old_q = 0;
    interrupt_control = 0;
    inhibit = false;
};

export let uexec = new UExec();

export let PROM = Array<bigint>(512);  // Was uint64_t array
export let IMEM = new Uint32Array(16 * 1024); // was uint64_t array
export let AMEM = new Uint32Array(1024);
let aaddr = 0;
let adata = 0;

export let MMEM = new Uint32Array(32);
let maddr = 0;
let mdata = 0;

export let DMEM = new Uint32Array(2048);

export let PDL = new Uint32Array(1024);

export let spc = new Uint32Array(32);
export let spcptr = 0;

export let MFMEM = new Uint32Array(32);

/* used:
 * MFMEM[001]
 * MFMEM[000]
 * MFMEM[014]
 * MFMEM[013]
 * MFMEM[016]
 * MFMEM[017]
 * MFMEM[020]
 * MFMEM[030]
 */

let popj = 0;

let new_md = 0;
let new_md_delay = 0;

let alu_carry = 0;
let alu_out = 0;

let oal = false;
let oah = false;

let out = 0;

function ir(pos: number, len: number): number {
    return ((uexec.p0 >> pos)) & ((1 << len) - 1);
}

function pushSPC(pc: number) {
    spcptr = (spcptr + 1) & 0o37;
    spc[spcptr] = pc;
}

function popSPC(): number {
    const v = spc[spcptr];
    spcptr = (spcptr - 1) & 0o37;
    return v;
}

function lcbytemode(): number {
    if (uexec.interrupt_control & (1 << 29)) {
        const ir4 = (uexec.p0 >> 4) & 1;
        const ir3 = (uexec.p0 >> 3) & 1;
        const lc1 = (MFMEM[1] >> 1) & 1;
        const lc0 = (MFMEM[1] >> 0) & 1;
        let pos = uexec.p0 & 0o07;
        pos |= ((ir4 ^ (lc1 ^ lc0)) << 4) | ((ir3 ^ lc0) << 3);
        trace.debug(trace.MICROCODE, `byte-mode, pos ${octal(pos)}`);
        return pos;
    } else {
        const ir4 = (uexec.p0 >> 4) & 1;
        const lc1 = (MFMEM[1] >> 1) & 1;
        let pos = uexec.p0 & 0o17;
        pos |= ((ir4 ^ lc1) ? 0 : 1) << 4;
        trace.debug(trace.MICROCODE, `16b-mode, pos ${octal(pos)}`);
        return pos;
    }
    return -1;
}

/*
 * Advance the LC register, following the rules; will read next VMA if
 * needed.
 */
function
    advanceLC(ppc: number) {
    record_lc_history();
    let old_lc = MFMEM[1] & 0o377777777;	/* LC is 26 bits. */
    if (should_dump_lc(old_lc)) {
        extra_dump_state(`lc-${old_lc}`);
    }
    if (uexec.interrupt_control & (1 << 29)) {
        MFMEM[1]++;	/* Byte mode. */
    } else {
        MFMEM[1] += 2;	/* 16-bit mode. */
    }
    /*
     * NEED-FETCH?
     */
    if (MFMEM[1] & (1 << 31)) {
        MFMEM[1] &= ~(1 << 31);
        MFMEM[0o20] = old_lc >> 2;
        new_md = vmRead(old_lc >> 2);
        new_md_delay = 2;
        trace.debug(trace.UCODE, `advanceLC() read vma ${octal(old_lc)} -> ${octal(new_md)}`);
    } else {
        /*
         * Force skipping 2 instruction (PF + SET-MD).
         */
        ppc |= 2;
        trace.debug(trace.UCODE, `advanceLC() no read; md = ${octal(MFMEM[0o30])}`);
    }
    {
        /*
         * This is ugly, but follows the hardware logic (I
         * need to distill it to intent but it seems correct).
         */
        const lc0b = (uexec.interrupt_control & (1 << 29) ? 1 : 0) &	/* Byte mode. */
            ((MFMEM[1] & 1) ? 1 : 0);	/* LC0. */
        const lc1 = (MFMEM[1] & 2) ? 1 : 0;
        const last_byte_in_word = (~lc0b & ~lc1) & 1;
        trace.debug(trace.UCODE, `advanceLC() lc0b ${lc0b}, lc1 ${lc1}, last_byte_in_word ${last_byte_in_word}`);
        if (last_byte_in_word)
            /*
             * Set NEED-FETCH.
             */
            MFMEM[1] |= (1 << 31);
    }
    return ppc;
}

function mfread(addr: number): number {
    let res = 0;

    switch (addr & 0o37) {
        case 0:
            return MFMEM[0];
        case 1:
            return (spcptr << 24) | (spc[spcptr] & 0o1777777);
        case 2:
            return MFMEM[0o14] & 0o1777;
        case 3:
            return MFMEM[0o13] & 0o1777;
        case 5:
            trace.debug(trace.MICROCODE, `reading pdl[${octal(MFMEM[0o13])}] -> ${octal(PDL[MFMEM[0o13]])}`);
            let res = PDL[MFMEM[0o13]];
            trace_pdlidx_read(mdata);
            return res;
        case 6:
            return uexec.OPC;
        case 7:
            return uexec.q;
        case 0o10:
            return MFMEM[0o20];
        case 0o11:
            {			/* MEMORY-MAP-DATA */
                const l2_data = map_vtop(MFMEM[0o30]);
                return ((memory.write_fault_bit << 31) | (memory.access_fault_bit << 30) | ((l2_data.l1_map & 0o37) << 24) | (l2_data.addr & 0o77777777));
            }
        case 0o12:
            return MFMEM[0o30];
        case 0o13:
            return (uexec.interrupt_control & (1 << 29)) ? MFMEM[1] : MFMEM[1] & ~1;
        case 0o14:
            res = (spcptr << 24) | (spc[spcptr] & 0o1777777);
            trace.debug(trace.MICROCODE, `reading spc[${octal(spcptr)}] + ptr -> ${octal(mdata)}`);
            spcptr = (spcptr - 1) & 0o37;
            return res;
        case 0o15:		/* ??? */
            res = 0;
            return res;
        case 0o24:
            trace.debug(trace.MICROCODE, `reading pdl[${octal(MFMEM[0o14])}] -> ${octal(PDL[MFMEM[0o14]])}, pop`);
            res = PDL[MFMEM[0o14]];
            trace_pdlptr_pop(mdata);
            MFMEM[0o14] = (MFMEM[0o14] - 1) & 0o1777;
            return res;
        case 0o25:
            trace.debug(trace.MICROCODE, `reading pdl[${octal(MFMEM[0o14])}] -> ${octal(PDL[MFMEM[0o14]])}`);
            res = PDL[MFMEM[0o14]];
            trace_pdlptr_read(mdata);
            return res;
        case 0o26:
            res = 0; 	/* ??? */
            return res;

    }
    trace.error(trace.USIM, `unknown MF register (${octal(addr)})`);
    return 0;
}

function mfwrite(dest: number, data: number): void {
    switch (dest >> 5) {
        case 0: return;
        case 1:		/* LOCATION-COUNTER LC (location counter) 26 bits. */
            trace.debug(trace.UCODE, `writing LC <- ${octal(data)}`);
            MFMEM[1] = (MFMEM[1] & ~0o377777777) | (data & 0o377777777);
            if (uexec.interrupt_control & (1 << 29)) {
                /*
                 * ---!!! Not sure about byte mode...
                 */
            } else {
                /*
                 * In half word mode, low order bit is
                 * ignored.
                 */
                MFMEM[1] &= ~1;
            }
            /*
             * Set NEED-FETCH.
             */
            MFMEM[1] |= (1 << 31);
            return;
        case 2:		/* INTERRUPT-CONTROL Interrupt Control <29-26>. */
            trace.debug(trace.UCODE, `writing IC <- ${octal(data)}`);
            uexec.interrupt_control = data;
            if (uexec.interrupt_control & (1 << 26)) {
                trace.debug(trace.UCODE, "ic: sequence break request");
            }
            if (uexec.interrupt_control & (1 << 27)) {
                trace.debug(trace.UCODE, "ic: interrupt enable");
            }
            if (uexec.interrupt_control & (1 << 28)) {
                trace.debug(trace.UCODE, "ic: bus reset");
            }
            if (uexec.interrupt_control & (1 << 29)) {
                trace.debug(trace.UCODE, "ic: lc byte mode");
            }
            MFMEM[1] = (MFMEM[1] & ~(0o17 << 26)) |	/* Preserve flags. */
                (uexec.interrupt_control & (0o17 << 26));
            return;
        case 0o10:		/* C-PDL-BUFFER-POINTER PDL (addressed by pointer) */
            trace.debug(trace.UCODE, `writing pdl[${octal(MFMEM[0o14])}] <- ${octal(data)}`);
            trace_pdlptr_write(data);
            PDL[MFMEM[0o14]] = data;
            return;
        case 0o11:		/* C-PDL-BUFFER-POINTER-PUSH PDL (addressed by pointer, push) */
            MFMEM[0o14] = (MFMEM[0o14] + 1) & 0o1777;
            trace.debug(trace.UCODE, `writing pdl[${octal(MFMEM[0o14])}] <- ${octal(data)}, push`);
            trace_pdlptr_push(data);
            PDL[MFMEM[0o14]] = data;
            return;
        case 0o12:		/* C-PDL-BUFFER-INDEX PDL (address by index). */
            trace.debug(trace.UCODE, `writing pdl[${octal(MFMEM[0x13])}] <- ${octal(data)}`);
            PDL[MFMEM[0o13]] = data;
            trace_pdlidx_write(data);
            return;
        case 0o13:		/* PDL-BUFFER-INDEX PDL index. */
            trace.debug(trace.UCODE, `pdl-index <- ${octal(data)}`);
            MFMEM[0o13] = data & 0o1777;
            return;
        case 0o14:		/* PDL-BUFFER-POINTER PDL pointer. */
            trace.debug(trace.UCODE, `pdl-ptr <- ${octal(data)}`);
            MFMEM[0o14] = data & 0o1777;
            return;
        case 0o15:		/* MICRO-STACK-DATA-PUSH SPC data, push. */
            pushSPC(data);
            return;
        case 0o16:		/* OA-REG-LO Next instruction modifier (lo). */
            MFMEM[0o16] = data & 0o377777777;
            oal = true;
            trace.debug(trace.UCODE, `setting oa_reg lo ${octal(MFMEM[0o16])}`);
            return;
        case 0o17:		/* OA-REG-HI Next instruction modifier (hi). */
            MFMEM[0o17] = data;
            oah = true;
            trace.debug(trace.UCODE, `setting oa_reg hi ${octal(MFMEM[0o17])}`);
            return;
        case 0o20:		/* VMA VMA register (memory address). */
            MFMEM[0o20] = data;
            return;
        case 0o21:		/* VMA-START-READ VMA register, start main memory read. */
            MFMEM[0o20] = data;
            new_md = vmRead(MFMEM[0o20]);
            new_md_delay = 2;
            return;
        case 0o22:		/* VMA-START-WRITE VMA register, start main memory write. */
            MFMEM[0o20] = data;
            vmWrite(MFMEM[0o20], MFMEM[0o30]);
            return;
        case 0o23:		/* VMA-WRITE-MAP VMA register, write map. */
            MFMEM[0o20] = data;
            trace.debug(trace.UCODE, `vma-write-map md=${octal(MFMEM[0x30])}, vma=${octal(MFMEM[0o20])} (addr ${octal(MFMEM[0o30] >> 13)})`);
            mapWrite();
            return;
        case 0o30:		/* MEMORY-DATA MD register (memory data). */
            MFMEM[0o30] = data;
            trace.debug(trace.UCODE, `md<-${octal(data)}`);
            return;
        case 0o31:		/* MEMORY-DATA-START-READ */
            MFMEM[0o30] = data;
            new_md = vmRead(MFMEM[0o20]);
            new_md_delay = 2;
            return;
        case 0o32:		/* MEMORY-DATA-START-WRITE */
            MFMEM[0o30] = data;
            vmWrite(MFMEM[0o20], MFMEM[0o30]);
            return;
        case 0o33:		/* MEMORY-DATA-WRITE-MAP MD register, write map (like 23). */
            MFMEM[0o30] = data;
            trace.debug(trace.UCODE, `memory-data-write-map md=${octal(MFMEM[0o30])}, vma=${MFMEM[0o20]} (addr ${octal(MFMEM[0o30] >> 13)}`);
            mapWrite();
            return;
    }
    trace.error(trace.USIM, `unknown MF register (${octal(dest)}) write (${octal(data)})`);
}

/*
 * Write value to decoded destination.
 */
function writeDest(dest: number): void {
    if (dest & 0o4000) {
        AMEM[dest & 0o3777] = out;
        return;
    }
    mfwrite(dest, out);
    MMEM[dest & 0o37] = AMEM[dest & 0o37] = out;
}

// ALU
function qControl(): void {
    uexec.old_q = uexec.q;
    switch (ir(0, 2)) {
        case 1:
            trace.debug(trace.MICROCODE, "q<<");
            uexec.q <<= 1;
            /*
             * Inverse of ALU sign.
             */
            if ((alu_out & 0x80000000) == 0)
                uexec.q |= 1;
            break;
        case 2:
            trace.debug(trace.MICROCODE, "q>>");
            uexec.q >>= 1;
            if (alu_out & 1)
                uexec.q |= 0x80000000;
            break;
        case 3:
            trace.debug(trace.MICROCODE, "q<-alu");
            uexec.q = alu_out;
            break;
    }
}

function outControl(): void {
    switch ((uexec.p0 >> 12) & 3) {
        case 0:
            trace.warning(trace.MICROCODE, "out == 0!");
            out = rol32(mdata, uexec.p0 & 0o37);
            break;
        case 1:
            out = alu_out;
            break;
        case 2:
            /*
             * "ALU output shifted right one, with
             * the correct sign shifted in,
             * regardless of overflow."
             */
            out = (alu_out >> 1) | (alu_carry ? 0x80000000 : 0);
            break;
        case 3:
            out = (alu_out << 1) | ((uexec.old_q & 0x80000000) ? 1 : 0);
            break;
    }
}

function arithOps(op: number): void {
    let cin = ir(2, 1);

    let lv = 0;

    switch (op) {
        case 0o20:
            alu_out = cin ? 0 : -1;
            alu_carry = 0;
            break;
        case 0o21:
            lv = (mdata & adata) - (cin ? 0 : 1);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o22:
            lv = (mdata & ~adata) - (cin ? 0 : 1);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o23:
            lv = mdata - (cin ? 0 : 1);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o24:
            lv = (mdata | ~adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o25:
            lv = (mdata | ~adata) + (mdata & adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o26:		/* [M-A-1] [SUB] */
            sub32(mdata, adata, cin, alu_out, alu_carry);
            break;
        case 0o27:
            lv = (mdata | ~adata) + mdata + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o30:
            lv = (mdata | adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o31:		/* [ADD] [M+A+1] */
            add32(mdata, adata, cin, alu_out, alu_carry);
            break;
        case 0o32:
            lv = (mdata | adata) + (mdata & ~adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o33:
            lv = (mdata | adata) + mdata + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o34:		/* [M+1] */
            alu_out = mdata + (cin ? 1 : 0);
            alu_carry = 0;
            if (mdata == 0xffffffff && cin)
                alu_carry = 1;
            break;
        case 0o35:
            lv = mdata + (mdata & adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o36:
            lv = mdata + (mdata | ~adata) + (cin ? 1 : 0);
            alu_out = lv;
            alu_carry = (lv >> 32) ? 1 : 0;
            break;
        case 0o37:		/* [M+M] [M+M+1] */
            add32(mdata, mdata, cin, alu_out, alu_carry);
            break;
    }
}

function logiOps(op: number): void {
    switch (op) {
        case 0o00:
            alu_out = 0;
            break;
        case 0o01:
            alu_out = mdata & adata;
            break;
        case 0o02:
            alu_out = mdata & ~adata;
            break;
        case 0o03:
            alu_out = mdata;
            break;
        case 0o04:
            alu_out = ~mdata & adata;
            break;
        case 0o05:
            alu_out = adata;
            break;
        case 0o06:
            alu_out = mdata ^ adata;
            break;
        case 0o07:
            alu_out = mdata | adata;
            break;
        case 0o10:
            alu_out = ~adata & ~mdata;
            break;
        case 0o11:
            if (adata == mdata)
                alu_out = 1;
            else
                alu_out = 0;
            break;
        case 0o12:
            alu_out = ~adata;
            break;
        case 0o13:
            alu_out = mdata | ~adata;
            break;
        case 0o14:
            alu_out = ~mdata;
            break;
        case 0o15:
            alu_out = ~mdata | adata;
            break;
        case 0o16:
            alu_out = ~mdata | ~adata;
            break;
        case 0o17:
            alu_out = ~0;
            break;
    }
}

function divOps(op: number): void {
    const cin = ir(2, 1);

    switch (op) {
        case 0o40:		// Multiply step.
            if (uexec.q & 1) {
                qadd32(adata, mdata, cin, alu_out, alu_carry);
            } else {
                alu_out = mdata;
                alu_carry = alu_out & 0x80000000 ? 1 : 0;
            }
            break;
        case 0o41:		// Divide step.
            if (uexec.q & 1) {
                sub32(mdata, abs32(adata), !cin, alu_out, alu_carry);
            } else {
                add32(mdata, abs32(adata), cin, alu_out, alu_carry);
            }
            break;
        case 0o45:		// Remainder correction.
            if (uexec.q & 1) {
                alu_carry = 0;
            } else {
                add32(alu_out, abs32(adata), cin, alu_out, alu_carry);
            }
            break;
        case 0o51:		// Initial divide step.
            trace.debug(trace.MICROCODE, "divide-first-step");
            trace.debug(trace.MICROCODE, `divide: ${octal(uexec.q)} / ${octal(adata)}`);
            sub32(mdata, abs32(adata), !cin, alu_out, alu_carry);
            trace.debug(trace.MICROCODE, `alu_out ${hex(alu_out)} ${octal(alu_out)} ${alu_out}`);
            break;
    }
}

function alu(): void {
    const aluop = (uexec.p0 >> 3) & 0o77;
    const dest = ir(14, 12);

    alu_carry = 0;
    switch (aluop) {
        case 0o00:
        case 0o01:
        case 0o02:
        case 0o03:
        case 0o04:
        case 0o05:
        case 0o06:
        case 0o07:
        case 0o10:
        case 0o11:
        case 0o12:
        case 0o13:
        case 0o14:
        case 0o15:
        case 0o16:
        case 0o17:
            logiOps(aluop);
            break;
        case 0o20:
        case 0o21:
        case 0o22:
        case 0o23:
        case 0o24:
        case 0o25:
        case 0o26:
        case 0o27:
        case 0o30:
        case 0o31:
        case 0o32:
        case 0o33:
        case 0o34:
        case 0o35:
        case 0o36:
        case 0o37:
            arithOps(aluop);
            break;
        case 0o40:
        case 0o41:
        case 0o45:
        case 0o51:
            divOps(aluop);
            break;
    }
    qControl();
    outControl();
    writeDest(dest);
    trace.debug(trace.MICROCODE, `alu_out ${hex(alu_out)} alu_carry ${alu_carry}  q ${hex(uexec.q)}`);
}

// dispatch

function dsp() {
    let pos = ir(0, 5);
    let len = ir(5, 3);
    let map = ir(8, 2);
    let disp_addr = ir(12, 11);
    let n_plus1 = ir(25, 1);
    let enable_ish = ir(24, 1);
    let disp_const = ir(32, 10);

    let mask = 0;

    let r = 0;
    let p = 0;
    let n = 0;
    let target = 0;

    if (ir(10, 2) == 2) {
        trace.debug(trace.MICROCODE, `dmem[${octal(disp_addr)} <- ${octal(adata)}`);
        DMEM[disp_addr] = adata;
        return;
    }
    if (ir(10, 2) == 3)
        pos = lcbytemode();
    trace.debug(trace.MICROCODE, `m-src ${octal(mdata)}`);
    /*
     * Rotate M-SOURCE.
     */
    mdata = rol32(mdata, pos);
    /*
     * Generate mask.
     */
    {
        const left_mask_index = (len - 1) & 0o37;
        mask = ~0;
        mask >>= 31 - left_mask_index;
        if (len == 0)
            mask = 0;
    }
    /*
     * Put LDB into DISPATCH-ADDR.
     */
    disp_addr |= mdata & mask;
    trace.debug(trace.MICROCODE, `rotated ${octal(mdata)} mask ${octal(mask)}, result ${octal(mdata & mask)}`);
    /*
     * Tweak DISPATCH-ADDR with L2 map bits.
     */
    if (map) {
        let l2_map_bits = map_vtop(MFMEM[0o30]);
        let bit19 = ((l2_map_bits.addr >> 19) & 1) ? 1 : 0;
        let bit18 = ((l2_map_bits.addr >> 18) & 1) ? 1 : 0;
        trace.debug(trace.MICROCODE, `md ${octal(MFMEM[0o30])}, l2_map_bits ${octal(l2_map_bits.addr)}, b19 ${octal(bit19)}, b18 ${octal(bit18)}`);
        switch (map) {
            case 1:
                disp_addr |= bit18;
                break;
            case 2:
                disp_addr |= bit19;
                break;
            case 3:
                disp_addr |= bit18 | bit19;
                break;
        }
    }
    disp_addr &= 0o3777;
    trace.debug(trace.MICROCODE, `dispatch[${octal(disp_addr)}] -> ${octal(DMEM[disp_addr])}`);
    disp_addr = DMEM[disp_addr];
    MFMEM[0] = disp_const;
    target = disp_addr & 0o37777;	/* 14 bits. */
    n = (disp_addr >> 14) & 1;
    p = (disp_addr >> 15) & 1;
    r = (disp_addr >> 16) & 1;
    trace.debug(trace.MICROCODE, `${n ? "N " : ""}${p ? "P " : ""}${r ? "R " : ""}`);
    if (n_plus1 && n) {
        uexec.npc--;
    }
    /*
     * Enable instruction sequence hardware.
     */
    if (enable_ish) {
        trace.debug(trace.UCODE, "advancing LC due to DISPATCH");
        advanceLC(0);
    }
    if (n)
        uexec.inhibit = true;
    if (p && r)
        return;
    if (p) {
        if (!n)
            pushSPC(uexec.npc);
        else
            pushSPC(uexec.npc - 1);
    }
    if (r) {
        target = popSPC();
        if ((target >> 14) & 1) {
            trace.debug(trace.UCODE, "advancing LC due to microcode stack bit 14");
            target = advanceLC(target);
        }
        target &= 0o37777;
    }
    uexec.npc = target;
    popj = 0;
}

function jcond(): boolean {
    if (ir(5, 1) == 0) {
        let rot = ir(0, 5);

        trace.debug(trace.MICROCODE, `jump-if-bit; rot ${octal(rot)}, before ${octal(mdata)}`);
        mdata = rol32(mdata, rot);
        trace.debug(trace.MICROCODE, `after ${octal(mdata)}`);
        return (mdata & 1) === 1;
    }
    // Internal condition.
    switch (ir(0, 4)) {
        case 0:		/* illegal ??? */
            break;
        case 1:
            return mdata < adata;
        case 2:
            return mdata <= adata;
        case 3:
            return mdata == adata;
        case 4:
            return memory.page_fault_flag;	/* vmaok */
        case 5:
            trace.debug(trace.MICROCODE, "jump i|pf\n");	/* pgf.or.int */
            return memory.page_fault_flag || (uexec.interrupt_control & (1 << 27) ? interrupt_pending_flag === 1 : false);

        case 6:
            trace.debug(trace.MICROCODE, "jump i|pf|sb\n");	/* pgf.or.int.sb */
            return memory.page_fault_flag || (uexec.interrupt_control & (1 << 27) ? interrupt_pending_flag === 1 : false) || (uexec.interrupt_control & (1 << 26)) === 1;
        case 7:
            return true;
    }
    trace.error(trace.MICROCODE, `unknown jump (%${octal(ir(0, 4))}`);
    return false;
}

function jmp() {
    let target = ir(12, 14);
    let r = ir(9, 1);
    let p = ir(8, 1);
    let n = ir(7, 1);
    let invert_sense = ir(6, 1);

    trace.debug(trace.MICROCODE, `a=${octal(aaddr)} (${octal(adata)}), m=${octal(maddr)} (${octal(mdata)})`);
    if (ir(10, 2) == 1) {
        trace.debug(trace.MICROCODE, "halted");
        uexec.halted = true;
        return;
    }
    if (ir(10, 2) == 3) {
        trace.warning(trace.MICROCODE, "jump w/misc-3!");
    }
    /*
     * P & R & jump-inst -> write ucode.
     */
    if (p && r) {
        let w = ((adata & 0o177777) << 32) | mdata;
        trace.debug(trace.MICROCODE, `u-code write; ${octal(w)} @ ${octal(target)}`);
        IMEM[target] = w;
        return;
    }
    /*
     * Jump condition.
     */
    let cond = jcond();
    if (invert_sense)
        cond = !cond;
    if (p && cond) {
        if (!n)
            pushSPC(uexec.npc);
        else
            pushSPC(uexec.npc - 1);
    }
    if (r && cond) {
        target = popSPC();
        if ((target >> 14) & 1) {
            trace.debug(trace.UCODE, "advancing LC due to microcode stack bit 14");
            target = advanceLC(target);
        }
        target &= 0o37777;
    }
    if (cond) {
        if (n)
            uexec.inhibit = true;
        uexec.npc = target;
        /*
         * inhibit possible POPJ.
         */
        popj = 0;
    }
}

// Mark: Byte

function msk(pos: number): number {
    const widthm1 = ir(5, 5);

    let right_mask_index = pos;
    let left_mask_index = (right_mask_index + widthm1) & 0o37;	/* mod 32? */
    let left_mask = ~0;
    let right_mask = ~0;
    left_mask >>= 31 - left_mask_index;
    right_mask <<= right_mask_index;

    //DEBUG(TRACE_MICROCODE, "widthm1 %o, pos %o, mr_sr_bits %o\n", widthm1, pos, mr_sr_bits);
    trace.debug(trace.MICROCODE, `left_mask_index ${octal(left_mask_index)}, right_mask_index ${octal(right_mask_index)}`);
    trace.debug(trace.MICROCODE, `left_mask ${octal(left_mask)}, right_mask ${octal(right_mask)}, mask ${octal(left_mask & right_mask)}}`);
    return left_mask & right_mask;
}

function byt() {
    let dest = ir(14, 12);
    let mr_sr_bits = ir(12, 2);
    let pos = ir(0, 5);	// p0 & 037;

    trace.debug(trace.MICROCODE, `a=${octal(aaddr)} (${octal(adata)}), m=${octal(maddr)} (${octal(mdata)}), dest=${octal(dest)}`);

    if (ir(10, 2) == 3)
        pos = lcbytemode();
    let mask = msk(mr_sr_bits & 2 ? pos : 0);
    switch (mr_sr_bits) {
        case 0:
            trace.warning(trace.MICROCODE, "mr_sr_bits == 0!");
            out = 0;
            break;
        case 1:
            trace.debug(trace.MICROCODE, `ldb; m ${octal(mdata)}`);
            mdata = rol32(mdata, pos);
            out = (mdata & mask) | (adata & ~mask);
            trace.debug(trace.MICROCODE, `ldb; m-rot ${octal(mdata)}, mask ${octal(mask)}, result ${octal(out)}`);
            break;
        case 2:
            out = (mdata & mask) | (adata & ~mask);
            trace.debug(trace.MICROCODE, `sel-dep; a ${octal(adata)}, m ${octal(mdata)}, mask ${octal(mask)} -> ${octal(out)}`);
            break;
        case 3:
            trace.debug(trace.MICROCODE, `dpb; m ${octal(mdata)}, pos ${octal(pos)}`);
            mdata = rol32(mdata, pos);
            out = (mdata & mask) | (adata & ~mask);
            trace.debug(trace.MICROCODE, `dpb; mask ${octal(mask)}, result ${octal(out)}`);
            break;
    }
    writeDest(dest);
}

// Mark: step

function incNPC() {
    /*
     * Fetch next instruction from PROM or RAM.
     */
    // #define FETCH() (prom_enabled_flag ? prom[npc] : imem[npc])
    /*
     * CPU pipeline.
     */
    uexec.p0 = uexec.p1;
    uexec.p0_pc = uexec.p1_pc;
    // p1 = FETCH();
    uexec.p1 = uexec.prom_enabled_flag ? PROM[uexec.npc] : IMEM[uexec.npc];
    uexec.p1_pc = uexec.npc;
    uexec.npc++;
}

function step() {
    let op = 0;

    incNPC();
    if (new_md_delay) {
        new_md_delay--;
        if (new_md_delay == 0)
            MFMEM[0o30] = new_md;
    }
    if (uexec.inhibit == true) {
        trace.debug(trace.MICROCODE, `inhibit; npc ${octal(uexec.npc)}`);
        uexec.inhibit = false;
        incNPC();
    }
    if (oal == true) {
        trace.debug(trace.MICROCODE, `merging oa lo ${octal(MFMEM[0o16])}`);
        oal = false;
        uexec.p0 |= MFMEM[0o16];
    }
    if (oah == true) {
        trace.debug(trace.MICROCODE, `merging oa hi ${octal(MFMEM[0o17])}`);
        oah = false;
        uexec.p0 |= MFMEM[0o17] << 26;
    }
    trace_ucode();
    record_pc_history(uexec.p0_pc);
    popj = ir(42, 1);
    aaddr = ir(32, 10);
    maddr = ir(26, 5);
    adata = AMEM[aaddr];
    mdata = (ir(31, 1) == 0) ? MMEM[maddr] : mfread(maddr);
    op = ir(43, 2);
    switch (op) {
        case 0:
            alu();
            break;
        case 1:
            jmp();
            break;
        case 2:
            dsp();
            break;
        case 3:
            byt();
            break;
    }
    if (popj) {
        trace.debug(trace.MICROCODE, "popj; ");
        let old_npc = uexec.npc;
        uexec.npc = popSPC();
        if ((uexec.npc >> 14) & 1) {
            uexec.npc = advanceLC(uexec.npc);
            trace.debug(trace.UCODE, `advancing LC due to POPJ (old npc = ${(hex(old_npc))}, new npc = ${hex(uexec.npc)})`);
        }
        uexec.npc &= 0o37777;
    }
}

function rol32(value: number, bitstorotate: number): number {
    let mask = 0;

    /*
     * Determine which bits will be impacted by the rotate.
     */
    if (bitstorotate == 0)
        mask = 0;
    else
        mask = 0x80000000 >> bitstorotate;
    /*
     * Save off the affected bits.
     */
    let tmp = (value & mask) >> (32 - bitstorotate);
    /*
     * Perform the actual rotate, and add the rotated bits back in
     * (in the proper location).
     */
    return (value << bitstorotate) | tmp;
}

