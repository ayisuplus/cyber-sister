"""Transport for one isolated task. All input/output remains untrusted to the API."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path('/workspace')
INPUT = ROOT / 'input'
OUTPUT = ROOT / 'output'
INPUT.mkdir(exist_ok=True)
OUTPUT.mkdir(exist_ok=True)
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 12 * 1024 * 1024


def main():
    payload = json.loads(sys.stdin.buffer.read(24 * 1024 * 1024))
    files = payload.get('files', [])
    if not isinstance(files, list) or len(files) > 8:
        raise ValueError('Invalid input count')
    total = 0
    for item in files:
        name = item['name']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,8}', name):
            raise ValueError('Invalid input filename')
        content = base64.b64decode(item['base64'], validate=True)
        total += len(content)
        if len(content) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise ValueError('Input too large')
        (INPUT / name).write_bytes(content)
    code = payload['code']
    if not isinstance(code, str) or len(code) > 32000:
        raise ValueError('Invalid code length')
    script = ROOT / 'task.py'
    script.write_text(code, encoding='utf-8')
    timed_out = False
    # Bounded tmpfs backs logs, avoiding unbounded in-process capture of user stdout.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen([sys.executable, '-I', str(script)], cwd=ROOT,
                                   stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   start_new_session=True)
        try:
            exit_code = process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, 9)
            process.wait()
            exit_code = 124
        stdout.seek(0)
        stderr.seek(0)
        log = stdout.read(16001)
        errors = stderr.read(8001)
    result = {'exitCode': exit_code, 'timedOut': timed_out,
              'stdout': log[:16000].decode('utf-8', errors='replace'),
              'stderr': errors[:8000].decode('utf-8', errors='replace'),
              'truncated': len(log) > 16000 or len(errors) > 8000, 'files': []}
    # Failed/partial runs never produce deliverable files.
    if exit_code == 0:
        total = 0
        for file in sorted(OUTPUT.iterdir()):
            if file.is_symlink() or not file.is_file():
                raise ValueError('Outputs must be regular files')
            size = file.stat().st_size
            total += size
            if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES or len(result['files']) >= 8:
                raise ValueError('Output limit exceeded')
            result['files'].append({'name': file.name, 'base64': base64.b64encode(file.read_bytes()).decode('ascii')})
    return result


try:
    print(json.dumps(main(), ensure_ascii=True))
except Exception:
    # Do not relay arbitrary parser exceptions or internal paths as infrastructure errors.
    print(json.dumps({'exitCode': 1, 'timedOut': False, 'stdout': '', 'stderr': 'Task input or output rejected', 'files': []}))
