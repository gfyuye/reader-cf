const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_PREFIX = "$pbkdf2$";

export async function pbkdf2Hash(password: string, salt: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const arr = Array.from(new Uint8Array(bits));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function genSecurePassword(password: string, salt: string): Promise<string> {
  const hash = await pbkdf2Hash(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${hash}`;
}

export async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    const parts = storedHash.split("$");
    const iterations = parseInt(parts[2], 10);
    const hash = parts[3];
    const computed = await pbkdf2Hash(password, salt, iterations);
    return computed === hash;
  }
  // Fallback for legacy double-md5 format
  const md5 = (await import("./md5")).md5Hex;
  const h1 = md5(md5(password) + salt);
  const h2 = md5(password + salt);
  return h1 === storedHash || h2 === storedHash;
}

export async function decryptAes128Cbc(base64Cipher: string, keyStr: string, ivStr: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr.padEnd(16, "\0").slice(0, 16)),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const iv = enc.encode(ivStr.padEnd(16, "\0").slice(0, 16));
  const bin = atob(base64Cipher);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, buf);
  return new TextDecoder().decode(plain);
}

export async function encryptAes128Cbc(plaintext: string, keyStr: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr.padEnd(16, "\0").slice(0, 16)),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const plain = enc.encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, plain);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  const ivB64 = btoa(String.fromCharCode(...iv));
  return ivB64 + ":" + b64;
}

export async function decryptWebdavPassword(stored: string, keyStr: string): Promise<string> {
  if (!stored) return "";
  try {
    if (stored.includes(":")) {
      const [ivB64, data] = stored.split(":");
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(keyStr.padEnd(16, "\0").slice(0, 16)),
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      const ivBin = atob(ivB64);
      const iv = new Uint8Array(ivBin.length);
      for (let i = 0; i < ivBin.length; i++) iv[i] = ivBin.charCodeAt(i);
      const dataBin = atob(data);
      const buf = new Uint8Array(dataBin.length);
      for (let i = 0; i < dataBin.length; i++) buf[i] = dataBin.charCodeAt(i);
      const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, buf);
      return new TextDecoder().decode(plain);
    }
  } catch {}
  return stored;
}
