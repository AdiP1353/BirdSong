import { describe, expect, it } from 'vitest';
import { phoneUrlProblem } from '../src/components/JoinQr.tsx';

describe('the phone QR address', () => {
  it('accepts an https LAN address', () => {
    expect(phoneUrlProblem('https://192.168.1.9:3443/app/')).toBeNull();
    expect(phoneUrlProblem('https://me.github.io/birdsong/')).toBeNull();
  });
  it('explains localhost and plain http', () => {
    expect(phoneUrlProblem('http://localhost:3200/app/')).toMatch(/localhost/);
    expect(phoneUrlProblem('https://127.0.0.1:3443/app/')).toMatch(/localhost/);
    expect(phoneUrlProblem('http://192.168.1.9:3200/app/')).toMatch(/https/);
    expect(phoneUrlProblem('nonsense')).toMatch(/PWA_URL/);
  });
});
