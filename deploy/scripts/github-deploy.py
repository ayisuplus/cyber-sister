#!/usr/bin/python3 -I
"""Root-owned, fixed-command receiver for a verified GitHub CI release bundle."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_UNPACKED = 256 * 1024 * 1024
CONFIG = Path('/etc/amie/github-deploy.json')


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.next')
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def validate_release(run, artifact, workflow_id, head, repo, branch, sha):
    require(re.fullmatch(r'[a-f0-9]{40}', sha or ''), 'invalid_sha')
    require(run.get('workflow_id') == workflow_id, 'wrong_workflow')
    require(run.get('event') == 'push', 'untrusted_event')
    require(run.get('head_repository', {}).get('full_name') == repo, 'untrusted_repository')
    require(run.get('head_branch') == branch and run.get('head_sha') == sha, 'wrong_ref')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'success', 'ci_not_successful')
    require(head == sha, 'superseded_commit')
    require(artifact.get('name') == 'release-bundle' and artifact.get('expired') is False, 'missing_artifact')
    require(artifact.get('workflow_run', {}).get('id') == run['id'], 'artifact_wrong_run')
    require(artifact.get('workflow_run', {}).get('head_sha') == sha, 'artifact_wrong_commit')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', artifact.get('digest', '')), 'artifact_digest_unavailable')
    require(0 < artifact.get('size_in_bytes', 0) <= MAX_ARCHIVE, 'artifact_too_large')
    attempt = run.get('run_attempt')
    require(type(attempt) is int and attempt > 0, 'invalid_run_attempt')
    tag = 'sha-{}-ci-{}-a{}'.format(sha[:8], run['id'], attempt)
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,62}', tag), 'invalid_tag')
    return tag


def extract_bundle(archive, destination, run):
    """Validate the whole ZIP before writing; only deployment source is accepted."""
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        require(len(entries) <= 10000, 'too_many_files')
        require(sum(item.file_size for item in entries) <= MAX_UNPACKED, 'bundle_too_large')
        names = set()
        for item in entries:
            name = item.filename.rstrip('/')
            parts = name.split('/')
            require(item.orig_filename == item.filename, 'unsafe_zip_path')
            require(name and not name.startswith('/') and '\\' not in name and ':' not in name, 'unsafe_zip_path')
            require('\x00' not in item.orig_filename and all(p not in ('', '.', '..') for p in parts), 'unsafe_zip_path')
            require(name not in names, 'duplicate_zip_path')
            names.add(name)
            require(name == 'release.json' or parts[0] == 'source', 'unexpected_bundle_path')
            require(not (name.startswith('source/docs/') or '.git' in parts or 'node_modules' in parts), 'forbidden_bundle_path')
            require(not name.startswith('source/apps/api/data/'), 'forbidden_bundle_path')
            require(all(not p.startswith('.env') or p == '.env.example' for p in parts), 'forbidden_bundle_path')
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(mode in (0, stat.S_IFREG, stat.S_IFDIR), 'special_zip_entry')
            require(not item.flag_bits & 1, 'encrypted_zip_entry')
        files = {item.filename for item in entries if not item.is_dir()}
        for name in names:
            parts = name.split('/')
            require(all('/'.join(parts[:i]) not in files for i in range(1, len(parts))), 'conflicting_zip_paths')
        require('release.json' in names and 'source/apps/web/dist/index.html' in names, 'incomplete_bundle')
        require(bundle.getinfo('release.json').file_size <= 16384, 'manifest_too_large')
        manifest = json.loads(bundle.read('release.json'))
        require(manifest.get('source_sha') == run['head_sha'], 'manifest_wrong_commit')
        require(manifest.get('run_id') == run['id'], 'manifest_wrong_run')
        require(manifest.get('profile') == 'web' and manifest.get('api_base') == '/api', 'wrong_web_profile')
        for relative in ('compose.yaml', 'deploy/scripts/release.sh', 'deploy/scripts/rollback.sh', 'apps/api/Dockerfile'):
            require('source/' + relative in names, 'incomplete_bundle')
        destination.mkdir(parents=True, exist_ok=True)
        for item in entries:
            target = destination.joinpath(*PurePosixPath(item.filename).parts)
            require(target.resolve().is_relative_to(destination.resolve()), 'unsafe_zip_path')
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                os.chmod(target, 0o755 if target.suffix == '.sh' else 0o644)
        (destination / 'source/.deployment-source').write_text(run['head_sha'] + '\n')
    return manifest


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def github(path, token, repo):
    request = urllib.request.Request('https://api.github.com/repos/' + repo + '/' + path, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'amie-deploy',
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError):
        raise Rejected('github_verification_failed') from None


class Deployer:
    def __init__(self, config):
        self.config = config
        self.root = Path(config['managed_root'])
        self.state_dir = Path(config['state_dir'])
        self.runtime = Path(config['runtime_env'])
        self.active_file = self.root / 'active.json'
        for directory in (self.root, self.root / 'releases', self.root / 'logs', self.root / 'incoming'):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)

    def read_active(self):
        active = json.loads(self.active_file.read_text())
        require((self.state_dir / 'current-tag').read_text().strip() == active['current']['tag'], 'manual_release_needs_reconciliation')
        for item in (active['current'], active.get('previous')):
            if item:
                require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,62}', item['tag']), 'invalid_saved_tag')
                require(Path(item['source_dir']).resolve().is_relative_to(self.root.resolve()), 'invalid_saved_source')
        return active

    def runtime_for(self, tag):
        lines = self.runtime.read_text().splitlines()
        require(sum(line.startswith('IMAGE_TAG=') for line in lines) == 1, 'runtime_tag_missing')
        return '\n'.join('IMAGE_TAG=' + tag if line.startswith('IMAGE_TAG=') else line for line in lines) + '\n'

    def execute(self, item, build):
        """Each release uses its own proxy/Compose files and matching runtime tag."""
        with tempfile.NamedTemporaryFile(dir=self.root, prefix='runtime-', mode='w', encoding='utf-8') as runtime:
            runtime.write(self.runtime_for(item['tag']))
            runtime.flush()
            env = {**os.environ, 'RUNTIME_ENV_FILE': runtime.name, 'STATE_DIR': str(self.state_dir), 'IMAGE_TAG': item['tag']}
            script = 'release.sh' if build else 'rollback.sh'
            args = ['bash', str(Path(item['source_dir']) / 'deploy/scripts' / script)]
            if not build:
                args.append(item['tag'])
            with (self.root / 'logs' / (item['tag'] + '-' + script + '.log')).open('ab') as log:
                result = subprocess.run(args, cwd=item['source_dir'], env=env, stdout=log, stderr=subprocess.STDOUT)
            require(result.returncode == 0, 'release_failed' if build else 'rollback_failed')

    def commit_state(self, active):
        temporary = self.root / 'runtime-committed.env'
        temporary.write_text(self.runtime_for(active['current']['tag']))
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.runtime)
        (self.state_dir / 'current-tag').write_text(active['current']['tag'] + '\n')
        previous = self.state_dir / 'previous-tag'
        if active.get('previous'):
            previous.write_text(active['previous']['tag'] + '\n')
        else:
            previous.unlink(missing_ok=True)
        atomic_json(self.active_file, active)

    def switch(self, target, old, build):
        try:
            self.execute(target, build)
            self.commit_state({'current': target, 'previous': old['current']})
        except Exception:
            self.execute(old['current'], False)
            self.commit_state(old)
            raise

    def receive(self, stream):
        header = stream.readline(16385)
        require(len(header) <= 16384 and header.endswith(b'\n'), 'invalid_header')
        request = json.loads(header)
        require(set(request) == {'run_id', 'artifact_id', 'sha', 'token', 'archive_size'}, 'invalid_header')
        for field in ('run_id', 'artifact_id', 'archive_size'):
            require(type(request[field]) is int and request[field] > 0, 'invalid_header')
        require(request['archive_size'] <= MAX_ARCHIVE, 'artifact_too_large')
        require(isinstance(request['token'], str) and re.fullmatch(r'[A-Za-z0-9_.-]{20,1024}', request['token']), 'invalid_token_format')
        repo, branch = self.config['repo'], self.config['branch']
        api = lambda path: github(path, request['token'], repo)
        run = api('actions/runs/' + str(request['run_id']))
        artifact = api('actions/artifacts/' + str(request['artifact_id']))
        workflow = api('actions/workflows/ci.yml')
        head = api('git/ref/heads/' + branch)['object']['sha']
        tag = validate_release(run, artifact, workflow['id'], head, repo, branch, request['sha'])
        active = self.read_active()
        with tempfile.TemporaryDirectory(dir=self.root / 'incoming', prefix='bundle-') as incoming:
            archive = Path(incoming) / 'release.zip'
            digest = hashlib.sha256()
            remaining = request['archive_size']
            with archive.open('wb') as output:
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    require(chunk, 'truncated_bundle')
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
            require(not stream.read(1), 'extra_bundle_bytes')
            require('sha256:' + digest.hexdigest() == artifact['digest'], 'artifact_digest_mismatch')
            release = self.root / 'releases' / tag
            receipt = release / 'receipt.json'
            if receipt.exists():
                target = json.loads(receipt.read_text())
                require(target['source_sha'] == request['sha'] and target['artifact_digest'] == artifact['digest'], 'existing_release_mismatch')
                require(Path(target['source_dir']).resolve() == (release / 'source').resolve(), 'invalid_saved_source')
                if active['current']['tag'] == tag:
                    self.execute(target, False)
                else:
                    self.switch(target, active, False)
                return {'status': 'already_deployed' if active['current']['tag'] == tag else 'restored', 'tag': tag, 'source_sha': request['sha']}
            require(not release.exists(), 'incomplete_release_rerun_ci')
            release.mkdir(mode=0o700)
            extract_bundle(archive, release, run)
            target = {'tag': tag, 'source_dir': str(release / 'source'), 'source_sha': request['sha'], 'artifact_digest': artifact['digest'], 'ci_run_id': run['id']}
            self.switch(target, active, True)
            atomic_json(receipt, target)
            return {'status': 'deployed', 'tag': tag, 'source_sha': request['sha']}

    def bootstrap(self, source):
        require(not self.active_file.exists(), 'already_initialized')
        context = self.root / 'bootstrap' / 'source'
        for name in ('compose.yaml', 'compose.qwen.yaml', 'deploy/compose.server.yaml', 'deploy/compose.tunnel.yaml', 'deploy/nginx.conf', 'deploy/nginx.tunnel.conf', 'deploy/scripts/common.sh', 'deploy/scripts/rollback.sh'):
            original = source / name
            if original.exists():
                target = context / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, target)
        tag = (self.state_dir / 'current-tag').read_text().strip()
        previous = self.state_dir / 'previous-tag'
        record = lambda value: {'tag': value, 'source_dir': str(context), 'source_sha': None, 'kind': 'bootstrap'}
        atomic_json(self.active_file, {'current': record(tag), 'previous': record(previous.read_text().strip()) if previous.exists() else None})
        return {'status': 'initialized', 'tag': tag}


def main():
    require(os.name == 'posix' and os.geteuid() == 0, 'root_required')
    os.umask(0o077)
    require(CONFIG.stat().st_uid == 0 and CONFIG.stat().st_mode & 0o022 == 0, 'unsafe_config_permissions')
    config = json.loads(CONFIG.read_text())
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', config['repo']), 'invalid_repo_config')
    require(re.fullmatch(r'[A-Za-z0-9_-]+', config['branch']), 'invalid_branch_config')
    deployer = Deployer(config)
    import fcntl
    with (deployer.root / 'deploy.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Rejected('deployment_in_progress') from None
        if sys.argv[1:] == ['--rollback']:
            active = deployer.read_active()
            require(active.get('previous'), 'no_previous_release')
            deployer.switch(active['previous'], active, False)
            result = {'status': 'rolled_back', 'tag': active['previous']['tag']}
        elif len(sys.argv) == 3 and sys.argv[1] == '--init':
            result = deployer.bootstrap(Path(sys.argv[2]))
        else:
            require(len(sys.argv) == 1, 'invalid_arguments')
            result = deployer.receive(sys.stdin.buffer)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Rejected as error:
        print(json.dumps({'status': 'rejected', 'code': str(error)}), flush=True)
        sys.exit(1)
    except Exception:
        print(json.dumps({'status': 'error', 'code': 'receiver_error'}), flush=True)
        sys.exit(1)
