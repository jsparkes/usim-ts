import * as trace from './trace';
import * as fs from 'fs';
import { ini_parse, ucfg, ucfg_get, ucfg_handler, ucfg_init } from './ucfg';
import { dump_state, read_prom } from './ucode';
import { sym_read_file, SymbolTable } from "./usym";
import { yargs } from 'yargs/yargs';
import { ConfigIniParser } from 'config-ini-parser';
import { tv_init } from './tv';
import { disk_init, DISKS } from './disk';
import { idle_init } from './idle';
import { iob_init } from './iob';

export const VERSION = "0.1.1";
export let config_filename = "usim.ini";
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

export function usim_init()
{
	process.stdout.write(`CADR emulator ${VERSION}`);

	const argv = yargs(process.argv.slice(2)).options({
		c: { type: 'string', default: "usim.ini" },
		d: { type: 'boolean', default: false },
		D: { type: 'boolean', default: false },
		w: { type: 'boolean', default: false },
		l: { type: 'number', default: 0 },
		t: { type: 'number', default: 0 },
		u: { type: 'number', default: 0 },
		f: { type: 'number', default: 0 },
		g: { type: 'string', default: "" },
		h: { type: 'demand' },
		// f: { choices: ['1', '2', '3'] }
	  }).parseSync();

	  if (argv.h) {
		usage();
	  }

    ucfg.config_filename  = argv.c;
	if (!fs.existsSync(ucfg.config_filename)) {
		ucfg.config_filename = "usim-301-0.ini";
	}
	ucfg.dump_state_flag = argv.d;
	ucfg.verbose_dump_state_flag = argv.D;
	ucfg.warm_boot_flag = argv.w;
	add_dump_lc(argv.l);
	add_trace_vmem(argv.t);
	add_dump_npc(atoi(argv.u);
	ucfg.full_trace_lc = argv.f;
	add_dump_npc(atoi(argv.u));
	if (argv.g.length() > 0) {
		const nums = argv.split("[\s]+");
		if (nums.length === 2) { }
		const x = parseInt(nums[0]);
		const y = parseInt(nums[1]);
		ucfg.window_position_x = x;
		ucfg.window_position_y = y;
	}
	const iniContent = fs.readFileSync(ucfg.config_filename);
	const parser = new ConfigIniParser(); //Use default delimiter
	ucfg.cfg = parser.parse(iniContent.toString();
	ucfg_init(ucfg.cfg);
	ucfg_handler(ucfg.cfg);
	process.on('SIGINFO', siginfo_handler);
	process.on('SIGUSR1', siginfo_handler);
	process.on('SIGHUP', sighup_handler);git://git.sv.gnu.org/emacs.git
	read_prom(ucfg_get(ucfg.cfg, "ucode", "prommcr_filename"));
	sym_read_file(sym_prom, ucfg_get(ucfg.cfg, "ucode", "ucode_promsym_filename"));
	if (ucfg.headless == false)
	{
		tv_init();
	}

	function DI(unit: number) {
		disk_init(unit, ucfg_get(ucfg.cfg, "disk", `disk${unit}_filename`));
	}

	DI(0); DI(1); DI(2); DI(3);
	DI(4); DI(5); DI(6); DI(7);

	sym_read_file(sym_mcr, ucfg_get(ucfg.cfg, "ucode", "ucode_mcrsym_filename"));

	iob_init();
	idle_init();
}

