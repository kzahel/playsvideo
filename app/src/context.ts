type AppContext = 'webapp' | 'extension';

let _context: AppContext = 'webapp';

export function setAppContext(ctx: AppContext): void {
  _context = ctx;
}

export function isExtension(): boolean {
  return _context === 'extension';
}
