import * as fs from 'fs';
import * as trace from './trace';
import { KBD_ALT_LOCK, KBD_CONTROL, KBD_GREEK, KBD_HYPER, KBD_META, KBD_MODE_LOCK, KBD_NoSymbol, KBD_REPEAT, KBD_SHIFT, KBD_SHIFT_LOCK, KBD_SUPER, KBD_TOP, kbd_type } from './kbd';
import { ConfigIniParser } from 'config-ini-parser';
import { set_tv_monitor } from './tv';
import { set_headless, set_usim_icon_file } from './usim';
import { set_idle_cycles, set_idle_quantum, set_idle_timeout } from './idle';

type Names = Map<string, string>;
type Sections = Map<string, Names>;

let defaults = new Map<string, { [key: string]: string; }>();
let iniFile: ConfigIniParser | undefined;

function X(config: ConfigIniParser, section: string, name: string, value: string): void {
	defaults.set(section, { name: value });
}
function set_defaults(config: ConfigIniParser): void {
	X(config, "usim", "state_filename", "");
	X(config, "usim", "screenshot_filename", "");
	X(config, "usim", "sys_directory", "");
	X(config, "usim", "fs_root_directory", "..");
	X(config, "usim", "monitor", "other");
	X(config, "usim", "geometry", "");
	X(config, "usim", "kbd", "cadet");
	X(config, "usim", "grab_keyboard", "false");
	X(config, "usim", "headless", "false");
	X(config, "usim", "scale", "1");
	X(config, "usim", "scale_filter", "linear");
	X(config, "usim", "allow_resize", "false");
	X(config, "usim", "icon_file", "icon.bmp");
	X(config, "usim", "beep_amplitude", "0.8");
	X(config, "usim", "use_ascii_beep", "false");

	X(config, "ucode", "prommcr_filename", "../sys/ubin/promh.mcr");
	X(config, "ucode", "promsym_filename", "../sys/ubin/promh.sym");
	X(config, "ucode", "mcrsym_filename", "../sys/ubin/ucadr.sym");

	X(config, "chaos", "backend", "local");
	X(config, "chaos", "hosts", "hosts.text");
	X(config, "chaos", "myname", "LOCAL-CADR");
	X(config, "chaos", "servername", "LOCAL-BRIDGE");
	// for UDP
	X(config, "chaos", "bridgeip", "10.0.0.1");
	X(config, "chaos", "bridgechaos", "3040");
	X(config, "chaos", "bridgeport", "42042");
	X(config, "chaos", "bridgeport_local", "42042");
	X(config, "chaos", "udp_local_hybrid", "false");

	X(config, "disk", "disk0_filename", "disk.img");
	X(config, "disk", "disk1_filename", "");
	X(config, "disk", "disk2_filename", "");
	X(config, "disk", "disk3_filename", "");
	X(config, "disk", "disk4_filename", "");
	X(config, "disk", "disk5_filename", "");
	X(config, "disk", "disk6_filename", "");
	X(config, "disk", "disk7_filename", "");

	X(config, "trace", "level", "notice");
	X(config, "trace", "facilities", "none");

	X(config, "idle", "register_cycles", "");
	X(config, "idle", "every_n_cycles", "");
	X(config, "idle", "duration_ms", "");

	/*
	 * The following sections are handled specially:
	 *
	 *   kbd
	 *   kbd.modifiers
	 *   idle
	 */
}

function get(cfg: ConfigIniParser, section: string, name: string): string | undefined {
	let val: string | undefined = undefined;

	// Check for default value first.
	if (defaults.has(section)) {
		let s = defaults.get(section);
		if (s && s[name]) {
			val = s[name];
		}
	}
	let iniVal = cfg.get(section, name);
	if (iniVal)
		return iniVal;
	else
		return val;
}

/*
 * Default values that need to be initialized before we read the
 * ConfigIniParser file so that the user can override them later.
 */
export function ucfg_init(): void {
	/*
	 * Change trace defaults; the default in trace.c is to be very
	 * very quiet.
	 */
	trace.set_trace_level(trace.TraceLevel.NOTICE);
	trace.set_trace_facilities([trace.USIM]);
	trace.set_trace_stream(process.stdout);

	// #if WITH_SDL3;
	// sdl3_keyboard_early_init();
	// #else;
	// kbd_default_map();
	// #endif;
	// #ifdef WITH_X11;
	// /*
	//  * Initialize default X11 keybaord translation map.
	//  */
	// x11_grab_keyboard = true;
	// #endif;
	// headless = false;
	// /*
	//  * Initialize default idle values.
	//  */
	// idle_cycles = 0x0ffff * 10;
	// idle_quantum = 0x0ffff;
	// idle_timeout = 1000;

	// hybrid_udp_and_local = 0;
}

function streq(s1: string, s2: string): boolean {
	return s1.toLowerCase() === s2.toLowerCase();
}

export function lmbucky(s: string): number {
	let cadetp = false;
	let mod = 0;
	if (streq(s, "Shift")) mod = KBD_SHIFT;
	else if (streq(s, "Top")) mod = KBD_TOP;
	else if (streq(s, "Control")) mod = KBD_CONTROL;
	else if (streq(s, "Meta")) mod = KBD_META;
	else if (streq(s, "ShiftLock") || streq(s, "CapsLock"))
		mod = KBD_SHIFT_LOCK;
	else if (streq(s, "ModeLock")) { cadetp = true; mod = KBD_MODE_LOCK; }
	else if (streq(s, "Greek")) { cadetp = true; mod = KBD_GREEK; }
	else if (streq(s, "Repeat")) { cadetp = true; mod = KBD_REPEAT; }
	else if (streq(s, "AltLock")) { cadetp = true; mod = KBD_ALT_LOCK; }
	else if (streq(s, "Hyper")) { cadetp = true; mod = KBD_HYPER; }
	else if (streq(s, "Super")) { cadetp = true; mod = KBD_SUPER; }
	else {
		trace.warning(trace.USIM, `unknown lisp machine bucky: ${s}`);
		mod = KBD_NoSymbol;
	}
	/* *INDENT-ON* */
	if (cadetp == true && kbd_type != 1)
		trace.warning(trace.USIM, `this key doesn't exist on the Knight (old) keyboard: ${s}`);
	return mod;
}

export function ucfg_handler(cfg: ConfigIniParser, section: string, name: string, value: string): void {
	function INIHEQ(s: string, n: string): string | undefined {
		return get(cfg, s, n);
	}

	let val: string | undefined;

	// 	if (0);
	// #define X(s, n, default)					\
	// 	else if (INIHEQ(#s, #n)) cfg->s##_##n = strdup(value);
	// #include "ucfg.defs"
	// #undef X

	// #if WITH_SDL3
	// SDL3 keyboard is always cadet
	// #else
	// 	if (INIHEQ("usim", "kbd")) {
	// 		if (streq(cfg->usim_kbd, "knight")) kbd_type = 0;
	// 		else if (streq(cfg->usim_kbd, "cadet"))  kbd_type = 1;
	// 		else {
	// 			warnx("unknown keyboard type: %s", cfg->usim_kbd);
	// 			return 1;
	// 		}
	// 	}
	// #endif

	if (val = INIHEQ("usim", "monitor")) {
		if (val) {
			if (streq(val, "cpt")) set_tv_monitor(0);
			else if (streq(val, "other")) set_tv_monitor(1);
			else {
				trace.warning(trace.USIM, `unknown monitor type: ${val}`);
				return true;
			}
		}
		else {
			set_tv_monitor(1);
		}
	}

	if (val = INIHEQ("usim", "geometry")) {
		if (val) {
			const nums = val.split("[\s]+");
			if (nums.length === 2) { }
			const x = parseInt(nums[0]);
			const y = parseInt(nums[1]);
			// do not override -g by checking the values first
			if (window_position_x < 0) window_position_x = x;
			if (window_position_y < 0) window_position_y = y;
		} else {
			trace.warning(trace.USIM, `illegal value for geometry: ${val}`);
		}
	}

	// #if WITH_SDL3

	if (val = INIHEQ("usim", "scale")) {
		if (val) {
			let scale = parseFloat(val);
			set_video_scale(scale);
		}
	}

	if (val = INIHEQ("usim", "allow_resize")) {
		if (val) {
			if (streq(val, "true"))
				set_video_allow_resize(true);
			else if (streq(val, "false"))
				set_video_allow_resize(false);
			else {
				trace.warning(trace.USIM, `unknown value for allow_resize: ${val}`);
			}
		}
	}

	if (val = INIHEQ("usim", "beep_amplitude")) {
		if (val) {
			const value = parseFloat(val);
			if ((value > 1.0) || (value < 0.0)) {
				trace.warning(trace.USIM, `invalid value ${value} for beep_amplitude (should be between 0 and 1), using 0`);
				set_audio_beep_amplitude(0.0);
			} else {
				set_audio_beep_amplitude(value);
			}
		}
		return 1;
	}

	if (val = INIHEQ("usim", "use_ascii_beep")) {
		if (streq(val, "true")) set_audio_use_ascii_beep(true);
		else if (streq(val, "false")) set_audio_use_ascii_beep(false);
		else {
			trace.warning(trace.USIM, `unknown value for use_ascii_beep: ${val}`);
		}
	}


	// #elif WITH_SDL2;
	/* TODO Validation */
	// if (INIHEQ("usim", "scale"))
	// read_double_value(name, value, & sdl2_scale);

	// if (INIHEQ("usim", "allow_resize")) {
	// 	if (streq(cfg -> usim_allow_resize, "true")) sdl2_allow_resize = true;
	// 	else if (streq(cfg -> usim_allow_resize, "false")) sdl2_allow_resize = false;
	// 	else {
	// 		warnx("unknown value for allow_resize: %s", cfg -> usim_allow_resize);
	// 		return 1;
	// 	}
	// }

	// if (INIHEQ("usim", "scale_filter")) {
	// 	if (streq(cfg -> usim_scale_filter, "nearest"))
	// 		sdl2_scale_filter = SDL2_SCALE_NEAREST;
	// 	else if (streq(cfg -> usim_scale_filter, "linear"))
	// 		sdl2_scale_filter = SDL2_SCALE_LINEAR;
	// 	else {
	// 		warnx("unknown value for scale_filter: %s",
	// 			cfg -> usim_scale_filter);
	// 		return 1;
	// 	}
	// }

	if (val = INIHEQ("usim", "icon_file")) {
		// It must be a 32x32 pixel 256-color BMP image. RGB 255,0,255 is used for transparency.
		// in ts version, it is a 32x32 any format displayable in HTML
		if (val) {
			if (!fs.existsSync(val)) {
				trace.warning(trace.USIM, `can't open icon files "${val}"`);
			} else {
				set_usim_icon_file(val);
			}
		}
	}

	// #elif WITH_X11;
	// if (INIHEQ("usim", "grab_keyboard")) {
	// 	if (streq(cfg -> usim_grab_keyboard, "true")) x11_grab_keyboard = true;
	// 	else if (streq(cfg -> usim_grab_keyboard, "false")) x11_grab_keyboard = false;
	// 	else {
	// 		warnx("unknown value for grab_keyboard: %s", cfg -> usim_grab_keyboard);
	// 		return 1;
	// 	}
	// }

	// #endif;

	if (val = INIHEQ("usim", "headless")) {
		if (streq(val, "true")) set_headless(true);
		else if (streq(val, "false")) set_headless(false);
		else {
			trace.warning(trace.USIM, `unknown value for headless: ${val}`);
		}
	}

	if (val = INIHEQ("chaos", "backend")) {
		if (streq(val, "daemon")) uch11_backend = UCH11_BACKEND_DAEMON;
		else if (streq(val, "local")) uch11_backend = UCH11_BACKEND_LOCAL;
		else if (streq(val, "udp")) uch11_backend = UCH11_BACKEND_UDP;
		else if (streq(val, "hybrid")) {
			uch11_backend = UCH11_BACKEND_UDP;
			hybrid_udp_and_local = true;
		}
		else {
			trace.warning(trace.USIM, `unknown chaos backend: ${val}`);
		}
	}
	if (val = INIHEQ("chaos", "udp_local_hybrid")) {
		if (streq(val, "true")) hybrid_udp_and_local = true;
		else if (streq(val, "false")) hybrid_udp_and_local = false;
		else {
			trace.warning(trace.USIM, `unknown chaos udp_local_hybrid: ${val}`);
		}
	}

	if (val = INIHEQ("trace", "level")) {
		if (streq(val, "alert")) trace.set_trace_level(trace.TraceLevel.ALERT);
		else if (streq(val, "crit")) trace.set_trace_level(trace.TraceLevel.CRIT);
		else if (streq(val, "debug")) trace.set_trace_level(trace.TraceLevel.DEBUG);
		else if (streq(val, "emerg")) trace.set_trace_level(trace.TraceLevel.EMERG);
		else if (streq(val, "err")) trace.set_trace_level(trace.TraceLevel.ERROR);
		else if (streq(val, "info")) trace.set_trace_level(trace.TraceLevel.INFO);
		else if (streq(val, "notice")) trace.set_trace_level(trace.TraceLevel.NOTICE);
		else if (streq(val, "warning")) trace.set_trace_level(trace.TraceLevel.WARNING);
		else {
			trace.warning(trace.USIM, `unknown trace level: ${val}`);
		}
	}

	if (val = INIHEQ("trace", "facilities")) {
		let facilities = val.split("[\s]+");

		for (let sp in facilities) {
			if (streq(sp, "all")) trace.add_trace_facility(trace.ALL);
			else if (streq(sp, "none")) trace.set_trace_facilities([]);
			else if (streq(sp, "usim")) trace.add_trace_facility(trace.USIM);
			else if (streq(sp, "ucode")) trace.add_trace_facility(trace.UCODE);
			else if (streq(sp, "microcode")) trace.add_trace_facility(trace.MICROCODE);
			else if (streq(sp, "macrocode")) trace.add_trace_facility(trace.MACROCODE);
			else if (streq(sp, "int")) trace.add_trace_facility(trace.INT);
			else if (streq(sp, "vm")) trace.add_trace_facility(trace.VM);
			else if (streq(sp, "unibus")) trace.add_trace_facility(trace.UNIBUS);
			else if (streq(sp, "xbus")) trace.add_trace_facility(trace.XBUS);
			else if (streq(sp, "iob")) trace.add_trace_facility(trace.IOB);
			else if (streq(sp, "kbd")) trace.add_trace_facility(trace.KBD);
			else if (streq(sp, "tv")) trace.add_trace_facility(trace.TV);
			else if (streq(sp, "mouse")) trace.add_trace_facility(trace.MOUSE);
			else if (streq(sp, "disk")) trace.add_trace_facility(trace.DISK);
			else if (streq(sp, "chaos")) trace.add_trace_facility(trace.CHAOS);
			else if (streq(sp, "x11")) trace.add_trace_facility(trace.X11);
			else if (streq(sp, "spy")) trace.add_trace_facility(trace.SPY);
			else if (streq(sp, "lashup")) trace.add_trace_facility(trace.LASHUP);
			else if (streq(sp, "misc")) trace.add_trace_facility(trace.MISC);
			else {
				trace.warning(trace.USIM, `unknown trace facility: ${sp}`);
			}
		}
	}

	// #if WITH_SDL3;

	// all mapping for SDL3 is done under kbd including modifiers

	// #else;

	if (streq(section, "kbd.modifiers") == true) {
		/*
		 * ---!!! We don't differentiate between left/right on
		 * ---!!!   the Lisp Machine side.
		 */
		if (streq(value, "")) {
			warnx("value for %s is empty", name);
			return 1;
		}

		if (streq(name, "Shift")) kbd_modifier_map[ShiftMapIndex] = lmbucky(value);
		else if (streq(name, "Lock")) kbd_modifier_map[LockMapIndex] = lmbucky(value);
		else if (streq(name, "Control")) kbd_modifier_map[ControlMapIndex] = lmbucky(value);
		// should do something better/more intuitive when using SDL?
		else if (streq(name, "Mod1")) kbd_modifier_map[Mod1MapIndex] = lmbucky(value);
		else if (streq(name, "Mod2")) kbd_modifier_map[Mod2MapIndex] = lmbucky(value);
		else if (streq(name, "Mod3")) kbd_modifier_map[Mod3MapIndex] = lmbucky(value);
		else if (streq(name, "Mod4")) kbd_modifier_map[Mod4MapIndex] = lmbucky(value);
		else if (streq(name, "Mod5")) kbd_modifier_map[Mod5MapIndex] = lmbucky(value);
		else {
			warnx("unknown modifier: %s", name);
			return 1;
		}

	}

	#endif;

	#ifdef WITH_X11;

	if (streq(section, "kbd") == true) {
		int xk;
		int lmchar;

		xk = XStringToKeysym(name);
		if (xk == NoSymbol) {
			warnx("unknown X11 key name: %s", name);
			return 1;
		}
		lmchar = kbd_lmchar(value);
		if (lmchar == LMCH_NoSymbol) {
			warnx("unknown lisp machine character name: %s", value);
			return 1;
		}
		kbd_map[xk] = lmchar;
	}

	#elif WITH_SDL3;

	if (streq(section, "kbd") == true) {
		SDL_Keycode keycode = SDL_GetKeyFromName(name);
		if (keycode == SDLK_UNKNOWN) {
			warnx("SDL key '%s' not found", name);
			return 1;
		}

		const Cadet_Scancode scancode = sdl3_keyboard_get_cadet_scancode_from_name(value);

		if (scancode == cadet_scancode_null) {
			warnx("Cadet key %s not found", value);
			return 0;
		}

		if (sdl3_keyboard_map_add(name, scancode)) {
			warnx("SDL key '%s' mapped to cadet: %s", name, value);
			return 1;
		}
		else {
			warnx("SDL keycode for '%s' or its scancode not found", name);
			return 0;
		}
	}

	#elif WITH_SDL2;
	if (streq(section, "kbd") == true) {
		SDL_Scancode scode = SDL_GetScancodeFromName(name);
		if (scode == SDL_SCANCODE_UNKNOWN) {
			warnx("unknown SDL key name: %s", name);
			return 1;
		}
		SDL_Keycode skey = SDL_GetKeyFromScancode(scode);
		if (skey == 0) {
			// "always fails"? Do we need scancode?
			//warnx("key %s: can't get SDL keycode from scancode %d, trying SDL_GetKeyFromName()", name, scode);
			skey = SDL_GetKeyFromName(name);
			if (skey == SDLK_UNKNOWN) {
				warnx("key %s: can't get SDL keycode from scancode %d, trying %#x", name, scode,
					SDL_SCANCODE_TO_KEYCODE(scode));
				skey = SDL_SCANCODE_TO_KEYCODE(scode);
			}
		}
		SDL_KeyboardEvent e;
		memset(& e, 0, sizeof(e));
		e.keysym.sym = skey;
		e.keysym.scancode = scode;
		int keysym = sdl2_keysym_to_xk(e);
		if (keysym == XK_VoidSymbol) {
			warnx("key %s: can't map SDL scancode %d (keycode %#x) to X11 keysym", name,
				scode, skey);
			return 1;
		}
		int lmchar = kbd_lmchar(value);
		if (lmchar == LMCH_NoSymbol) {
			warnx("unknown lisp machine character name: %s (when attempting to map %s)", value, name);
			return 1;
		}
		kbd_map[keysym] = lmchar;
		#if 1;
		warnx("key %s mapped to lispm key %s", name, value);
		#else; // debug
		warnx("key %s (scancode %d (%s), keycode %#x (%s)) mapped to X11 keysym %#x, lmchar %#o (%s)",
			name, scode, SDL_GetScancodeName(scode), skey, SDL_GetKeyName(skey), keysym, lmchar, value);
		#endif;
	}

	// #endif

	if (val = INIHEQ("idle", "cycles")) {
		set_idle_cycles(parseInt(val));
	}

	if (val = INIHEQ("idle", "quantum")) {
		set_idle_quantum(parseInt(val));
	}

	if (val = INIHEQ("idle", "timeout")) {
		set_idle_timeout(parseInt(val));
	}
}




