import * as trace from './trace';
import * as fs from 'fs';
import * as readline from 'readline';

export enum SymbolType {
    I_MEM = "I-MEM",
    D_MEM = "D-MEM",
    A_MEM = "A-MEM",
    M_MEM = "M-MEM",
    NUMBER = "NUMBER",
}

export class Symbol {
    name = "";
    value = 0;
    symType = SymbolType.NUMBER;

    constructor(name: string, value: number, symType: SymbolType) {
        this.name = name;
        this.value = value;
        this.symType = symType;
    }
}

export class SymbolTable {
    name: string = "symtab";
    symbols = new Map<string, Symbol>();
}

export function sym_add(tab: SymbolTable, symType: SymbolType, name: string, value: number) {
    tab.symbols.set(name, new Symbol(name, value, symType));
}

export function sym_find_by_type_val(tab: SymbolTable, symType: SymbolType, v: number): string | undefined {
    // Original found nearest value, not sure if that's required
    // We may need to use linked list instead of hash table to emulate.
    for (var symbol of tab.symbols.values()) {
        if (symbol.symType === symType) {
            if (symbol.value = v) {
                return symbol.name;
            }
        }
    }
    return undefined;
}

export function sym_find(tab: SymbolTable, name:string): number | undefined {
    return tab.symbols.get(name)?.value;
}

/*
 * Read a CADR MCR symbol file.
 *
 * This very much expects a correctly formated symbol file, and does
 * not try to handle anything else very gracefully.  See
 * WRITE-SYMBOL-TABLE from SYS: UCADR; QWMCR LISP and
 * CONS-DUMP-SYMBOLS from SYS: SYS; CDMP LISP for details.
 *
 * Returns false if it couldn't parse the file successfully.
 */
export function
sym_read_file(tab: SymbolTable, filename: string): boolean 
{
    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
	const f = fs.openSync(filename, "r");
    if (f <= 0) {
		trace.warning(trace.USIM, `failed to open: ${filename}`);
		return false;
	}
	tab.name = filename;

    // Hopefully the file is not too large.
    // I can't believe there isn't a readline function for node.
    const data = fs.readFileSync(f, {encoding: "utf8"});
    const lines = data.split("\n");

    if (!lines[1].startsWith("-4 ")) {
        trace.error(trace.USIM, "sym_read_file: failed to find assembler state info section (-4)");
        fs.close(f);
        return false;
    }
	/*
	 * First symbol is handled specially, since directly after the
	 * -2 marker the symbol, type and address follows.
	 */
    let words = lines[2].split(' ');
    if (words.length != 4 || words[0] != "-2") {
        trace.error(trace.USIM, "sym_read_file: failed to find symbol dump section (-2)");
        fs.close(f);
        return false;
    }
    sym_add(tab, lines[2] as SymbolType, lines[1], parseInt(lines[3], 8));
    
    let index = 3;

    while ((lines[index].startsWith("-1 ")) === false) {
        words = lines[3].split(' ');
        sym_add(tab, lines[2] as SymbolType, lines[1], parseInt(lines[3], 8));

    }
    fs.close(f);
    return true;
}



