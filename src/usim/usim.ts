import * as trace from './trace';
import * as ucfg from './ucfg';
import { SymbolTable } from "./usym";

export const config_filename = "usim-301-0.ini";
export let warm_boot_flag = false;
export let headless = false;
export let icon_file = "icon.bmp";

export const sym_mcr = new SymbolTable();
export const sym_prom = new SymbolTable();

export function set_headless(val: boolean): void {
	headless = val;
}

export function set_usim_icon_file(name: string): void {
	icon_file = name;
}

function sighup_handler(arg: any): void {
    ini_parse(config_filename);
}

function siginfo_handler(arg: any): void {
    dump_state(true);
}

function usage():void {
	process.stderr.write(`usage: usim [OPTION]...\n`);
	process.stderr.write(`CADR simulator\n`);
	process.stderr.write(`\n`);
	process.stderr.write(`  -c FILE        configuration file (default: ${config_filename})\n`);
	process.stderr.write(`  -d             dump state on halt (default state file: ${ucfg.usim_state_filename()}`);
	process.stderr.write(`  -D             like -d, verbose (default state file: ${ucfg.usim_state_filename()})\n`);
	process.stderr.write(`  -w             warm boot\n`);
	process.stderr.write(`  -l LC          dump state whenever lc reaches LC (decimal integer)\n`);
	process.stderr.write(`  -t VMEM        add a read/write trace for virtual memory location VMEM (decimal integer)\n`);
	process.stderr.write(`  -u npc         dump state whenever the microcode pc reaches npc (decimal integer)\n`);
	process.stderr.write(`  -f LC          enable *full* tracing after lc reaches LC (decimal integer)\n`);
	process.stderr.write(`  -g X,Y         set window position to X,Y overriding the config (decimal integers)\n`);
	process.stderr.write(`  -h             help message\n`);
}

export function usim_init(int argc, char **argv)
{
	printf("CADR emulator v" VERSION ".\n");
	config_filename = "usim.ini";
	warm_boot_flag = false;
	int c;
	while ((c = getopt(argc, argv, "c:l:t:u:f:g:dDwh")) != -1) {
		switch (c) {
		case 'c': config_filename = strdup(optarg); break;
		case 'd': dump_state_flag = true; break;
		case 'D': verbose_dump_state_flag = true; break;
		case 'w': warm_boot_flag = true; break;
		case 'l': add_dump_lc(atoi(optarg)); break;
		case 't': add_trace_vmem(atoi(optarg)); break;
		case 'u': add_dump_npc(atoi(optarg)); break;
		case 'f': full_trace_lc = atoi(optarg);
			printf("enabling full tracing after LC #x%x\n", full_trace_lc);
			break;
		case 'g':
		{
			int x, y;
			int nc = sscanf(optarg, "%d,%d", &x, &y);
			if (nc == 2) {
				window_position_x = x;
				window_position_y = y;
			} else {
				fprintf(stderr, "invalid value, specify as -g X,Y\n");
				return usim_app_failure;
			}
		}
		break;
		case 'h':
			usage();
			return usim_app_success;
		default:
			usage();
			return usim_app_failure;
		}
	}
	/* *INDENT-ON* */
	argc -= optind;
	argv += optind;
	if (argc > 0) {
		usage();
		return -1;
	}
	ucfg_init();
	if (ini_parse(config_filename, ucfg_handler, &ucfg) < 0)
	{
		fprintf(stderr, "Can't load '%s', using defaults\n", config_filename);
	}
#if SIGINFO
	signal(SIGINFO, siginfo_handler);
#endif
	signal(SIGUSR1, siginfo_handler);
	signal(SIGHUP, sighup_handler);
	read_prom(ucfg.ucode_prommcr_filename);
	sym_read_file(&sym_prom, ucfg.ucode_promsym_filename);
	if (headless == false)
	{
		tv_init();
	}

#define DI(unit)	disk_init(unit, ucfg.disk_disk##unit## _filename);
	DI(0); DI(1); DI(2); DI(3);
	DI(4); DI(5); DI(6); DI(7);
#undef DI

	sym_read_file(&sym_mcr, ucfg.ucode_mcrsym_filename);

	iob_init();
	idle_init();

	return usim_app_continue;
}

