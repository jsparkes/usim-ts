import { tracingChannel } from 'diagnostics_channel';
import * as trace from './trace';
import { assert_unibus_interrupt } from './ucode';
import { CHAOS } from './trace';


export enum UCH11_BACKEND {
  DAEMON = 'daemon',
  LOCAL = 'local',
  UDP = 'udp'
}

const CHAOS_CSR_TIMER_INTERRUPT_ENABLE = (0o1 << 0o0); /* CHBUSY */
const CHAOS_CSR_LOOP_BACK = (0o1 << 0o1);       /* CHLPBK */
const CHAOS_CSR_RECEIVE_ALL = (0o1 << 0o2);	       /* CHSPY */
const CHAOS_CSR_RECEIVER_CLEAR = (0o1 << 0o3);
const CHAOS_CSR_RECEIVE_ENABLE = (0o1 << 0o4);	/* CHREN */
const CHAOS_CSR_TRANSMIT_ENABLE = (0o1 << 0o5);	/* CHRIEN */
const CHAOS_CSR_INTERRUPT_ENABLES = (0o2 << 0o4);
const CHAOS_CSR_TRANSMIT_ABORT = (0o1 << 0o6);	   /* CHABRT */
const CHAOS_CSR_TRANSMIT_DONE = (0o1 << 0o7);	   /* CHTDN */
const CHAOS_CSR_TRANSMITTER_CLEAR = (0o1 << 0o10); /* CHTCLR */
const CHAOS_CSR_LOST_COUNT = (0o4 << 0o11);	   /* CHLC */
const CHAOS_CSR_RESET = (0o1 << 0o15);		   /* CHRST */
const CHAOS_CSR_CRC_ERROR = (0o1 << 0o16);	   /* CHCRC */
const CHAOS_CSR_RECEIVE_DONE = (0o1 << 0o17);	   /* CHRDN */

export let uch11_backend = UCH11_BACKEND.LOCAL;
export let uch11_myaddr = 0o177040; // local-cadr
export let uch11_serveraddr = 0o177001; // local-bridge
export let hybrid_udp_and_local = 0;
let uch11_send: (buffer: Uint16Array, count: number) => number;


export let uch11_csr = CHAOS_CSR_RESET;
let uch11_bit_count = 0;
let uch11_lost_count = 0;

export let uch11_xmit_buffer = new Uint16Array(4096);
let uch11_xmit_buffer_size = 0;
let uch11_xmit_buffer_ptr = 0;

let uch11_rcv_buffer = new Uint16Array(4096);
let uch11_rcv_buffer_toss = new Uint16Array(4096);
let uch11_rcv_buffer_ptr = 0;
let uch11_rcv_buffer_size = 0;
let uch11_rcv_buffer_empty = false;

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
 * Called when we are we have something in uch11_rcv_buffer.
 */
function uch11_rx_pkt(): void {
  uch11_rcv_buffer_ptr = 0;
  uch11_bit_count = (uch11_rcv_buffer_size * 2 * 8) - 1;
  trace.info(trace.CHAOS, `chaos: receiving ${uch11_rcv_buffer_size} words`);
  if (uch11_rcv_buffer_size > 0) {
    trace.debug(trace.CHAOS, `chaos: set csr receive done, generate interrupt`);
    uch11_csr |= CHAOS_CSR_RECEIVE_DONE;
    if (uch11_csr & CHAOS_CSR_RECEIVE_ENABLE)
      assert_unibus_interrupt(0o270);
  } else {
    trace.debug(trace.CHAOS, `chaos: recieve buffer empty`);
  }
}

function uch11_xmit_done_intr(): void {
  uch11_csr |= CHAOS_CSR_TRANSMIT_DONE;
  if (uch11_csr & CHAOS_CSR_TRANSMIT_ENABLE)
    assert_unibus_interrupt(0o270);
}

function uch11_xmit_pkt(): void
{
  trace.info(trace.CHAOS, `chaos: transmitting ${uch11_xmit_buffer_ptr * 2} bytes, data len ${ (uch11_xmit_buffer_ptr > 0 ? uch11_xmit_buffer[1] & 0x3f : -1)}`);
	uch11_xmit_buffer_size = uch11_xmit_buffer_ptr;
	/*
	 * Dest. is already in the buffer.
	 */
	uch11_xmit_buffer[uch11_xmit_buffer_size++] = uch11_myaddr;	/* Source. */
	uch11_xmit_buffer[uch11_xmit_buffer_size] = uch11_checksum(uch11_xmit_buffer, uch11_xmit_buffer_size * 2);	/* Checksum. */
	uch11_xmit_buffer_size++;
	uch11_send?(uch11_xmit_buffer, uch11_xmit_buffer_size * 2);
	uch11_xmit_buffer_ptr = 0;
	uch11_xmit_done_intr();
}

function uch11_get_bit_count(): number
{
	if (uch11_rcv_buffer_size > 0)
		return uch11_bit_count;
  trace.debug(trace.CHAOS, `chaos: returned empty bit count`);
	return 0o7777;
}
