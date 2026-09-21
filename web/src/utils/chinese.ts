// 简繁转换工具 - 移植自 reader-fr 的 chinese.js (opencc-js)

interface TrieNode {
  children: Map<number, TrieNode>
  trie_val?: string
}

const __converterExports: any = {}
;(function (e: any) {
  "use strict"
  class t {
    map: TrieNode
    constructor() { this.map = { children: new Map(), trie_val: undefined } }
    addWord(e: string, word: string) {
      let n: TrieNode = this.map
      for (const a of e) {
        const codePoint = a.codePointAt(0)
        if (codePoint === undefined) continue
        let child = n.children.get(codePoint)
        if (child === undefined) {
          const newNode: TrieNode = { children: new Map(), trie_val: undefined }
          n.children.set(codePoint, newNode)
          n = newNode
        } else {
          n = child
        }
        n.trie_val = word
      }
    }
    loadDict(e: any) {
      if ("string" === typeof e) {
        e = e.split("|")
        for (const t of e) {
          const [e, n] = t.split(" ")
          this.addWord(e, n)
        }
      } else for (let t of e) {
        const [e, n] = t
        this.addWord(e, n)
      }
    }
    loadDictGroup(e: any[]) { e.forEach(e => { this.loadDict(e) }) }
    convert(e: string) {
      const t = this.map
      const n = e.length
      const a: string[] = []
      let u: number | null = null
      for (let o = 0; o < n; ) {
        let r: string | null = null
        let i: TrieNode = t
        let s = 0
        for (let t = o; t < n; ) {
          const codePoint = e.codePointAt(t)
          if (codePoint === undefined) break
          t += codePoint > 65535 ? 2 : 1
          const a = i.children.get(codePoint)
          if (a === undefined) break
          i = a
          const u = i.trie_val
          if (u !== undefined) { s = t, r = u }
        }
        s > 0 ? (u !== null && (a.push(e.slice(u, o)), u = null), a.push(r!), o = s) : (u === null && (u = o), o += (e.codePointAt(o) ?? 0) > 65535 ? 2 : 1)
      }
      return u !== null && a.push(e.slice(u, n)), a.join("")
    }
  }
  function n(...e: any[]) {
    const converters = e.map(e => { const n = new t; return n.loadDictGroup(e), n })
    function a(e: string) { return converters.reduce((e, t) => t.convert(e), e) }
    return a
  }
  function a(e: any) { return function(t: any) { let a: any[] = []; return ["from", "to"].forEach(n => { if ("string" !== typeof t[n]) throw new Error("Please provide the `" + n + "` option"); "t" !== t[n] && a.push(e[n][t[n]]) }), n.apply(null, a) } }
  function u(e: any) { return n([e]) }
  e.Converter = a({ cn: { zhs: n }, tw: { zht: n } })
  e.HTMLConverter = function(e: any, t: any, n: any, a: any) {
    function u() {
      function u(t: any, o: any) {
        if (t.nodeType !== Node.ELEMENT_NODE || !t.classList.contains("ignore-opencc")) {
          if (t.lang === n ? (o = !0, t.shouldChangeLang = !0, t.lang = a) : t.lang && t.lang.length && (o = !1), o) {
            if ("SCRIPT" === t.tagName) return
            if ("STYLE" === t.tagName) return
            if ("META" === t.tagName && "description" === t.name) return
            if ("META" === t.tagName && "keywords" === t.name) return
            if ("IMG" === t.tagName) return
            if ("INPUT" === t.tagName && "button" === t.type) return
            if ("TEXTAREA" === t.tagName) return
          }
          for (const n of t.childNodes) {
            if (n.nodeType === Node.TEXT_NODE && o) {
              const t = n
              if (t.originalString === undefined) t.originalString = t.nodeValue
              t.nodeValue = e(t.originalString!)
            } else u(n, o)
          }
        }
      }
      u(t, !1)
    }
    return { convert: u }
  }
})(__converterExports)

const { Converter, HTMLConverter } = __converterExports

// 繁体 → 简体（台湾/香港用语 → 大陆简体）
export function simplifed(e: any) {
  const t = Converter({ from: "tw", to: "cn" })
  if (typeof e === "string") return t(e)
  const n = HTMLConverter(t, e, "", "zh-CN")
  n.convert()
  const n2 = HTMLConverter(t, e, "zh-TW", "zh-CN")
  n2.convert()
}

// 简体 → 繁体（大陆简体 → 台湾/香港繁体）
export function traditionalized(e: any) {
  const t = Converter({ from: "cn", to: "tw" })
  if (typeof e === "string") return t(e)
  const n = HTMLConverter(t, e, "", "zh-TW")
  n.convert()
  const n2 = HTMLConverter(t, e, "zh-CN", "zh-TW")
  n2.convert()
}