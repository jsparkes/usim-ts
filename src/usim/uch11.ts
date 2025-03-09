import { tracingChannel } from 'diagnostics_channel';
import * as trace from './trace';
import * as net from 'net';
import { assert_unibus_interrupt } from './ucode';
import { CHAOS } from './trace';
import { octal, Queue } from './misc';
import { cfg, ucfg } from './ucfg';
import { ConfigIniParser } from 'config-ini-parser';
import { Mutex } from 'async-mutex';


export enum UCH11_BACKEND {
	DAEMON = 'daemon',
	LOCAL = 'local',
	UDP = 'udp'
}

export const CHAOS_CSR_TIMER_INTERRUPT_ENABLE = (0o1 << 0o0); /* CHBUSY */
export const CHAOS_CSR_LOOP_BACK = (0o1 << 0o1);       /* CHLPBK */
export const CHAOS_CSR_RECEIVE_ALL = (0o1 << 0o2);	       /* CHSPY */
export const CHAOS_CSR_RECEIVER_CLEAR = (0o1 << 0o3);
export const CHAOS_CSR_RECEIVE_ENABLE = (0o1 << 0o4);	/* CHREN */
export const CHAOS_CSR_TRANSMIT_ENABLE = (0o1 << 0o5);	/* CHRIEN */
export const CHAOS_CSR_INTERRUPT_ENABLES = (0o2 << 0o4);
export const CHAOS_CSR_TRANSMIT_ABORT = (0o1 << 0o6);	   /* CHABRT */
export const CHAOS_CSR_TRANSMIT_DONE = (0o1 << 0o7);	   /* CHTDN */
export const CHAOS_CSR_TRANSMITTER_CLEAR = (0o1 << 0o10); /* CHTCLR */
export const CHAOS_CSR_LOST_COUNT = (0o4 << 0o11);	   /* CHLC */
export const CHAOS_CSR_RESET = (0o1 << 0o15);		   /* CHRST */
export const CHAOS_CSR_CRC_ERROR = (0o1 << 0o16);	   /* CHCRC */
export const CHAOS_CSR_RECEIVE_DONE = (0o1 << 0o17);	   /* CHRDN */

export class ChaosNet {
	backend = UCH11_BACKEND.LOCAL;
	myaddr = 0o177040; // local-cadr
	serveraddr = 0o177001; // local-bridge
	hybrid_udp_and_local = 0;
	csr = CHAOS_CSR_RESET;
	// Common to backends
	send: (buffer: Uint16Array, count: number) => boolean = chaos_send_to_local;
	bit_count = 0;
	lost_count = 0;
	const xmit_buffer = new Uint16Array(4096);
	xmit_buffer_size = 0;
	xmit_buffer_ptr = 0;
	const rcv_buffer = new Uint16Array(4096);
	const rcv_buffer_toss = new Uint16Array(4096);
	rcv_buffer_ptr = 0;
	rcv_buffer_size = 0;
	rcv_buffer_empty = false;
	reconnect_chaos = false;
	reconnect_delay = 0;
	// Backend variables
	chaosd_fd: net.Socket | undefined;
	recv_queue = new Queue<number>;
	const recv_mutex = new Mutex();
				
};

export const uch11 = new ChaosNet();

/*
 * RFC1071: Compute Internet Checksum for COUNT bytes beginning at
 * location ADDR.
 */
function uch11_checksum(buffer: Uint16Array, count: number): number {
	let sum = 0;
	let i = 0;
	while (count > 1) {
		let b1 = buffer.at(i) ?? 0;
		sum += ((buffer.at(i) ?? 0) << 8) | (buffer.at(i + 1) ?? 0)ß;
		i += 2;
		count -= 2;
	}
	/*
	 * Add left-over byte, if any.
	 */
	if (count > 0)
		sum += buffer.at(i) ?? 0;
	/*
	 * Fold 32-bit sum to 16 bits.
	 */
	while (sum >> 16)
		sum = (sum & 0xffff) + (sum >> 16);
	return (~sum) & 0xffff;
}

/*
 * Called when we are we have something in uch11.rcv_buffer.
 */
export function uch11_rx_pkt(): void {
	uch11.rcv_buffer_ptr = 0;
	uch11.bit_count = (uch11.rcv_buffer_size * 2 * 8) - 1;
	trace.info(trace.CHAOS, `chaos: receiving ${uch11.rcv_buffer_size} words`);
	if (uch11.rcv_buffer_size > 0) {
		trace.debug(trace.CHAOS, `chaos: set csr receive done, generate interrupt`);
		uch11.csr |= CHAOS_CSR_RECEIVE_DONE;
		if (uch11.csr & CHAOS_CSR_RECEIVE_ENABLE)
			assert_unibus_interrupt(0o270);
	} else {
		trace.debug(trace.CHAOS, `chaos: receive buffer empty`);
	}
}

function uch11_xmit_done_intr(): void {
	uch11.csr |= CHAOS_CSR_TRANSMIT_DONE;
	if (uch11.csr & CHAOS_CSR_TRANSMIT_ENABLE)
		assert_unibus_interrupt(0o270);
}

function uch11_xmit_pkt(): void {
	trace.info(trace.CHAOS, `chaos: transmitting ${uch11.xmit_buffer_ptr * 2} bytes, data len ${(uch11.xmit_buffer_ptr > 0 ? uch11.xmit_buffer[1] & 0x3f : -1)}`);
	uch11.xmit_buffer_size = uch11.xmit_buffer_ptr;
	/*
	 * Dest. is already in the buffer.
	 */
	uch11.xmit_buffer[uch11.xmit_buffer_size++] = uch11.myaddr;	/* Source. */
	uch11.xmit_buffer[uch11.xmit_buffer_size] = uch11_checksum(uch11.xmit_buffer, uch11.xmit_buffer_size * 2);	/* Checksum. */
	uch11.xmit_buffer_size++;
	uch11.send(uch11.xmit_buffer, uch11.xmit_buffer_size * 2);
	uch11.xmit_buffer_ptr = 0;
	uch11_xmit_done_intr();
}

function uch11_get_bit_count(): number {
	if (uch11.rcv_buffer_size > 0)
		return uch11.bit_count;
	trace.debug(trace.CHAOS, `chaos: returned empty bit count`);
	return 0o7777;
}

function uch11_get_rcv_buffer(): number {
	if (uch11.rcv_buffer_ptr < uch11.rcv_buffer_size) {
		const ret = uch11.rcv_buffer[uch11.rcv_buffer_ptr++];
		if (uch11.rcv_buffer_ptr == uch11.rcv_buffer_size) {
			trace.debug(trace.CHAOS, `chaos: marked recieve buffer as empty`);
			uch11.rcv_buffer_empty = true;
		}
		return ret;
	}
	/*
	 * Read last word, clear receive done.
	 */
	trace.debug(trace.CHAOS, "chaos: cleared csr receive done");
	uch11.csr &= ~CHAOS_CSR_RECEIVE_DONE;
	uch11.rcv_buffer_size = 0;
	return 0;
}

function uch11_put_xmit_buffer(v: number): void {
	if (uch11.xmit_buffer_ptr < (uch11.xmit_buffer.length / 2))
		uch11.xmit_buffer[uch11.xmit_buffer_ptr++] = v;
	uch11.csr &= ~CHAOS_CSR_TRANSMIT_DONE;
}

// Originally static in following function
let old_csr = 0;

function uch11_get_csr(): number {
	if (uch11.csr != old_csr) {
		trace.debug(trace.CHAOS, `chaos: read csr ${octal(uch11.csr)}`);
		old_csr = uch11.csr;
	}
	return uch11.csr | ((uch11.lost_count << 9) & 0o17);
}

export function uch11_set_csr(v: number): void {
	let old_csr = uch11.csr;
	v &= 0xffff;
	/*
	 * Writing these don't stick.
	 */
	/* *INDENT-OFF* */
	let mask =
		CHAOS_CSR_TRANSMIT_DONE |
		CHAOS_CSR_LOST_COUNT |
		CHAOS_CSR_CRC_ERROR |
		CHAOS_CSR_RECEIVE_DONE |
		CHAOS_CSR_RECEIVER_CLEAR;
	/* *INDENT-ON* */
	uch11.csr = (uch11.csr & mask) | (v & ~mask);
	if (uch11.csr & CHAOS_CSR_RESET) {
		uch11.rcv_buffer_ptr = 0;
		uch11.rcv_buffer_size = 0;
		uch11.xmit_buffer_ptr = 0;
		uch11.lost_count = 0;
		uch11.bit_count = 0;
		uch11.csr &= ~(CHAOS_CSR_RESET | CHAOS_CSR_RECEIVE_DONE);
		uch11.csr |= CHAOS_CSR_TRANSMIT_DONE;
		reconnect_delay = 200;	/* Do it right away. */
		uch11_force_reconnect();
	}
	if (v & CHAOS_CSR_RECEIVER_CLEAR) {
		uch11.rcv_buffer_ptr = 0;
		uch11.rcv_buffer_size = 0;
		uch11.lost_count = 0;
		uch11.bit_count = 0;
		uch11.csr &= ~CHAOS_CSR_RECEIVE_DONE;
	}
	if (v & (CHAOS_CSR_TRANSMITTER_CLEAR | CHAOS_CSR_TRANSMIT_DONE)) {
		uch11.xmit_buffer_ptr = 0;
		uch11.csr &= ~CHAOS_CSR_TRANSMIT_ABORT;
		uch11.csr |= CHAOS_CSR_TRANSMIT_DONE;
	}
	if (uch11.csr & CHAOS_CSR_RECEIVE_ENABLE) {
		if ((old_csr & CHAOS_CSR_RECEIVE_ENABLE) == 0)
			trace.debug(trace.CHAOS, "chaos: CSR receive enable");
		if (uch11.rcv_buffer_empty) {
			uch11.rcv_buffer_ptr = 0;
			uch11.rcv_buffer_size = 0;
		}
		/*
		 * If buffer is full, generate status and interrupt again.
		 */
		if (uch11.rcv_buffer_size > 0) {
			trace.debug(trace.CHAOS, `chaos: rx-enabled and buffer is full`);
			uch11_rx_pkt();
		}
	} else if (old_csr & CHAOS_CSR_RECEIVE_ENABLE)
		trace.debug(trace.CHAOS, "chaos: CSR receive DISable");
	if (uch11.csr & CHAOS_CSR_TRANSMIT_ENABLE) {
		if ((old_csr & CHAOS_CSR_TRANSMIT_ENABLE) == 0)
			trace.debug(trace.CHAOS, `chaos: CSR transmit enable`);
		uch11.csr |= CHAOS_CSR_TRANSMIT_DONE;
	} else if (old_csr & CHAOS_CSR_TRANSMIT_ENABLE)
		trace.debug(trace.CHAOS, `chaos: CSR transmit DISable`);
	trace.debug(trace.CHAOS, `chaos: set csr bits 0${octal(v)}, old 0${octal(old_csr)}, new 0${octal(uch11_csr)}`);
}

export function uch11_poll() {
	if (uch11.backend == UCH11_BACKEND.LOCAL)
		chaos_poll_local();
	else if (uch11.backend == UCH11_BACKEND.DAEMON)
		chaos_poll_chaosd();
	else if (uch11.backend == UCH11_BACKEND.UDP)
		chaos_poll_udp();
}

function uch11_force_reconnect(): void {
	if (uch11.backend == UCH11_BACKEND.DAEMON) {
		trace.warning(trace.CHAOS, "chaos: forcing reconnect to chaosd");
		uch11.chaosd_fd?.destroySoon();
		uch11.reconnect_chaos = true;
	}
}

// Was static in the following function
let reconnect_time = 0;

function uch11_reconnect(): void {
	if (++uch11.reconnect_delay < 200)
		return;
	uch11.reconnect_delay = 0;
	if (reconnect_time && Date.now() < (reconnect_time + 5000))	/* Try every 5 seconds. */
		return;
	reconnect_time = Date.now();
	trace.notice(trace.CHAOS, `chaos: reconnecting to chaosd`);
	if (uch11_init(cfg) == 0) {
		trace.info(trace.CHAOS, "chaos: chaosd reconnected");
		uch11.reconnect_chaos = false;
		uch11.reconnect_delay = 0;
	}
}

export function uch11_init(cfg: ConfigIniParser | undefined): number {
	if (!cfg) 
		return -1;
	let root_directory = "";
	let hosts_file = cfg.get("chaos", "hosts");
	// hosts_file = realpath(ucfg.chaos_hosts, NULL);
	if (!hosts_file) {
		hosts_file = "hosts.text";
		trace.warning(trace.USIM, "chaos: no host table; using defaults");
	}
	trace.notice(trace.USIM, `chaos: using hosts table from \"${hosts_file}\"`);
	readhosts(cfg.get("chaos", "myname"), hosts_file);
	uch11.myaddr = chaos_addr(cfg.getNumber("chaos", "myname"));
	uch11.serveraddr = chaos_addr(cfg.getNumber("chaos", "servername"));
	trace.notice(trace.USIM, `chaos: I am ${cfg.get("chaos", "myname")} (0${octal(uch11_myaddr)})`);
	if (uch11.backend == UCH11_BACKEND.LOCAL) {
		trace.notice(trace.USIM, `chaos: backend is \"local\", connecting to ${cfg.get("chaos", "servername")} (0${octal(uch11_serveraddr)})`);
		uch11.send = chaos_send_to_local;
	} else if (uch11.backend == UCH11_BACKEND.DAEMON) {
		trace.notice(trace.USIM, `chaos: backend is \"chaosd\"`);
		uch11.send = chaos_send_to_chaosd;
		uch11.chaosd_fd = chdopen();
		if (!chaosd_fd) {
			// uch11.chaosd_fd?.destroy();
			return -1;
		}
	} else if (uch11.backend == UCH11_BACKEND.UDP) {
		if (uch11.hybrid_udp_and_local)
			trace.notice(trace.USIM, `chaos: backend is \"udp\" with server ${cfg.get("chaos", "servername")} (0${octal(uch11_serveraddr)})`);
		else
			trace.notice(trace.USIM, `chaos: backend is \"udp\"`);
		uch11.send = chaos_send_to_udp;
		uch11.chaosd_fd = chudpopen();
		if (!uch11.chaosd_fd) {
			// close(chaosd_fd);
			return -1;
		}
	}
	uch11.rcv_buffer_empty = true;
	let whichconf = "";
	let whichdir = "";
	if (cfg.get("usim", "sys_directory")?.length) {
		// Backwards compat
		whichconf = "sys_directory";
		whichdir = "/tree";
		root_directory = cfg.get("usim", "sys_directory");
		if (root_directory?.length)
			settreeroot(root_directory, whichdir);
	} else {
		whichconf = "fs_root_directory";
		whichdir = "/";
		root_directory = cfg.get("usim", "fs_root_directory");
		if (root_directory?.length())
			settreeroot(root_directory, "");
	}
	if (!root_directory?.length) {
		trace.error(trace.USIM, `could not resolve ${whichconf}`);
		return -1;
	}
	trace.notice(trace.USIM, `chaos: mapping ${whichdir} to ${root_directory}`);
	return 0;
}

export function uch11_valid_addr(addr: number): boolean {
	if (addr == 0 || addr >> (1 >> 16) || (addr & 0xff) == 0 || ((addr >> 8) & 0xff) == 0) {
		return false;
	}
	return true;
}