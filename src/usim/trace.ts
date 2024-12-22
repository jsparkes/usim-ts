import { Logger, ILogObj } from "tslog";

const log: Logger<ILogObj> = new Logger();


export const ALL = "ALL";
export const ANY = "ANY";
export const CHAOS = "CHAOS"
export const DISK = "DISK";
export const KBD = "KBD";
export const LASHUP = "LASHUP";
export const IOB = "IOB";
export const INT = "INT";
export const MACROCODE = "MACROCODE";
export const MICROCODE = "MICROCODE";
export const MISC = "MISC";
export const MOUSE = "MOUSE";
export const SPY = "SPY";
export const TV = "TV";
export const UCODE = "UCODE";
export const UNIBUS = "UNIBUS";
export const USIM = "USIM";
export const VM = "VM";
export const X11 = "X11";
export const XBUS = "XBUS";

export enum TraceLevel {
    EMERG,
    CRIT,
    ALERT,
    ERROR,
    WARNING,
    NOTICE,
    INFO,
    DEBUG,
}

export let level = TraceLevel.NOTICE;
export let facilities = new Set([USIM]);
export let stream = process.stdout;

export function set_trace_level(newLevel: TraceLevel) {
    level = newLevel;
 }

export function set_trace_facilities(target: string[]) { 
    facilities = new Set(target);
}

export function add_trace_facility(target: string): void {
    facilities.add(target);
}

export function remove_trace_facility(target: string): void {
    facilities.delete(target);
}

export function set_trace_stream(str: any) {
    stream = str;
}

export function error(flag: string, msg: string) { }

export function info(flag: string, msg: string) { }

export function warning(flags: string, msg: string) { }

export function debug(flags: string, msg: string) { }
