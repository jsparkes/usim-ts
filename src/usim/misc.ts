import * as fs from 'fs';
import * as trace from './trace';
import { BLOCKSZ } from './disk';
import { MemoryBlock } from './memory';

export function error(level: number, msg: string): void {
    process.stderr.write(msg);
    process.stderr.write("\n");
    process.exit(level);
}

// Less typing for output
export function octal(value: number, width?: number): string {
    if (width)
        return value.toString(8).padStart(width, '0');
    else
        return value.toString(8);
}

export function hex(value: number, width?: number): string {
    if (width)
        return value.toString(16).padStart(width, '0');
    else
        return value.toString(16);
}

export function write16(fd: number, v: number): boolean {
    let b = new Uint8Array(2);

    b[0] = (v >> 0) & 0xff;
    b[1] = (v >> 8) & 0xff;
    let ret = fs.writeSync(fd, b);
    if (ret != 2) {
        trace.error(trace.ANY, `write error; ret ${ret}, size 2`);
        return false;
    }
    return true;
}

export function write32le(fd: number, v: number): boolean {
    let b = new Uint8Array(4);

    b[0] = (v >> 0) & 0xff;
    b[1] = (v >> 8) & 0xff;
    b[2] = (v >> 16) & 0xff;
    b[3] = (v >> 24) & 0xff;
    let ret = fs.writeSync(fd, b, 4);
    if (ret != 4) {
        trace.error(trace.ANY, `write error; ret ${ret}, size 4`);
        return false;
    }
    return true;
}

export function read16le(fd: number): number {
    let b = new Uint8Array(2);

    let ret = fs.readSync(fd, b);
    if (ret != 2)
        trace.error(trace.ANY, `read16le: read error; ret ${ret}, size 2`);
    return (b[1] << 8) | b[0];
}

let b = new Uint8Array(4);
export function read32le(fd: number): number {
    let b = new Uint8Array(4);

    let ret = fs.readSync(fd, b);
    if (ret != 4)
        trace.error(trace.ANY, `read32le: read error; ret ${ret}, size 4`);
    return (b[3] << 24 | b[2] << 16 | b[1] << 8 | b[0] << 0);
}

/* read a 32 bit value in PDP-endian (1032), also called mixed-endian or middle-endian */
export function read32pdp(fd: number): number {
    let b = new Uint8Array(4);

    let ret = fs.readSync(fd, b);
    if (ret != 4)
        trace.error(trace.ANY, `read32pdp: read error; ret ${ret}, size 4`);
    return (b[1] << 24 | b[0] << 16 | b[3] << 8 | b[2] << 0);
}

export function str4(s: string): number {
    return (s.charCodeAt(3) << 24) | (s.charCodeAt(2) << 16) | (s.charCodeAt(1) << 8) | s.charCodeAt(0);
}

export function unstr4(s: number): string {
    let b = "";

    b += (s & 0xff);
    b += (s >> 8) & 0xff;
    b += (s >> 16) & 0xff;
    b += (s >> 24) & 0xff;
    return b;
}

function read_block(fd: number, block_no: number): MemoryBlock | undefined {
    const offset = block_no * BLOCKSZ;
    let buffer = new MemoryBlock();
    let ret = fs.readSync(fd, buffer.buffer, 0, buffer.length, offset);
    // How to check error value?
    if (ret != buffer.length) {
        trace.error(trace.USIM, `disk read error: ret ${ret} size: ${buffer.length}`);
        return undefined;
    }
    return buffer;
}

function write_block(fd: number, block_no: number, buf: MemoryBlock): 0 | -1 {
    const offset = block_no * BLOCKSZ;
    let ret = fs.writeSync(fd, buf.buffer, 0, buf.length, offset);
    if (ret != buf.length) {
        trace.error(trace.USIM, `disk write error: ret ${ret} size: ${offset}`);
        return -1;
    }
    return 0;
}

let bnum = - 1;

export function read_virt_fd(fd: number, addr: number, addroff: number): number | undefined {
    const b = (addr & 0o77777777) / 256;
    const offset = (b + addroff) * BLOCKSZ;
    let bbuf = read_block(fd, offset);
    return bbuf?.at(addr % 256);
}

export function read_virt_string_fd(fd: number, addr: number, addroff: number): string {
    let s = "";

    let v = read_virt_fd(fd, addr, addroff);
    if (v) {
        let t = v & 0xff;
        let j = 0;
        for (let i = 0; i < t; i += 4) {
            let l = addr + 1 + (i / 4);
            v = read_virt_fd(fd, l, addroff);
            if (v) {
                s += (v >> 0) & 0xff;
                s += (v >> 8) & 0xff;
                s += (v >> 16) & 0xff;
                s += (v >> 24) & 0xff;
            }
        }
    }
    return s;
}

// This operated on uint64_t in original
function load_byte(w: number, p: number, s: number): number {
    return w >> p & ((1 << s) - 1);
}

// Also a 64 bit function
function deposit_byte(w: number, p: number, s: number, v: number): number {
    let m = ((1 << s) - 1) << p;
    return ((w & ~m) | (v << p & m));
}

export function ldb(ppss: number, w: number): number {
    return load_byte(w, ppss >> 6 & 0o77, ppss & 0o77);
}

export function dpb(v: number, ppss: number, w: number): number {
    return deposit_byte(w, ppss >> 6 & 0o77, ppss & 0o77, v);
}

export function bit_test(bits: number, word: number): boolean {
    return (bits & word) != 0;
}

export function ldb_test(ppss: number, word: number): boolean {
    return ldb(ppss, word) != 0;
}

export function dump_write_header(fd: number, type: number, size: number): void {
    write32le(fd, type);
    write32le(fd, size);
}

export function dump_write_data(fd: number, size: number, data: Uint32Array | null): void {
    let ret = 0;
    if (data === null)
        ret = fs.writeSync(fd, new Uint32Array(256), size / 4);
    else
        ret = fs.writeSync(fd, data, size / 4);
    if (ret != size)
        trace.error(trace.USIM, `write error; ret ${ret}, size ${size / 4}`);
}

export function dump_write_segment(fd: number, type: number, size: number, data: Uint32Array): void {
    dump_write_header(fd, type, size);
    dump_write_data(fd, size * 4, data);
}

export function dump_write_value(fd: number, type: number, value: number): void {
    dump_write_header(fd, type, 1);
    write32le(fd, value);
}

export function dump_find_segment(fd: number, tag: number): number {
    let t = 0;
    // lseek(fd, 4 * 2, SEEK_SET);
    let buffer = new Uint8Array(6);
    fs.readSync(fd, buffer, 0, 6, null);
    do {
        t = read32le(fd);
        let s = read32le(fd);
        if (t == tag)
            return s;
        // lseek(fd, s * 4, SEEK_CUR);
        buffer = new Uint8Array(s * 4);
        fs.readSync(fd, buffer, 0, buffer.length, null);
    } while (t != str4("EOF_"));
    return -1;
}

export function dump_read_segment_single_value(fd: number, tag: number): number {
    let size = dump_find_segment(fd, tag);
    if (size != 1) {
        trace.error(trace.USIM, `read error; failed to read segment (${unstr4(tag)})`);
    }
    return read32le(fd);
}


export class Stack<T> {
    private items: T[];
    // Private array to store stack elements

    constructor() {
        this.items = [];
        // Initialize the array as empty 
        //when a new stack is created
    }

    // Method to push an 
    // element onto the stack
    push(element: T): void {
        this
            .items.push(element);
    }

    // Method to pop an 
    // element from the stack
    pop(): T | undefined {
        return this
            .items.pop();
    }

    // Method to peek the top element
    // of the stack without removing it
    peek(): T | undefined {
        return this
            .items[this.items.length - 1];
    }

    // Method to check
    // if the stack is empty
    isEmpty(): boolean {
        return this
            .items.length === 0;
    }

    // Method to get 
    // the size of the stack
    size(): number {
        return this
            .items.length;
    }

    // Method to
    // clear the stack
    clear(): void {
        this.items = [];
    }

    // Method to print 
    // the elements of the stack
    print(): void {
        console.log(this.items);
    }
}

export class Queue<T> {
    elements: T[] = [];
    constructor(...elements: T[]) {
        // Initializing the queue with given arguments 
        this.elements = [...elements];
    }
    // Proxying the push/shift methods
    push(...args: T[]) {
        return this.elements.push(...args);
    }
    shift(): T | undefined {
        return this.elements.shift();
    }
    // Add some length utility methods
    get length() {
        return this.elements.length;
    }
}
