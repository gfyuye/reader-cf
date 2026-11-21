import { evaluateLegadoJs } from "/workspaces/reader-cf/worker/js-vm";

async function main(){
  const env = { 
    result: "x", 
    baseUrl: "https://e.com/", 
    testAsync: async (x: string) => "OK:" + x,
  };
  console.log("Test: direct await on asyncified function");
  const r = await evaluateLegadoJs(`
    result = await __legadoCallAsync('testAsync', ['hello']);
    return result;
  `, env);
  console.log("R=", JSON.stringify(r));
}
main().catch(e => { console.error("ERR", e); process.exit(1); });
