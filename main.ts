// Tiny stack VM for make.fun tiny-stack-vm-01-run-20261122.
// Faithful interpreter of the kit ISA (ISA.md, reference vm.mjs): 32-bit
// wrapping ints, 256-value stack, 256 words of memory, ten traps with their
// own exit codes, 1,000,000 step limit, 65,536 byte output cap. Where the ISA
// text and vm.mjs could be read two ways, this follows vm.mjs exactly.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table, encoded as 5 characters per opcode: 2 hex digits of the
// opcode byte, then immediate bytes, values popped, values pushed (each 0-4).
// Decodes into IMM (immediate bytes, -1: no such opcode), POP and PSH.
const IMM = new Int8Array(256).fill(-1);
const POP = new Int8Array(256);
const PSH = new Int8Array(256);
const T = '0000001101024010301004012050220602307033100211102112021130211402115021160211701118021190211a0211b0111c0211d0211e0212002121021220213020031210322103320034000400114102050010510105200153010';
for (let k = 0; k < T.length; k += 5) {
  const b = parseInt(T.slice(k, k + 2), 16);
  IMM[b] = +T[k + 2]; POP[b] = +T[k + 3]; PSH[b] = +T[k + 4];
}

// Run one program on its input. Returns { o: output bytes, c: exit code }.
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const fin = (code) => ({ o: out.subarray(0, ol), c: code });
  for (;;) {
    if (steps === 1000000) return fin(10);
    if (pc < 0 || pc >= n) return fin(9);
    const b = p[pc];
    const imm = IMM[b];
    if (imm < 0) return fin(5);
    if (pc + imm >= n) return fin(9);
    steps++;
    const nx = pc + 1 + imm;
    if (sp < POP[b]) return fin(2);
    if (sp - POP[b] + PSH[b] > 256) return fin(3);
    pc = nx;
    switch (b) {
      case 0x00:
        return fin(0);
      case 0x01:
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = -D[sp - 1];
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const bv = D[sp - 1];
        const av = D[sp - 2];
        let r;
        if (b === 0x10) r = (av + bv) | 0;
        else if (b === 0x11) r = (av - bv) | 0;
        else if (b === 0x12) r = Math.imul(av, bv);
        else if (b === 0x13) {
          if (bv === 0) return fin(4);
          r = av === -2147483648 && bv === -1 ? av : (av / bv) | 0;
        } else if (b === 0x14) {
          if (bv === 0) return fin(4);
          r = bv === -1 ? 0 : (av % bv) | 0;
        } else if (b === 0x15) {
          if (bv === 0) return fin(4);
          r = Math.floor((av >>> 0) / (bv >>> 0));
        } else if (b === 0x16) {
          if (bv === 0) return fin(4);
          r = ((av >>> 0) % (bv >>> 0)) | 0;
        } else if (b === 0x18) r = av & bv;
        else if (b === 0x19) r = av | bv;
        else if (b === 0x1a) r = av ^ bv;
        else if (b === 0x1c) r = av << (bv & 31);
        else if (b === 0x1d) r = av >> (bv & 31);
        else if (b === 0x1e) r = av >>> (bv & 31);
        else if (b === 0x20) r = av === bv ? 1 : 0;
        else if (b === 0x21) r = av < bv ? 1 : 0;
        else r = (av >>> 0) < (bv >>> 0) ? 1 : 0;
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = b === 0x30;
        if (b !== 0x30) {
          const v = D[--sp];
          take = b === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return fin(7);
        C[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return fin(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return fin(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = D[sp - 1];
        const v = D[sp - 2];
        if (a < 0 || a >= 256) return fin(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (ol + s.length > 65536) return fin(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return fin(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return fin(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const rd = (f) => { try { return readFileSync(f); } catch { return new Uint8Array(0); } };
for (const id of readdirSync(I).sort()) {
  const r = run(rd(join(I, id, 'program.bin')), rd(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), String(r.c) + '\n');
}
