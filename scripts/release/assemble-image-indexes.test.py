#!/usr/bin/env python3
"""Offline contract tests: registry and signing commands are replaced by local stubs."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
STUB = r'''#!/usr/bin/env python3
import base64, hashlib, json, os, pathlib, sys
args = sys.argv[1:]
command = pathlib.Path(sys.argv[0]).name
state = pathlib.Path(os.environ['STUB_STATE'])
mode = os.environ.get('STUB_MODE', '')
def flag(name): return args[args.index(name) + 1]
def encoded(value): return json.dumps(value, separators=(',', ':'))
def arch(ref): return 'amd64' if ref.endswith('a' * 64) else 'arm64'
def index_path(ref): return state / ('index-runtime' if 'runtime' in ref else 'index-web')
if command == 'docker':
    if args[:3] == ['buildx', 'imagetools', 'create']:
        tag = flag('--tag')
        children = args[-2:]
        manifests = [dict(digest=c.split('@')[1], platform=dict(os='linux', architecture=arch(c))) for c in children]
        if mode == 'index-platform': manifests[1]['platform']['architecture'] = 'amd64'
        index = dict(mediaType='application/vnd.oci.image.index.v1+json', manifests=manifests)
        index_path(tag).write_text(encoded(index))
    elif args[:3] == ['buildx', 'imagetools', 'inspect']:
        ref = args[-1] if '--format' in args else args[3]
        if ref.endswith('a' * 64) or ref.endswith('b' * 64):
            print(encoded(dict(mediaType='application/vnd.oci.image.manifest.v1+json')))
        else:
            stored_index = index_path(ref)
            if mode == 'existing-tag' and not stored_index.exists():
                print(encoded(dict(mediaType='application/vnd.oci.image.index.v1+json', manifests=[])))
                raise SystemExit(0)
            if mode == 'registry-error' and not stored_index.exists():
                print('registry request failed: connection reset', file=sys.stderr)
                raise SystemExit(1)
            if not stored_index.exists():
                print(f'{ref}: not found', file=sys.stderr)
                raise SystemExit(1)
            data = stored_index.read_text()
            digest = 'sha256:' + hashlib.sha256(data.encode()).hexdigest()
            if '--format' in args:
                manifest = json.loads(data)
                manifest['digest'] = digest
                print(encoded(manifest))
                raise SystemExit(0)
            if '@' in ref:
                assert ref.split('@')[1] == digest
            sys.stdout.write(data)
    elif args[:2] == ['image', 'inspect']:
        print('linux/' + ('riscv64' if mode == 'child-platform' else arch(args[2])))
    elif args[0] != 'pull': raise Exception(args)
elif command == 'syft':
    output = flag('-o').split('=', 1)[1]
    pathlib.Path(output).write_text(encoded(dict(bomFormat='CycloneDX', specVersion='1.6', version=1,
                                                metadata=dict(component=dict(name=args[0])))))
elif command == 'cosign':
    ref = args[-1]
    key = hashlib.sha256(ref.encode()).hexdigest()
    if args[0] == 'attest':
        typ = flag('--type')
        file = state / (key + typ)
        items = json.loads(file.read_text()) if file.exists() else []
        items.append(json.loads(pathlib.Path(flag('--predicate')).read_text()))
        file.write_text(encoded(items))
    elif args[0] == 'verify-attestation':
        typ = flag('--type')
        items = json.loads((state / (key + typ)).read_text())
        if mode == 'sbom-mismatch' and typ == 'cyclonedx': items = [dict(unrelated=True)]
        records = []
        for predicate in items:
            payload = base64.b64encode(encoded(dict(predicate=predicate)).encode()).decode()
            records.append(dict(payload=payload))
        if mode == 'attestation-array': print(encoded(records))
        else:
            for record in records: print(encoded(record))
    elif args[0] not in ('sign', 'verify'): raise Exception(args)
else: raise Exception(command)
'''


class IndexAssemblyTest(unittest.TestCase):
    def run_assembly(self, mode='', replace='false'):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / 'bin').mkdir()
            (work / 'state').mkdir()
            (work / 'digests').mkdir()
            stub = work / 'stub'
            stub.write_text(STUB)
            stub.chmod(0o755)
            for command in ('docker', 'syft', 'cosign'):
                (work / 'bin' / command).symlink_to(stub)
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
            for component in ('web', 'runtime'):
                for arch, digest in [('amd64', 'a' * 64), ('arm64', 'b' * 64)]:
                    record = dict(image=f'ghcr.io/flightdan/crewqual-{component}@sha256:{digest}',
                                  arch=arch, commit='wrong' if mode == 'commit-mismatch' else commit)
                    (work / 'digests' / f'{component}-{arch}.json').write_text(json.dumps(record))
            output = work / 'output'
            env = dict(os.environ, PATH=f"{work / 'bin'}:{os.environ['PATH']}", STUB_STATE=str(work / 'state'),
                       STUB_MODE=mode, RELEASE_TAG='v1.0.6-rc.1', GITHUB_REPOSITORY='FlightDan/crewqual',
                       RELEASE_REPLACE_EXISTING_ASSETS=replace,
                       GITHUB_WORKFLOW_REF='FlightDan/crewqual/.github/workflows/release-acceptance.yml@refs/heads/main',
                       GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1', GITHUB_OUTPUT=str(output))
            result = subprocess.run(['bash', str(ROOT / 'scripts/release/assemble-image-indexes.sh'),
                                     str(work / 'digests')], cwd=ROOT, env=env, text=True, capture_output=True)
            return result, output.read_text() if output.exists() else ''

    def test_success(self):
        result, output = self.run_assembly()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(output, r'web_image=ghcr.io/flightdan/crewqual-web@sha256:[a-f0-9]{64}\n')
        self.assertRegex(output, r'runtime_image=ghcr.io/flightdan/crewqual-runtime@sha256:[a-f0-9]{64}\n')

        array_result, array_output = self.run_assembly('attestation-array')
        self.assertEqual(array_result.returncode, 0, array_result.stderr)
        self.assertIn('web_image=', array_output)

    def test_reject_invalid_records_platforms_and_attestations(self):
        for mode in ('commit-mismatch', 'child-platform', 'index-platform', 'sbom-mismatch',
                     'existing-tag', 'registry-error'):
            with self.subTest(mode=mode):
                result, output = self.run_assembly(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, '')

    def test_existing_tag_replacement_requires_explicit_opt_in(self):
        rejected, _ = self.run_assembly('existing-tag')
        self.assertNotEqual(rejected.returncode, 0)
        accepted, output = self.run_assembly('existing-tag', replace='true')
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn('web_image=', output)


if __name__ == '__main__':
    unittest.main()
