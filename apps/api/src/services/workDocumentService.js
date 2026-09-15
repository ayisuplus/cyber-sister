import { runWorkPython } from './workExecutionService.js'
import { HttpError } from '../utils/dbHelpers.js'

// Fixed parsers run under the same limits as generated code; document content is never executed on the API host.
const EXTRACT_DOCUMENT = `
from pathlib import Path
import json
source = next(Path('/workspace/input').iterdir())
parts = []
size = 0
limited = False
def add(text):
    global size, limited
    text = str(text)
    remaining = 120000 - size
    if len(text) > remaining:
        limited = True
    parts.append(text[:remaining])
    size += min(len(text), remaining)
    return size < 120000
if source.suffix == '.pdf':
    from pypdf import PdfReader
    reader = PdfReader(source)
    limited = len(reader.pages) > 100
    for index, page in enumerate(reader.pages[:100]):
        if not add(f'\\n[Page {index + 1}]\\n' + (page.extract_text() or '')): break
elif source.suffix == '.xlsx':
    from openpyxl import load_workbook
    book = load_workbook(source, read_only=True, data_only=True)
    limited = len(book.worksheets) > 30
    for sheet in book.worksheets[:30]:
        if size >= 120000: break
        add(f'\\n[Sheet: {sheet.title}]\\n')
        limited = limited or (sheet.max_row or 0) > 1000 or (sheet.max_column or 0) > 60
        for index, row in enumerate(sheet.iter_rows(max_row=min(sheet.max_row or 1000, 1000), max_col=min(sheet.max_column or 60, 60), values_only=True)):
            if not add(str(index + 1) + ': ' + '\\t'.join('' if cell is None else str(cell) for cell in row) + '\\n'): break
    book.close()
elif source.suffix == '.docx':
    from docx import Document
    document = Document(source)
    for paragraph in document.paragraphs:
        if not add(paragraph.text + '\\n'): break
    for table in document.tables:
        if size >= 120000: break
        for row in table.rows:
            if not add(' | '.join(cell.text for cell in row.cells) + '\\n'): break
elif source.suffix == '.pptx':
    from pptx import Presentation
    presentation = Presentation(source)
    limited = len(presentation.slides) > 100
    for index, slide in enumerate(presentation.slides):
        if index >= 100 or size >= 120000: break
        add(f'\\n[Slide {index + 1}]\\n')
        for shape in slide.shapes:
            if shape.has_text_frame:
                if not add(shape.text + '\\n'): break
            elif shape.has_table:
                for row in shape.table.rows:
                    if not add(' | '.join(cell.text for cell in row.cells) + '\\n'): break
else:
    raise ValueError('Unsupported document')
Path('/workspace/output/extracted.txt').write_text(''.join(parts), encoding='utf-8')
print(json.dumps({'limited': limited or size >= 120000}))
`

export async function extractWorkDocument(userId, artifact, context = {}) {
  if (!['pdf', 'xlsx', 'docx', 'pptx'].includes(artifact.format)) throw new HttpError('该文件没有可直接提取的正文；图片请通过照片入口发送', 400)
  const run = await runWorkPython(userId, { code: EXTRACT_DOCUMENT, files: [{ name: `document.${artifact.format}`, base64: artifact.content }] }, context)
  const output = run.files.find((file) => file.name === 'extracted.txt')
  if (run.exitCode !== 0 || typeof output?.base64 !== 'string' || output.base64.length > 700000) throw new HttpError('文档无法解析，可能已加密、损坏或超过解析限制', 400)
  let details
  try { details = JSON.parse(run.stdout) } catch { throw new HttpError('文档解析未完成', 400) }
  return { content: Buffer.from(output.base64, 'base64').toString('utf8').slice(0, 120000), truncated: details.limited === true }
}
