import { extractTextFromHtml, stripHtml } from '/workspaces/reader-cf/worker/handlers/source-book.ts';
import * as fs from 'fs';

async function main() {
  const html = fs.readFileSync('/tmp/kilo/xbiquge_chapter.html', 'utf-8');
  
  // 第一步：extractTextFromHtml 提取 #txt@textNodes
  const step1 = extractTextFromHtml(html, '#txt@textNodes');
  console.log('Step 1 (extractTextFromHtml):', step1.length, 'chars');
  console.log('Preview:', JSON.stringify(step1.substring(0, 200)));

  // 第二步：应用 replaceRegex
  const replaceRegex = '##第.*章.*|[（(]本章未完.*[）)]';
  const { splitTopLevel } = await import('/workspaces/reader-cf/worker/handlers/source-book.ts');
  const parts = splitTopLevel(replaceRegex, ["##"]).parts;
  console.log('\nsplitTopLevel parts:', JSON.stringify(parts));
  
  let repPattern = parts[0];
  let repWith = parts[1] || "";
  if (!repPattern && repWith) {
    repPattern = repWith;
    repWith = "";
  }
  console.log('repPattern:', JSON.stringify(repPattern));
  console.log('repWith:', JSON.stringify(repWith));
  
  const afterReplace = step1.replace(new RegExp(repPattern, "g"), repWith);
  console.log('\nAfter replaceRegex:', afterReplace.length, 'chars');
  console.log('Preview:', JSON.stringify(afterReplace.substring(0, 200)));
}

main();
