export function tv_read(offset: number): number {
  return 0;
}
export function tv_write(offset: number, bits: number): void {}
export function tv_xbus_write(offset: number, bits: number): void {}

export function tv_xbus_read(offset: number): number {
  throw new Error("Function not implemented.");
  return 0;
}

export function tv_poll() {
  throw new Error('Function not implemented.');
}

