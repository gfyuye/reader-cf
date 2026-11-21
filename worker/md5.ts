/**
 * Pure JavaScript MD5 implementation (RFC 1321).
 * All arithmetic uses & 0xffffffff for correct 32-bit unsigned behavior.
 */

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function add32(a: number, b: number): number {
  return (a + b) >>> 0;
}

function F(x: number, y: number, z: number): number {
  return ((x & y) | ((~x) & z)) >>> 0;
}
function G(x: number, y: number, z: number): number {
  return ((x & z) | (y & (~z))) >>> 0;
}
function H(x: number, y: number, z: number): number {
  return (x ^ y ^ z) >>> 0;
}
function I(x: number, y: number, z: number): number {
  return (y ^ (x | (~z))) >>> 0;
}

function md5Core(X: number[]): string {
  const T: number[] = [];
  for (let i = 0; i < 64; i++) T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  const s: number[] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const k2 = [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12];
  const k3 = [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2];
  const k4 = [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9];

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

  for (let chunk = 0; chunk < X.length / 16; chunk++) {
    const base = chunk * 16;
    let A = a, B = b, C = c, D = d;

    // Round 1: F
    for (let i = 0; i < 16; i++) {
      const regs = i % 4 === 0 ? [A, B, C, D] : i % 4 === 1 ? [D, A, B, C] : i % 4 === 2 ? [C, D, A, B] : [B, C, D, A];
      const [aa, bb, cc, dd] = regs;
      const temp = (aa + F(bb, cc, dd) + X[base + k1[i]] + T[i]) >>> 0;
      const rot = ((temp << s[i]) | (temp >>> (32 - s[i]))) >>> 0;
      const sum = (rot + bb) >>> 0;
      if (i % 4 === 0) A = sum; else if (i % 4 === 1) D = sum; else if (i % 4 === 2) C = sum; else B = sum;
    }

    // Round 2: G
    for (let i = 0; i < 16; i++) {
      const regs = i % 4 === 0 ? [A, B, C, D] : i % 4 === 1 ? [D, A, B, C] : i % 4 === 2 ? [C, D, A, B] : [B, C, D, A];
      const [aa, bb, cc, dd] = regs;
      const temp = (aa + G(bb, cc, dd) + X[base + k2[i]] + T[16 + i]) >>> 0;
      const rot = ((temp << s[16 + i]) | (temp >>> (32 - s[16 + i]))) >>> 0;
      const sum = (rot + bb) >>> 0;
      if (i % 4 === 0) A = sum; else if (i % 4 === 1) D = sum; else if (i % 4 === 2) C = sum; else B = sum;
    }

    // Round 3: H
    for (let i = 0; i < 16; i++) {
      const regs = i % 4 === 0 ? [A, B, C, D] : i % 4 === 1 ? [D, A, B, C] : i % 4 === 2 ? [C, D, A, B] : [B, C, D, A];
      const [aa, bb, cc, dd] = regs;
      const temp = (aa + H(bb, cc, dd) + X[base + k3[i]] + T[32 + i]) >>> 0;
      const rot = ((temp << s[32 + i]) | (temp >>> (32 - s[32 + i]))) >>> 0;
      const sum = (rot + bb) >>> 0;
      if (i % 4 === 0) A = sum; else if (i % 4 === 1) D = sum; else if (i % 4 === 2) C = sum; else B = sum;
    }

    // Round 4: I
    for (let i = 0; i < 16; i++) {
      const regs = i % 4 === 0 ? [A, B, C, D] : i % 4 === 1 ? [D, A, B, C] : i % 4 === 2 ? [C, D, A, B] : [B, C, D, A];
      const [aa, bb, cc, dd] = regs;
      const temp = (aa + I(bb, cc, dd) + X[base + k4[i]] + T[48 + i]) >>> 0;
      const rot = ((temp << s[48 + i]) | (temp >>> (32 - s[48 + i]))) >>> 0;
      const sum = (rot + bb) >>> 0;
      if (i % 4 === 0) A = sum; else if (i % 4 === 1) D = sum; else if (i % 4 === 2) C = sum; else B = sum;
    }

    a = add32(a, A);
    b = add32(b, B);
    c = add32(c, C);
    d = add32(d, D);
  }

  function wordToHex(v: number): string {
    let s = "";
    for (let i = 0; i < 4; i++) {
      const byte = (v >>> (i * 8)) & 0xff;
      s += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return s;
  }

  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return bytes;
}

function latin1Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) bytes.push(input.charCodeAt(i) & 0xff);
  return bytes;
}

function prepareWords(bytes: number[]): number[] {
  const bitLen = bytes.length * 8;
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  // Append 64-bit little-endian length. Use explicit shifts to avoid
  // JS >>> masking shift count to 5 bits (8 >>> 32 === 8, not 0).
  padded.push(bitLen & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff, 0, 0, 0, 0);

  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(
      (padded[i] |
        (padded[i + 1] << 8) |
        (padded[i + 2] << 16) |
        (padded[i + 3] << 24)) >>> 0
    );
  }
  return words;
}

export function md5Hex(string: string): string {
  return md5Core(prepareWords(utf8Bytes(string)));
}

export function md5HexLatin1(string: string): string {
  return md5Core(prepareWords(latin1Bytes(string)));
}
