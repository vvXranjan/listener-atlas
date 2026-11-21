import { describe, it, expect } from 'vitest';
import { clampBox, snapBox } from '../src/FloatWindow.jsx';

describe('Floating window', () => {
  it('always stays fully on screen', () => {
    const b = clampBox({ x: -300, y: 2000, w: 400, h: 500 }, 1440, 900);
    expect(b.x).toBe(12);
    expect(b.y).toBe(900 - 500 - 12);
    const big = clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, 1440, 900);
    expect(big.w).toBe(1440 - 24);
    expect(big.h).toBe(900 - 24);
    const tiny = clampBox({ x: 10, y: 10, w: 50, h: 50 }, 1440, 900);
    expect(tiny.w).toBe(320);
  });

  it('snaps to a corner when let go close to it', () => {
    const near = snapBox({ x: 1440 - 400 - 40, y: 900 - 500 - 30, w: 400, h: 500 }, 1440, 900);
    expect(near).toMatchObject({ x: 1440 - 400 - 12, y: 900 - 500 - 12 }); // bottom-right
    const middle = snapBox({ x: 500, y: 200, w: 400, h: 500 }, 1440, 900);
    expect(middle).toMatchObject({ x: 500, y: 200 }); // stays where you put it
  });
});
