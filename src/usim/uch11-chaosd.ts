import * as trace from './trace';
import * as net from 'net';
import { CHAOS_CSR_LOOP_BACK, uch11, uch11_rx_pkt } from './uch11';
import { octal } from './misc';

const UNIX_SOCKET_PATH = "/var/tmp/";
const UNIX_SOCKET_CLIENT_NAME = "chaosd_";
const UNIX_SOCKET_SERVER_NAME = "chaosd_server";

export function chaos_send_to_chaosd(buffer: Uint16Array, size: number) : number {
	/*
	 * Local loopback.
	 */
	if (uch11.csr & CHAOS_CSR_LOOP_BACK) {
        trace.debug(trace.CHAOS, `chaos: loopback ${size} bytes`);
        uch11.rcv_buffer.set(buffer, 0);
		// memcpy(uch11_rcv_buffer, buffer, size);
		uch11.rcv_buffer_size = (size + 1) / 2;
		uch11.rcv_buffer_empty = false;
		uch11_rx_pkt();
		return 0;
	}
	const wcount = (size + 1) / 2;
	const dest_addr = buffer[wcount - 3];
    trace.debug(trace.CHAOS, `chaos: sending packet to chaosd (dest_addr=${octal(dest_addr)}, uch11.myaddr=${octal(uch11.myaddr)}, size ${size}, wcount ${wcount}`);
	/*
	 * Receive packets addressed to us, but don't receive broadcasts we send
	 */
	if (dest_addr == uch11.myaddr) {
        uch11.rcv_buffer.set(buffer, 0);
		// memcpy(uch11_rcv_buffer, buffer, size);
		uch11.rcv_buffer_size = (size + 1) / 2;
		uch11.rcv_buffer_empty = false;
		uch11_rx_pkt();
	}
	if (!uch11.chaosd_fd)
		return 0;

    if (!uch11.chaosd_fd.write(new Uint8Array(buffer))) {
        uch11.chaosd_fd.on('drain', () => {
            // Log error here?
            return -1;
        });
    }
	return 0;
}

