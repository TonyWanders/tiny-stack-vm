// Tiny stack VM for make.fun tiny-stack-vm-01-run-20261122.
// Faithful interpreter of the kit ISA: 32-bit wrapping ints, 256-value stack,
// 256 words of memory, ten traps, 1,000,000 step limit, 65,536 byte output cap.
// Where ISA.md and the reference VM could be read two ways, this follows vm.mjs exactly.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table: immediate length, values popped, values pushed. -1 means no
// such opcode. Indexed by opcode byte.
const IMM = new Int8Array(256).fill(-1);
const POP = new Int8Array(256);
const PSH = new Int8Array(256);
for (const [b, i, p, q] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
]) { IMM[b] = i; POP[b] = p; PSH[b] = q; }

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
for (const id of readdirSync(I).sort()) {
  let prog = new Uint8Array(0);
  let inp = new Uint8Array(0);
  try { prog = readFileSync(join(I, id, 'program.bin')); } catch {}
  try { inp = readFileSync(join(I, id, 'input.bin')); } catch {}
  const r = run(prog, inp);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), String(r.c) + '\n');
}
