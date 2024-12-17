import { Logger, ILogObj } from "tslog";

const log: Logger<ILogObj> = new Logger();

export const ANY = "ANY";
export const DISK = "DISK";
export const IOB = "IOB";
export const INT = "INT";
export const MICROCODE = "MICROCODE";
export const MISC = "MISC";
export const TV = "TV";
export const UCODE = "UCODE";
export const UNIBUS = "UNIBUS";
export const USIM = "USIM";

export function set_trace_level(level: string) { }

export function set_trace_facilities(target: string[]) { }

export function error(flag: string, msg: string) { }

export function info(flag: string, msg: string) { }

export function warning(flags: string, msg: string) { }

export function debug(flags: string, msg: string) { }
