import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";
import quickjsWasm from "./quickjs.wasm";

type Enc = any;

interface EnvSnapshot {
  values: Record<string, Enc>;
  namespaces: Record<string, { data: Record<string, Enc>; methods: string[] }>;
  globals: Record<string, string>;
  asyncMethods: string[];
}

const MODULE_MEMORY_LIMIT = 64 * 1024 * 1024;
const MODULE_STACK_SIZE = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

let quickjsPromise: Promise<any> | null = null;

async function loadWasmModule(): Promise<WebAssembly.Module> {
  try {
    const imported = await import("./quickjs.wasm");
    const mod = (imported as any)?.default ?? imported;
    if (mod instanceof WebAssembly.Module) return mod;
  } catch {}
  const fs = await import("fs");
  const path = await import("path");
  const wasmPath = path.resolve(__dirname, "quickjs.wasm");
  const bytes = fs.readFileSync(wasmPath);
  const WasmModule = WebAssembly.Module as any;
  return new WasmModule(bytes);
}

async function getQuickJS(): Promise<any> {
  if (!quickjsPromise) {
    quickjsPromise = (async () => {
      const wasmModule = await loadWasmModule();
      const baseVariant = (await import("@jitl/quickjs-wasmfile-release-sync")).default;
      const variant = newVariant(baseVariant, { wasmModule });
      return await newQuickJSWASMModuleFromVariant(variant);
    })();
  }
  return quickjsPromise;
}

function isAsyncFn(fn: any): boolean {
  return typeof fn === "function" && fn.constructor?.name === "AsyncFunction";
}

function encodeValue(value: any, handles: Map<number, any>, seq: { n: number }): Enc {
  if (value === undefined) return { t: "u" };
  if (value === null) return { t: "null" };
  const type = typeof value;
  if (type === "number" || type === "boolean" || type === "string") return { t: "p", v: value };
  if (type === "bigint") return { t: "p", v: value.toString() };
  if (type === "function") return { t: "u" };
  if (value instanceof Uint8Array) return { t: "b", v: Array.from(value) };
  if (Array.isArray(value)) return { t: "a", v: value.map((x) => encodeValue(x, handles, seq)) };
  if (value instanceof Date) return { t: "p", v: value.toISOString() };
  if (type === "object") {
    const keys = Object.keys(value);
    const hasFn = keys.some((k) => typeof value[k] === "function");
    if (hasFn || keys.length === 0) {
      const id = seq.n++;
      handles.set(id, value);
      return { t: "h", id };
    }
    const out: Record<string, Enc> = {};
    for (const k of keys) out[k] = encodeValue(value[k], handles, seq);
    return { t: "o", v: out };
  }
  return { t: "u" };
}

function decodeValue(enc: Enc, handles: Map<number, any>): any {
  if (!enc) return undefined;
  switch (enc.t) {
    case "p": return enc.v;
    case "null": return null;
    case "u": return undefined;
    case "b": return new Uint8Array(enc.v || []);
    case "a": return (enc.v || []).map((x: Enc) => decodeValue(x, handles));
    case "o": {
      const out: Record<string, any> = {};
      for (const k of Object.keys(enc.v || {})) out[k] = decodeValue(enc.v[k], handles);
      return out;
    }
    case "h": return handles.get(enc.id);
    default: return undefined;
  }
}

function buildEnvSnapshot(env: Record<string, any>): EnvSnapshot {
  const snapshot: EnvSnapshot = { values: {}, namespaces: {}, globals: {}, asyncMethods: [] };
  const dummySeq = { n: 1000000 };
  const dummyHandles = new Map<number, any>();

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "function") {
      snapshot.globals[key] = key;
      if (isAsyncFn(value)) snapshot.asyncMethods.push(key);
      continue;
    }
    if (value && typeof value === "object") {
      const methods: string[] = [];
      const data: Record<string, Enc> = {};
      for (const [prop, propValue] of Object.entries(value)) {
        if (typeof propValue === "function") {
          methods.push(prop);
          if (isAsyncFn(propValue)) snapshot.asyncMethods.push(`${key}.${prop}`);
        } else {
          data[prop] = encodeValue(propValue, dummyHandles, dummySeq);
        }
      }
      if (methods.length > 0) {
        snapshot.namespaces[key] = { data, methods };
        continue;
      }
    }
    snapshot.values[key] = encodeValue(value, dummyHandles, dummySeq);
  }
  return snapshot;
}

const PRELUDE = String.raw`
(function () {
  const snapshot = JSON.parse(__LEGADO_ENV__);
  const asyncSet = new Set(snapshot.asyncMethods || []);
  const asyncHandleMethods = new Set(["doFinal", "getFinal", "update", "finish"]);
  const handles = [];
  function dec(e) {
    if (!e) return undefined;
    switch (e.t) {
      case "p": return e.v;
      case "null": return null;
      case "u": return undefined;
      case "b": return new Uint8Array(e.v || []);
      case "a": return (e.v || []).map(dec);
      case "o": { const o = {}; for (const k in (e.v || {})) o[k] = dec(e.v[k]); return o; }
      case "h": return mkHandle(e.id);
      default: return undefined;
    }
  }
  function enc(v) {
    if (v === undefined) return { t: "u" };
    if (v === null) return { t: "null" };
    const ty = typeof v;
    if (ty === "number" || ty === "boolean" || ty === "string") return { t: "p", v: v };
    if (ty === "function") return { t: "u" };
    if (v instanceof Uint8Array) return { t: "b", v: Array.from(v) };
    if (Array.isArray(v)) return { t: "a", v: v.map(enc) };
    if (ty === "object") {
      if (v.__hid !== undefined) return { t: "h", id: v.__hid };
      const o = {};
      for (const k in v) o[k] = enc(v[k]);
      return { t: "o", v: o };
    }
    return { t: "u" };
  }
  function callSync(path, args) {
    return dec(JSON.parse(__legadoCall(path, JSON.stringify(args.map(enc)))));
  }
  function callAsync(path, args) {
    return __legadoCallAsync(path, JSON.stringify(args.map(enc))).then(function (s) { return JSON.parse(s); }).then(dec);
  }
  function handleSync(id, method, args) {
    return dec(JSON.parse(__legadoHandle(id, method, JSON.stringify(args.map(enc)))));
  }
  function handleAsync(id, method, args) {
    return __legadoHandleAsync(id, method, JSON.stringify(args.map(enc))).then(function (s) { return JSON.parse(s); }).then(dec);
  }
  function mkHandle(id) {
    const target = function () {};
    return new Proxy(target, {
      get: function (t, p) {
        if (p === "__hid") return id;
        if (p === "then") return undefined;
        if (p === "toJSON") return function () { return {}; };
        if (p === "toString" || p === "valueOf") return function () { return String(id); };
        if (typeof p === "symbol") return undefined;
        return function () {
          const args = Array.prototype.slice.call(arguments);
          return asyncHandleMethods.has(String(p)) ? handleAsync(id, String(p), args) : handleSync(id, String(p), args);
        };
      },
      set: function () { return true; }
    });
  }
  function mkNamespace(prefix, baseData) {
    const base = dec(baseData) || {};
    return new Proxy(base, {
      get: function (t, p) {
        if (p === "then") return undefined;
        if (typeof p === "symbol") return t[p];
        if (Object.prototype.hasOwnProperty.call(t, p)) return t[p];
        const path = prefix ? prefix + "." + String(p) : String(p);
        return function () {
          const args = Array.prototype.slice.call(arguments);
          return asyncSet.has(path) ? callAsync(path, args) : callSync(path, args);
        };
      },
      set: function (t, p, v) { t[p] = v; return true; }
    });
  }
  globalThis.__dec = dec;
  globalThis.__mkNamespace = mkNamespace;
  globalThis.__callSync = callSync;

  for (const key in snapshot.values) {
    globalThis[key] = dec(snapshot.values[key]);
  }
  for (const key in snapshot.namespaces) {
    globalThis[key] = mkNamespace(key, snapshot.namespaces[key].data);
  }
  for (const key in snapshot.globals) {
    (function (k) {
      globalThis[k] = function () {
        const args = Array.prototype.slice.call(arguments);
        return asyncSet.has(k) ? callAsync(k, args) : callSync(k, args);
      };
    })(key);
  }
})();
`;

function resolvePath(root: any, path: string): { parent: any; fn: any } {
  const parts = path.split(".");
  let parent: any = root;
  let current: any = root;
  for (const part of parts) {
    parent = current;
    current = current == null ? undefined : current[part];
  }
  return { parent, fn: current };
}

function invokeHostFunction(root: any, path: string, args: any[]): any {
  const { parent, fn } = resolvePath(root, path);
  if (typeof fn !== "function") throw new Error(`Legado JS bridge: ${path} is not callable`);
  try {
    return fn.apply(parent, args);
  } catch (err: any) {
    if (typeof fn === "function" && String(err?.message || "").includes("constructor")) {
      return Reflect.construct(fn, args);
    }
    throw err;
  }
}

// Detect if code likely needs async execution
function needsAsyncExecution(code: string): boolean {
  return /await/.test(code) || /Promise/.test(code) || /java\.ajax/.test(code) || /java\.get\(/.test(code);
}

export async function evaluateLegadoJs(
  bodyCode: string,
  env: Record<string, any>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  remoteWebviewApi?: string
): Promise<any> {
  // Async JS rules (await java.ajax, etc.) cannot run in sync QuickJS.
  // Fall back to null so executeLegadoJs returns the original result.
  if (needsAsyncExecution(bodyCode)) {
    console.warn("Legado JS async execution not supported in sync QuickJS; rule will fall back to original result");
    return null;
  }

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MODULE_MEMORY_LIMIT);
  runtime.setMaxStackSize(MODULE_STACK_SIZE);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

  const context = runtime.newContext();
  const handles = new Map<number, any>();
  const handleSeq = { n: 1 };

  const wrapResult = (value: any): string => JSON.stringify(encodeValue(value, handles, handleSeq));

  const callFn = context.newFunction("__legadoCall", (pathHandle: any, argsHandle: any) => {
    const path = context.getString(pathHandle);
    const argsEnc = JSON.parse(context.getString(argsHandle) || "[]");
    const args = argsEnc.map((a: Enc) => decodeValue(a, handles));
    const result = invokeHostFunction(env, path, args);
    return context.newString(wrapResult(result));
  });
  const callAsyncFn = context.newFunction("__legadoCallAsync", (pathHandle: any, argsHandle: any) => {
    const path = context.getString(pathHandle);
    const argsEnc = JSON.parse(context.getString(argsHandle) || "[]");
    const args = argsEnc.map((a: Enc) => decodeValue(a, handles));
    const promise = invokeHostFunction(env, path, args).then((result) => {
      return context.newString(wrapResult(result));
    }).catch((e: any) => {
      return context.newString(JSON.stringify({ t: "e", v: String(e?.message || e) }));
    });
    return promise;
  });
  const handleFn = context.newFunction("__legadoHandle", (idHandle: any, methodHandle: any, argsHandle: any) => {
    const id = context.getNumber(idHandle);
    const method = context.getString(methodHandle);
    const argsEnc = JSON.parse(context.getString(argsHandle) || "[]");
    const args = argsEnc.map((a: Enc) => decodeValue(a, handles));
    const target = handles.get(id);
    if (!target) throw new Error(`Legado JS bridge: handle ${id} not found`);
    const fn = target[method];
    if (typeof fn !== "function") throw new Error(`Legado JS bridge: handle method ${method} not callable`);
    const result = fn.apply(target, args);
    return context.newString(wrapResult(result));
  });
  const handleAsyncFn = context.newFunction("__legadoHandleAsync", (idHandle: any, methodHandle: any, argsHandle: any) => {
    const id = context.getNumber(idHandle);
    const method = context.getString(methodHandle);
    const argsEnc = JSON.parse(context.getString(argsHandle) || "[]");
    const args = argsEnc.map((a: Enc) => decodeValue(a, handles));
    const target = handles.get(id);
    if (!target) throw new Error(`Legado JS bridge: handle ${id} not found`);
    const fn = target[method];
    if (typeof fn !== "function") throw new Error(`Legado JS bridge: handle method ${method} not callable`);
    const promise = Promise.resolve(fn.apply(target, args)).then((result) => {
      return context.newString(wrapResult(result));
    }).catch((e: any) => {
      return context.newString(JSON.stringify({ t: "e", v: String(e?.message || e) }));
    });
    return promise;
  });

  const snapshot = buildEnvSnapshot(env);
  const envHandle = context.newString(JSON.stringify(snapshot));
  context.setProp(context.global, "__legadoCall", callFn);
  context.setProp(context.global, "__legadoCallAsync", callAsyncFn);
  context.setProp(context.global, "__legadoHandle", handleFn);
  context.setProp(context.global, "__legadoHandleAsync", handleAsyncFn);
  context.setProp(context.global, "__LEGADO_ENV__", envHandle);
  callFn.dispose();
  callAsyncFn.dispose();
  handleFn.dispose();
  handleAsyncFn.dispose();
  envHandle.dispose();

  const disposeHandle = (h: any) => {
    try { if (h && h.alive !== false && typeof h.dispose === "function") h.dispose(); } catch {}
  };

  try {
    const preludeResult = context.evalCode(PRELUDE, "legado-prelude.js");
    if (preludeResult.error) throw new Error(`Legado JS prelude failed`);
    disposeHandle((preludeResult as any).value);

    // bodyCode still contains async/await from the original wrapper;
    // strip it by extracting just the execCode portion
    const wrapped = `(function() {\n${bodyCode}\n})()`;
    const evalResult: any = context.evalCode(wrapped, "legado.js");
    if (evalResult.error) {
      try {
        context.unwrapResult(evalResult);
      } catch (e: any) {
        console.warn("Legado JS execution error:", e?.message || String(e));
      }
      disposeHandle(evalResult.error);
      return null;
    }
    const valueHandle = evalResult.value;
    const dumped = context.dump(valueHandle);
    disposeHandle(valueHandle);
    return dumped;
  } catch (err: any) {
    console.warn("Legado JS execution error:", err?.message || err);
    return null;
  } finally {
    try { context.dispose(); } catch {}
    try { runtime.dispose(); } catch {}
  }
}

async function executeLegadoJsRemote(
  bodyCode: string,
  env: Record<string, any>,
  timeoutMs: number,
  remoteApi?: string
): Promise<any> {
  // No remote JS execution endpoint available yet.
  // Async JS rules (await java.ajax, etc.) fall back to null,
  // which lets executeLegadoJs return the original result.
  console.warn("Legado JS async execution not supported locally; rule will fall back to original result");
  return null;
}

export { needsAsyncExecution };
