"""Policy and recovery tests; no network, Docker or real credentials are used."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('github_deploy', Path(__file__).with_name('github-deploy.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
SHA = 'a' * 40
REPO = 'owner/repository'
RUN = {'id': 123, 'run_attempt': 1, 'workflow_id': 45, 'event': 'push', 'head_repository': {'full_name': REPO}, 'head_branch': 'master', 'head_sha': SHA, 'status': 'completed', 'conclusion': 'success'}


def bundle(extra=None, manifest=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('release.json', json.dumps(manifest or {'source_sha': SHA, 'run_id': 123, 'profile': 'web', 'api_base': '/api'}))
        for name in ('compose.yaml', 'deploy/scripts/release.sh', 'deploy/scripts/rollback.sh', 'apps/api/Dockerfile', 'apps/web/dist/index.html'):
            archive.writestr('source/' + name, 'synthetic fixture')
        if extra:
            archive.writestr(*extra)
    return output.getvalue()


def artifact(payload):
    return {'id': 67, 'name': 'release-bundle', 'expired': False, 'digest': 'sha256:' + hashlib.sha256(payload).hexdigest(), 'size_in_bytes': len(payload), 'workflow_run': {'id': 123, 'head_sha': SHA}}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='amie-cicd-test-')
        self.path = Path(self.temporary.name).resolve()
        self.assertEqual(self.path.parent, Path(tempfile.gettempdir()).resolve())
        self.managed = self.path / 'managed'
        self.state = self.path / 'state'
        self.state.mkdir()
        self.runtime = self.path / 'runtime.env'
        self.runtime.write_text('IMAGE_TAG=old-tag\nUNCHANGED=synthetic\n')
        (self.state / 'current-tag').write_text('old-tag\n')
        (self.state / 'previous-tag').write_text('older-tag\n')
        self.deployer = receiver.Deployer({'managed_root': str(self.managed), 'state_dir': str(self.state), 'runtime_env': str(self.runtime), 'repo': REPO, 'branch': 'master'})
        context = self.managed / 'bootstrap/source'
        context.mkdir(parents=True)
        self.active = {'current': {'tag': 'old-tag', 'source_dir': str(context)}, 'previous': {'tag': 'older-tag', 'source_dir': str(context)}}
        receiver.atomic_json(self.deployer.active_file, self.active)
        self.calls = []

    def tearDown(self):
        self.temporary.cleanup()

    def api(self, path):
        return {'actions/runs/123': RUN, 'actions/artifacts/67': artifact(self.payload), 'actions/workflows/ci.yml': {'id': 45}, 'git/ref/heads/master': {'object': {'sha': SHA}}}[path]

    def stream(self, payload):
        header = {'run_id': 123, 'artifact_id': 67, 'sha': SHA, 'token': 'synthetic_token_for_policy_tests', 'archive_size': len(payload)}
        return io.BytesIO(json.dumps(header).encode() + b'\n' + payload)

    def execute(self, item, build):
        self.calls.append((item['tag'], build, item['source_dir']))
        (self.state / 'current-tag').write_text(item['tag'] + '\n')

    def test_valid_source_and_ci_produce_unique_attempt_tag(self):
        payload = bundle()
        self.assertEqual(receiver.validate_release(RUN, artifact(payload), 45, SHA, REPO, 'master', SHA), 'sha-aaaaaaaa-ci-123-a1')

    def test_untrusted_runs_are_rejected(self):
        changes = [
            {'event': 'pull_request'}, {'head_repository': {'full_name': 'fork/repository'}},
            {'head_branch': 'feature'}, {'head_sha': 'b' * 40}, {'workflow_id': 99},
            {'conclusion': 'failure'}, {'status': 'in_progress'}, {'run_attempt': True},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(receiver.Rejected):
                receiver.validate_release({**RUN, **change}, artifact(bundle()), 45, SHA, REPO, 'master', SHA)
        with self.assertRaisesRegex(receiver.Rejected, 'superseded'):
            receiver.validate_release(RUN, artifact(bundle()), 45, 'b' * 40, REPO, 'master', SHA)

    def test_wrong_or_expired_artifacts_are_rejected(self):
        for change in [{'expired': True}, {'name': 'other'}, {'digest': ''}, {'workflow_run': {'id': 999, 'head_sha': SHA}}, {'workflow_run': {'id': 123, 'head_sha': 'b' * 40}}]:
            with self.subTest(change=change), self.assertRaises(receiver.Rejected):
                receiver.validate_release(RUN, {**artifact(bundle()), **change}, 45, SHA, REPO, 'master', SHA)

    def test_valid_bundle_extracts_web_and_source(self):
        archive = self.path / 'release.zip'
        archive.write_bytes(bundle())
        receiver.extract_bundle(archive, self.path / 'release', RUN)
        self.assertTrue((self.path / 'release/source/apps/web/dist/index.html').is_file())
        self.assertEqual((self.path / 'release/source/.deployment-source').read_text().strip(), SHA)
        if os.name == 'posix':
            self.assertTrue((self.path / 'release/source/deploy/scripts/release.sh').stat().st_mode & 0o111)

    def test_unsafe_archive_entries_are_rejected_before_writing(self):
        link = zipfile.ZipInfo('source/link')
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        backslash = zipfile.ZipInfo('source/escape')
        backslash.filename = backslash.orig_filename = 'source\\escape'
        for number, entry in enumerate([('source/../escape', 'bad'), ('/source/absolute', 'bad'), (backslash, 'bad'), ('source/.env', 'bad'), ('source/docs/06-legal/draft.md', 'bad'), (link, '/etc/passwd')]):
            with self.subTest(entry=str(entry[0])):
                archive = self.path / 'bad.zip'
                archive.write_bytes(bundle(entry))
                with self.assertRaises(receiver.Rejected):
                    receiver.extract_bundle(archive, self.path / ('rejected-' + str(number)), RUN)
                self.assertFalse((self.path / ('rejected-' + str(number))).exists())

    def test_wrong_manifest_is_rejected(self):
        archive = self.path / 'bad.zip'
        archive.write_bytes(bundle(manifest={'source_sha': 'b' * 40}))
        with self.assertRaisesRegex(receiver.Rejected, 'manifest_wrong_commit'):
            receiver.extract_bundle(archive, self.path / 'rejected', RUN)

    def test_verified_release_and_repeat_are_idempotent(self):
        self.payload = bundle()
        with patch.object(receiver, 'github', side_effect=lambda path, *_: self.api(path)), patch.object(self.deployer, 'execute', side_effect=self.execute):
            result = self.deployer.receive(self.stream(self.payload))
            self.assertEqual(result['status'], 'deployed')
            tag = result['tag']
            self.assertEqual(self.deployer.read_active()['previous']['tag'], 'old-tag')
            repeated = self.deployer.receive(self.stream(self.payload))
            self.assertEqual(repeated['status'], 'already_deployed')
            self.assertEqual(self.calls[0][1], True)
            self.assertEqual(self.calls[1][1], False)
            self.assertEqual((self.state / 'previous-tag').read_text().strip(), 'old-tag')
            self.assertIn('IMAGE_TAG=' + tag, self.runtime.read_text())

    def test_digest_mismatch_never_executes_release(self):
        self.payload = bundle()
        wrong = self.payload[:-1] + bytes([self.payload[-1] ^ 1])
        with patch.object(receiver, 'github', side_effect=lambda path, *_: self.api(path)), patch.object(self.deployer, 'execute', side_effect=self.execute):
            with self.assertRaisesRegex(receiver.Rejected, 'digest_mismatch'):
                self.deployer.receive(self.stream(wrong))
        self.assertEqual(self.calls, [])
        self.assertEqual(self.deployer.read_active(), self.active)

    def test_failed_candidate_restores_old_context_runtime_and_pointers(self):
        candidate = {'tag': 'candidate', 'source_dir': str(self.managed / 'candidate/source')}
        def fail_candidate(item, build):
            self.execute(item, build)
            if build:
                raise receiver.Rejected('release_failed')
        with patch.object(self.deployer, 'execute', side_effect=fail_candidate):
            with self.assertRaisesRegex(receiver.Rejected, 'release_failed'):
                self.deployer.switch(candidate, copy.deepcopy(self.active), True)
        self.assertEqual(self.calls[-1], ('old-tag', False, self.active['current']['source_dir']))
        self.assertEqual(self.deployer.read_active(), self.active)
        self.assertEqual(self.runtime.read_text(), 'IMAGE_TAG=old-tag\nUNCHANGED=synthetic\n')
        self.assertEqual((self.state / 'previous-tag').read_text().strip(), 'older-tag')

    def test_manual_source_changes_need_reconciliation(self):
        (self.state / 'current-tag').write_text('manual-change\n')
        with self.assertRaisesRegex(receiver.Rejected, 'reconciliation'):
            self.deployer.read_active()


if __name__ == '__main__':
    unittest.main()
