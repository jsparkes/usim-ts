import * as fs from 'fs';
import * as trace from './trace';

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
