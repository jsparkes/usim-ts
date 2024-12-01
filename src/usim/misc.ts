import * as fs from 'fs';
import * as trace from './trace';

// Less typing for output
export function octal(value: number): string {
    return value.toString(8);
}

export function hex(value: number): string {
    return value.toString(16);
}

export function
    write16(fd: number, v: number): boolean {
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

export function read16le(fd: number) : number
{
    let b = new Uint8Array(2);

	let ret = fs.readSync(fd, b);
    if (ret != 2)
		trace.error(trace.ANY, `read16le: read error; ret ${ret}, size 2`);
	return (b[1] << 8) | b[0];
}

    let b = new Uint8Array(4);
export function read32le(fd: number): number
{
    let b = new Uint8Array(4);

	let ret = fs.readSync(fd, b);
	if (ret != 4)
        trace.error(trace.ANY, `read32le: read error; ret ${ret}, size 4`);
	return (b[3] << 24 | b[2] << 16 | b[1] << 8 | b[0] << 0);
}

/* read a 32 bit value in PDP-endian (1032), also called mixed-endian or middle-endian */
export function read32pdp(fd: number) : number
{
    let b = new Uint8Array(4);

	let ret = fs.readSync(fd, b);
	if (ret != 4)
        trace.error(trace.ANY, `read32pdp: read error; ret ${ret}, size 4`);
	return (b[1] << 24 | b[0] << 16 | b[3] << 8 | b[2] << 0);
}


