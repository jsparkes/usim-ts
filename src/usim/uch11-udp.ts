/* CHaosnet over UDP */

import { CHAOS_CSR_LOOP_BACK, uch11, uch11_rx_pkt, uch11_valid_addr } from './uch11';
import * as trace from './trace';
import * as net from 'net';
import dgram from 'node:dgram';
import { error } from './misc';

// Max pkt size (12 bits) plus header
// The limit of 488 bytes is from MIT AIM 628, although more would fit any modern pkt (and 12 bits would give 4096 as max).
// This is due to original Chaos hardware pkts limited to 4032 bits, of which 16 bytes are header.
const CH_PK_MAX_DATALEN = 488;
/* Protocol version */
const CHUDP_VERSION = 1;
/* Protocol function codes */
const CHUDP_PKT = 1;		/* Chaosnet packet */

let lport = 0o42042;
let udp_port = 0o42042;
let udp_bridge = "localhost";
let udp_bridge_chaddr = 0;
const udp_server = dgram.createSocket('udp4');
let trans_chudpbuf = new Uint8Array();

export function chudpopen() {
    if (uch11.hybrid_udp_and_local) {
        if (!uch11.serveraddr) {
            trace.warning(trace.CHAOS, "You configured udp_local_hybrid but there is no server address! Disabling hybrid.");
            uch11.hybrid_udp_and_local = 0;
        } else {
            /* Do the local init too */
            /* original set up queue and mutex */
        }
    }
    // Get lport and udp_port from ucfg
    // TODO: use the defaults for now
    // get udp_bridge as well

    if (!uch11_valid_addr(udp_bridge_chaddr)) {
        error(1, "bad udp bridge chaddr");
    } else {
        udp_bridge_chaddr = udp_bridge_chaddr & 0xffff;
    }

    // 	NOTICE(TRACE_USIM, "chaos: chudp init, bridge is %#o at %s:%d, local port %d, hybrid %s\n", udp_bridge_chaddr, inet_ntoa(udp_dest), udp_dport, lport, hybrid_udp_and_local ? "true" : "false");

    udp_server.bind(lport);

    udp_server.on('error', (err) => {
        error(1, `UDP server error:\n${err.stack}`);
    });

    udp_server.on('listening', () => {
        const address = udp_server.address();
        trace.info(trace.CHAOS, `server listening ${address.address}:${address.port}`);
    });

    udp_server.on('message', chudp_message);

    udp_server.connect(udp_port, udp_bridge);
}

class chudp_header {
    // char chudp_version;
    // char chudp_arg1;
    // char chudp_arg2;
    bytes = new Uint8Array(4);
    constructor(b: Uint8Array) {
        if (b.length != 4) {
            error(1, "Invalid chudp_header");
        }
        this.bytes = b;
    }
}

class chaos_hw_trailer {
    //unsigned short ch_hw_destaddr:16;
    //unsigned short ch_hw_srcaddr:16;
    //unsigned short ch_hw_checksum:16;
    bytes = new Uint16Array(3);
    constructor(ints: Uint16Array) {
        if (ints.length != 3) {
            error(1, "Invalid chudp trailer");
        }
        this.bytes = ints;
    }
};

export function chaos_send_to_udp(buffer: Uint16Array, size: number): boolean {
    /*
     * Local loopback.
     */
    if (uch11.csr & CHAOS_CSR_LOOP_BACK) {
        trace.debug(trace.CHAOS, `chaos: loopback ${buffer.length} bytes`);
        uch11.rcv_buffer = buffer;
        uch11.rcv_buffer_size = (size + 1) / 2;
        uch11.rcv_buffer_empty = false;
        uch11_rx_pkt();
        return true;
    }
    if (uch11.hybrid_udp_and_local) {
		/* Check if it is for our "local server" */
		struct packet * packet;
        packet = (struct packet *) buffer;
        if (CH_ADDR_SHORT(packet -> pk_daddr) == chaos_addr(ucfg.chaos_servername, 0)) {
            return chaos_send_to_local(buffer, size);
        }
    }
    wcount = (size + 1) / 2;
    dest_addr = ((unsigned short *) buffer)[wcount - 3];
    DEBUG(TRACE_CHAOS, "chaos: sending packet to udp (dest_addr=%o, uch11_myaddr=%o, size %d, wcount %d)\n", dest_addr, uch11_myaddr, size, wcount);
    if (size > (int) CHUDP_MAXLEN) {
        ERR(TRACE_CHAOS, "chaos: packet too long: %d", size);
        return -1;
    }
    /*
     * Receive packets addressed to us, or broadcasts.
     */
    if ((dest_addr == uch11_myaddr) || (dest_addr == 0)) {
        memcpy(uch11_rcv_buffer, buffer, size);
        uch11_rcv_buffer_size = (size + 1) / 2;
        uch11_rcv_buffer_empty = false;
        uch11_rx_pkt();
        if (dest_addr != 0)	/* Broadcasts should be sent also to other */
            return 0;
    }
    if (chaosd_fd == -1) {
        ERR(TRACE_CHAOS, "chaos: transmit but chaosd_fd not open!\n");
        return 0;
    }
    {
		struct chudp_header * hp = (struct chudp_header *) & trans_chudpbuf;
        u_char * op = trans_chudpbuf + sizeof(struct chudp_header);
		int nb;

        memset(trans_chudpbuf, 0, sizeof(trans_chudpbuf));
        /* Set up CHUDP header */
        hp -> chudp_version = CHUDP_VERSION;
        hp -> chudp_function = CHUDP_PKT;

        memcpy(op, buffer, size);

		/* Update the hw trailer dest (and checksum) since what is there is probably the ultimate dest,
		 * but it should be just the next hop */
		struct pkt_header * ph = (struct pkt_header *) ((char *) op);
		u_short pklen = LENFC_LEN(ph -> ph_lenfc);
		u_short offs = sizeof(struct pkt_header) + pklen;
        if (offs % 2)
            offs++;
		struct chaos_hw_trailer * tp = (struct chaos_hw_trailer *) (op + offs);
		u_short hwdest = tp -> ch_hw_destaddr;
        // u_short cksum = tp->ch_hw_checksum;
        if (hwdest != udp_bridge_chaddr) {
            INFO(TRACE_CHAOS, "chaos: hw trailer dest is %#o should be %#o\n", hwdest, udp_bridge_chaddr);
            tp -> ch_hw_destaddr = udp_bridge_chaddr;
        }
        tp -> ch_hw_checksum = htons(uch11_checksum(op, size - 2));

        /* Now swap it */
        ntohs_buf((u_short *) op, (u_short *) op, size);

        INFO(TRACE_CHAOS, "chaos: sending %d bytes (pkt size %d)\n", size + sizeof(struct chudp_header), size);
        if ((nb = send(chaosd_fd, (char *) hp, size + sizeof(struct chudp_header), 0)) < 0) {
            if ((errno != EHOSTUNREACH) && (errno != ENETDOWN) && (errno != ENETUNREACH))
                perror("chaos: send to udp");
            // ERR(TRACE_CHAOS, "chaos: send to udp failed\n");
            return -1;
        } else if (nb != size + (int)sizeof(struct chudp_header)) {
            ERR(TRACE_CHAOS, "chaos: could not send the full pkt: %d sent, expected %d\n", nb, size + sizeof(struct chudp_header));
            return -1;
        }
    }
    return 0;
}
 

function chudp_message(msg, rinfo): void {

}