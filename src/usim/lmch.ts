/* lmch.defs --- Lisp Machin×e character mappings	-*- C -*-
 *
 * See SYS:LMIO;RDDEFS LISP for details.
 *
 * The syntax of the X macro is as follows
 *	{ name:"symbol", value)
 */

//  export const lmchar_map: Map<String, number> = new Map({

const LMCHARS: object[] = [
    { name: "null", value: 0o200 },
    { name: "null_character", value: 0o200 },
    { name: "break", value: 0o201 },
    { name: "brk", value: 0o201 },
    { name: "suspend", value: 0o201 },
    { name: "clear_input", value: 0o202 },
    { name: "clear", value: 0o202 },
    { name: "clr", value: 0o202 },
    { name: "call", value: 0o203 },
    { name: "terminal", value: 0o204 },
    { name: "esc", value: 0o204 },
    { name: "escape", value: 0o204 },
    { name: "terminal_escape", value: 0o204 },
    { name: "function", value: 0o204 },
    { name: "macro", value: 0o205 },
    { name: "back_next", value: 0o205 },
    { name: "backnext", value: 0o205 },
    { name: "help", value: 0o206 },
    { name: "rubout", value: 0o207 },
    { name: "overstrike", value: 0o210 },
    { name: "backspace", value: 0o210 },
    { name: "bs", value: 0o210 },
    { name: "tab", value: 0o211 },
    { name: "line", value: 0o212 },
    { name: "lf", value: 0o212 },
    { name: "linefeed", value: 0o212 },
    { name: "line_feed", value: 0o212 },
    { name: "delete", value: 0o213 },
    { name: "vt", value: 0o213 },
    /* The keyboard says "CLEAR SCREEN"", but it should type out as "PAGE". */
    { name: "page", value: 0o214 },
    { name: "clear_screen", value: 0o214 },
    { name: "form", value: 0o214 },
    { name: "ff", value: 0o214 },
    { name: "return", value: 0o215 },
    { name: "newline", value: 0o215 },
    { name: "cr", value: 0o215 },
    { name: "quote", value: 0o216 },
    { name: "hold_output", value: 0o217 },
    { name: "stop_output", value: 0o220 },
    { name: "abort", value: 0o221 },
    { name: "resume", value: 0o222 },
    { name: "status", value: 0o223 },
    { name: "end", value: 0o224 },
    { name: "roman_i", value: 0o225 },
    { name: "roman_ii", value: 0o226 },
    { name: "roman_iii", value: 0o227 },
    { name: "roman_iv", value: 0o230 },
    { name: "hand_up", value: 0o231 },
    { name: "hand_down", value: 0o232 },
    { name: "hand_left", value: 0o233 },
    { name: "hand_right", value: 0o234 },
    { name: "system", value: 0o235 },
    { name: "select", value: 0o235 },
    { name: "network", value: 0o236 },
    { name: "center_dot", value: 0o0 },
    { name: "centre_dot", value: 0o0 },	/* Amerikans can't spell... */
    { name: "down_arrow", value: 0o1 },
    { name: "alpha", value: 0o2 },
    { name: "beta", value: 0o3 },
    { name: "and_sign", value: 0o4 },
    { name: "not_sign", value: 0o5 },
    { name: "epsilon", value: 0o6 },
    { name: "pi", value: 0o7 },
    { name: "lambda", value: 0o10 },
    { name: "gamma", value: 0o11 },
    { name: "delta", value: 0o12 },
    { name: "up_arrow", value: 0o13 },
    { name: "uparrow", value: 0o13 },
    { name: "plus_minus", value: 0o14 },
    { name: "circle_plus", value: 0o15 },
    { name: "infinity", value: 0o16 },
    { name: "partial_delta", value: 0o17 },
    { name: "left_horseshoe", value: 0o20 },
    { name: "right_horseshoe", value: 0o21 },
    { name: "up_horseshoe", value: 0o22 },
    { name: "down_horseshoe", value: 0o23 },
    { name: "universal_quantifier", value: 0o24 },
    { name: "for_all", value: 0o24 },
    { name: "existential_quantifier", value: 0o25 },
    { name: "there_exists", value: 0o25 },
    { name: "circle_x", value: 0o26 },
    { name: "circle_cross", value: 0o26 },
    { name: "tensor", value: 0o26 },
    { name: "double_arrow", value: 0o27 },
    { name: "left_arrow", value: 0o30 },
    { name: "right_arrow", value: 0o31 },
    { name: "not_equal", value: 0o32 },
    { name: "not_equals", value: 0o32 },
    { name: "altmode", value: 0o33 },
    { name: "alt", value: 0o33 },
    { name: "diamond", value: 0o33 },
    { name: "less_or_equal", value: 0o34 },
    { name: "greater_or_equal", value: 0o35 },
    { name: "equivalence", value: 0o36 },
    { name: "or_sign", value: 0o37 },
    { name: "or", value: 0o37 },
    { name: "space", value: 0o40 },
    { name: "sp", value: 0o40 },
    { name: "integral", value: 0o177 },
    /* sigh. 259 > char-code-limit */
    { name: "coke_bottle",		(128 + 69},)
{ name: "cokebottle", (128 + 69},)

/*
 * X11 compatible names for keysyms.
 */

{ name: "exclam", value: 0o41 },
{ name: "quotedbl", value: 0o42 },
{ name: "numbersign", value: 0o43 },
{ name: "dollar", value: 0o44 },
{ name: "percent", value: 0o45 },
{ name: "ampersand", value: 0o46 },
{ name: "apostrophe", value: 0o47 },
{ name: "parenleft", value: 0o50 },
{ name: "parenright", value: 0o51 },
{ name: "asterisk", value: 0o52 },
{ name: "plus", value: 0o53 },
{ name: "comma", value: 0o54 },
{ name: "minus", value: 0o55 },
{ name: "period", value: 0o56 },
{ name: "slash", value: 0o57 },
{ name: "slash1", value: 0o57 },	 /* Knight keyboard has two keys for slash. */
{ name: "0", value: 0o60 },
{ name: "1", value: 0o61 },
{ name: "2", value: 0o62 },
{ name: "3", value: 0o63 },
{ name: "4", value: 0o64 },
{ name: "5", value: 0o65 },
{ name: "6", value: 0o66 },
{ name: "7", value: 0o67 },
{ name: "8", value: 0o70 },
{ name: "9", value: 0o71 },
{ name: "colon", value: 0o72 },
{ name: "semicolon", value: 0o73 },
{ name: "less", value: 0o74 },
{ name: "equal", value: 0o75 },
{ name: "greater", value: 0o76 },
{ name: "question", value: 0o77 },
{ name: "at", value: 0o100 },
{ name: "A", value: 0o101 },
{ name: "B", value: 0o102 },
{ name: "C", value: 0o103 },
{ name: "D", value: 0o104 },
{ name: "E", value: 0o105 },
{ name: "F", value: 0o106 },
{ name: "G", value: 0o107 },
{ name: "H", value: 0o110 },
{ name: "I", value: 0o111 },
{ name: "J", value: 0o112 },
{ name: "K", value: 0o113 },
{ name: "L", value: 0o114 },
{ name: "M", value: 0o115 },
{ name: "N", value: 0o116 },
{ name: "O", value: 0o117 },
{ name: "P", value: 0o120 },
{ name: "Q", value: 0o121 },
{ name: "R", value: 0o122 },
{ name: "S", value: 0o123 },
{ name: "T", value: 0o124 },
{ name: "U", value: 0o125 },
{ name: "V", value: 0o126 },
{ name: "W", value: 0o127 },
{ name: "X", value: 0o130 },
{ name: "Y", value: 0o131 },
{ name: "Z", value: 0o132 },
{ name: "bracketleft", value: 0o133 },
{ name: "backslash", value: 0o134 },
{ name: "bracketright", value: 0o135 },
{ name: "asciicircum", value: 0o136 },
{ name: "underscore", value: 0o137 },
{ name: "grave", value: 0o140 },
{ name: "a", value: 0o141 },
{ name: "b", value: 0o142 },
{ name: "c", value: 0o143 },
{ name: "d", value: 0o144 },
{ name: "e", value: 0o145 },
{ name: "f", value: 0o146 },
{ name: "g", value: 0o147 },
{ name: "h", value: 0o150 },
{ name: "i", value: 0o151 },
{ name: "j", value: 0o152 },
{ name: "k", value: 0o153 },
{ name: "l", value: 0o154 },
{ name: "m", value: 0o155 },
{ name: "n", value: 0o156 },
{ name: "o", value: 0o157 },
{ name: "p", value: 0o160 },
{ name: "q", value: 0o161 },
{ name: "r", value: 0o162 },
{ name: "s", value: 0o163 },
{ name: "t", value: 0o164 },
{ name: "u", value: 0o165 },
{ name: "v", value: 0o166 },
{ name: "w", value: 0o167 },
{ name: "x", value: 0o170 },
{ name: "y", value: 0o171 },
{ name: "z", value: 0o172 },
{ name: "braceleft", value: 0o173 },
{ name: "bar", value: 0o174 },
{ name: "braceright", value: 0o175 },
{ name: "asciitilde", value: 0o176 },
];