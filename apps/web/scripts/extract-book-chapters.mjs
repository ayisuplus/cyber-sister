#!/usr/bin/env node
/**
 * 用阅读器自己的解析（src/lib/epub.js、plaintext.js）把一本书拆成章节，写成 JSON（路线图 C22 的本机核对用）：
 *
 *   node apps/web/scripts/extract-book-chapters.mjs <书.epub|书.txt> <输出.json>
 *
 * 和她在浏览器里放书时拿到的章节一模一样，上传给服务端的也是这份；locator 的章序、字符偏移因此对得上。
 * 输出里有全书正文：放在仓库外（比如临时目录），不要提交。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { readEpub } from '../src/lib/epub.js'
import { readPlainText } from '../src/lib/plaintext.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法：node apps/web/scripts/extract-book-chapters.mjs <书.epub|书.txt> <输出.json>')
  process.exit(1)
}

// Node 没有 DOMParser，借 jsdom 的；解压用 Node 自带的 DecompressionStream，和浏览器一样
globalThis.DOMParser = new JSDOM('').window.DOMParser
const bytes = readFileSync(input)
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const book = /\.epub$/i.test(input) ? await readEpub(buffer) : readPlainText(buffer)
writeFileSync(output, JSON.stringify(book), 'utf8')
const chars = book.chapters.reduce((sum, { text }) => sum + text.length, 0)
console.log(`${book.chapters.length} 章，${chars} 字 → ${output}`)
