import { parseContentWithRules, extractTextFromHtml } from '/workspaces/reader-cf/worker/handlers/source-book.ts';
import * as fs from 'fs';

const html = fs.readFileSync('/workspaces/reader-cf/browser_migu2.html', 'utf-8');
const source = JSON.parse(fs.readFileSync('/workspaces/booksource/split_by_type/webview/⚡📂️咪咕阅读.json', 'utf-8'));

// Step 1: extractTextFromHtml directly
const direct = extractTextFromHtml(html, '.readContent@html');
console.log('Step 1 - extractTextFromHtml:', direct.length, 'chars');
console.log('  Preview:', JSON.stringify(direct.substring(0, 200)));

// Step 2: Check what parseContentWithRules does internally
const ruleContent = source?.ruleContent || {};
console.log('Step 2 - ruleContent.content:', JSON.stringify(ruleContent.content));
console.log('Step 2 - ruleContent.replaceRegex:', JSON.stringify(ruleContent.replaceRegex));

// Step 3: Test stripHtml on the direct result
function stripHtml(html: string): string {
  if (!html) return "";
  let s = html;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote|pre|section|article)\s*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s;
}

const stripped = stripHtml(direct);
console.log('Step 3 - stripHtml result:', stripped.length, 'chars');
console.log('  Preview:', JSON.stringify(stripped.substring(0, 200)));

// Step 4: Test replaceRegex
const replaceRegex = ruleContent.replaceRegex;
if (replaceRegex) {
  const { splitTopLevel } = await import('/workspaces/reader-cf/worker/handlers/source-book.ts');
  const parts = splitTopLevel(replaceRegex, ["##"]).parts;
  console.log('Step 4 - splitTopLevel parts:', JSON.stringify(parts));
  let repPattern = parts[0] || "";
  let repWith = parts[1] || "";
  if (!repPattern && repWith) {
    repPattern = repWith;
    repWith = "";
  }
  console.log('Step 4 - repPattern:', JSON.stringify(repPattern), 'repWith:', JSON.stringify(repWith));
  
  try {
    const afterReplace = direct.replace(new RegExp(repPattern, "g"), repWith);
    console.log('Step 4 - After replaceRegex:', afterReplace.length, 'chars');
    const afterStrip = stripHtml(afterReplace);
    console.log('Step 4 - After stripHtml:', afterStrip.length, 'chars');
    console.log('  Preview:', JSON.stringify(afterStrip.substring(0, 200)));
  } catch (e) {
    console.log('Step 4 - Error:', e.message);
  }
}
