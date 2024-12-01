import * as trace from './trace';
import { tv_read } from './tv';
import { AMEM } from './uexec';
import { sym_mcr } from './usim';
import { sym_find } from './usym';


export let idle_cycles = 0;
export let idle_quantum = 0;
export let idle_timeout = 0;

const IDLE_IDLE = false;
const IDLE_WORKING = true;

let working = false;
let last_work = 0;
let last_cycle = 0;
let reported_idle = false;	/*debug */
let drl = 0;
let disk_run_light: number | undefined;
let change_handler: ((flag: boolean) => void) | undefined = undefined;

let maxfd = 0;
let registered_fds = new Set<number>();

export function idle_init(): void {
    let val = sym_find(sym_mcr, "A-DISK-RUN-LIGHT");
    disk_run_light = val;
    working = true;
    reported_idle = true;
    last_cycle = 0;
}

export function
    idle_check(cycles: number) {
    last_cycle = cycles;
    if ((cycles & 0x0ffff) == 0) {
        if (!drl) {
            if (disk_run_light)
                drl = AMEM[disk_run_light];
        } else {
            let p = tv_read((drl + 2) & 0o77777);
            working = !(p === 0);
        }
    }
    if (working) {
        last_work = cycles;
        if (reported_idle) {
            reported_idle = false;
            if (change_handler)
                change_handler(IDLE_WORKING);
        }
    } else if (cycles - last_work > idle_cycles) {
        if (!reported_idle) {
            reported_idle = true;
            if (change_handler)
                change_handler(IDLE_WORKING);
        }
        if ((cycles & idle_quantum) == 0) {
            // This likely will be handled by Promise.any()
            // I need to get read promises per file descriptor?

            // int fd;
            // fd_set readset;
            // struct timeval timeout;

            // timeout.tv_sec = idle_timeout / 1000000;
            // timeout.tv_usec = idle_timeout % 1000000;
            // FD_ZERO(&readset);
            // for (int i = 0; i < FD_SETSIZE; i++) {
            // 	fd = registered_fds[i];
            // 	if (fd == 0)
            // 		break;
            // 	FD_SET(fd, &readset);
            // }
            // select(maxfd + 1, &readset, NULL, NULL, &timeout);
        }
    }
}

export function idle_register_fd(fd: number): void {
    registered_fds.add(fd);
}

export function idle_unregister_fd(fd: number): void {
    registered_fds.delete(fd);
}

export function idle_activity(): void {
    last_work = last_cycle;
}

export function register_idle_change_handler(handler: ((state: boolean) => void)): ((state: boolean) => void) | undefined {
    let old_change_handler = change_handler;
    change_handler = handler;
    return old_change_handler;
}

