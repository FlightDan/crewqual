#!/usr/bin/env python3
"""Exercise the pre-checkout gate and require parity with the shared validator."""
import os
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/release-acceptance.yml'


def inline_gate():
    text = WORKFLOW.read_text()
    start = text.index("          python3 - <<'PYTHON'\n")
    end = text.index("          PYTHON\n", start) + len("          PYTHON\n")
    return '\n'.join(line[10:] for line in text[start:end].splitlines()) + '\n'


def named_step_script(name):
    text = WORKFLOW.read_text()
    step = text.split(f'      - name: {name}\n', 1)[1].split('\n      - ', 1)[0]
    body = step.split('        run: |\n', 1)[1]
    return '\n'.join(line[10:] if line.startswith('          ') else line
                     for line in body.splitlines()) + '\n'


class WorkflowInputsTest(unittest.TestCase):
    def test_gate_and_helper_agree(self):
        cases = [
            ('v1.0.6-rc.1', 'rc', 'local', '', True),
            ('v1.0.6-rc.2', 'rc', 'local', 'v1.0.6-rc.1', True),
            ('v1.0.6-rc.0', 'rc', 'full', '', True),
            ('v1.0.6', 'final', 'full', '', True),
            ('v1.0.6', 'final', 'local', 'v1.0.5', False),
            ('v1.0.6-rc.10', 'rc', 'local', 'v1.0.6-rc.9', True),
            ('v1.0.6-rc.1', 'rc', 'local', 'v1.0.5-rc.99', True),
            ('v1.0.6-rc.1', 'final', 'local', '', False),
            ('v1.0.6', 'rc', 'local', '', False),
            ('v1.0.6-rc.1', 'rc', 'local', 'v1.0.5', False),
            ('v1.0.6', 'final', 'local', 'v1.0.5-rc.1', False),
            ('v1.0.6-rc.1', 'rc', 'local', 'v1.0.6-rc.1', False),
            ('v1.0.6-rc.1', 'rc', 'local', 'v1.0.6-rc.2', False),
            ('v1.0.6-rc.1', 'rc', 'local', 'main', False),
            ('v1.0.6', 'final', 'other', '', False),
            ('v1.0.6', 'other', 'local', '', False),
        ]
        for tag in ['main', 'v01.0.6', 'v1.0.6-rc.01', 'v1.0.6-rc.-1',
                    'v1.0.6-rc.1;echo unsafe', 'v1.0.6-rc.1\n',
                    ' v1.0.6-rc.1', 'v1.0.6-beta.1', 'v1.0.6+build']:
            cases.append((tag, 'rc', 'local', '', False))
        # Both implementations must compare large versions without integer overflow.
        cases.append(('v999999999999999999999999.0.0-rc.1', 'rc', 'local',
                      'v999999999999999999999998.0.0-rc.1', True))
        huge = '9' * 5000
        cases.append((f'v{huge}.0.0-rc.1', 'rc', 'local',
                      f'v1.0.0-rc.1', True))
        for tag, profile, scope, baseline, valid in cases:
            with self.subTest(tag=tag, profile=profile, scope=scope, baseline=baseline):
                with tempfile.NamedTemporaryFile() as output:
                    env = dict(os.environ, RELEASE_TAG=tag, RELEASE_PROFILE=profile,
                               RELEASE_ACCEPTANCE_SCOPE=scope, RELEASE_UPGRADE_FROM_TAG=baseline,
                               GITHUB_OUTPUT=output.name)
                    gate = subprocess.run(['bash'], input=inline_gate(), env=env,
                                          text=True, capture_output=True)
                    helper = subprocess.run(['bash', str(ROOT / 'scripts/release/validate-release-inputs.sh'),
                                             tag, profile, scope, baseline], text=True, capture_output=True)
                    self.assertEqual(gate.returncode == 0, valid, gate.stderr)
                    self.assertEqual(helper.returncode == 0, valid, helper.stderr)
                    if valid:
                        mode = 'upgrade' if baseline else 'fresh'
                        self.assertEqual(helper.stdout.strip(), mode)
                        self.assertEqual(Path(output.name).read_text(),
                                         f'target={tag}\nbaseline={baseline}\nmode={mode}\n')
                    else:
                        self.assertEqual(Path(output.name).read_text(), '')

    def test_gate_precedes_checkout(self):
        text = WORKFLOW.read_text()
        gate = text.split('  validate-inputs:\n', 1)[1].split('  acceptance-config:\n', 1)[0]
        self.assertIn('permissions: {}', gate)
        for forbidden in ['uses:', 'secrets.', 'environment:', 'id-token:', 'checkout']:
            # Comments describe why checkout is absent and are not executable.
            executable = '\n'.join(line for line in gate.splitlines() if not line.lstrip().startswith('#'))
            self.assertNotIn(forbidden, executable)
        config = text.split('  acceptance-config:\n', 1)[1].split('  build-platform-images:\n', 1)[0]
        self.assertIn('needs: validate-inputs', config)
        self.assertLess(config.index('validate-release-inputs.sh'), config.index('pnpm install'))
        self.assertLess(config.index('git verify-tag'), config.index('pnpm install'))
        self.assertLess(config.index('git verify-tag'), config.index('validate-release-inputs.sh'))
        self.assertLess(config.index('Preflight signed upgrade baseline release'),
                        config.index('pnpm install'))
        self.assertIn('commit: ${{ steps.tag.outputs.commit }}', config)
        self.assertIn('tag_object: ${{ steps.tag.outputs.tag_object }}', config)
        self.assertIn('baseline_commit: ${{ steps.tag.outputs.baseline_commit }}', config)
        self.assertIn('baseline_tag_object: ${{ steps.tag.outputs.baseline_tag_object }}', config)

    def test_validated_commit_and_no_clobber_flow_forward(self):
        text = WORKFLOW.read_text()
        self.assertGreaterEqual(text.count('ref: ${{ needs.acceptance-config.outputs.commit }}'), 4)
        self.assertIn('needs: [acceptance-config, build-platform-images]', text)
        self.assertIn('needs: [acceptance-config, build-images]', text)
        self.assertIn('needs: [acceptance-config, acceptance]', text)
        self.assertIn('needs: [acceptance-config, publish]', text)
        self.assertIn('release tag moved after validation', text)
        self.assertIn('unable to prove the GitHub Release is absent', text)
        self.assertIn('RELEASE_REPLACE_EXISTING_ASSETS: ${{ inputs.replace_existing_assets }}', text)
        self.assertIn(
            'EXPECTED_BASELINE_COMMIT: ${{ needs.acceptance-config.outputs.baseline_commit }}',
            text,
        )

    def test_upgrade_baseline_is_signed_and_deployable_before_builds(self):
        text = WORKFLOW.read_text()
        config = text.split('  acceptance-config:\n', 1)[1].split('  build-platform-images:\n', 1)[0]
        self.assertGreaterEqual(config.count('verify_signed_tag'), 3)
        self.assertIn('verify_signed_tag "$RELEASE_UPGRADE_FROM_TAG"', config)
        self.assertIn('upgrade baseline tag differs from the validated signed object', config)
        for asset in (
            'update-manifest-v1.json', 'update-manifest-v1.json.sig', 'SHA256SUMS.sig',
            'crewqual-updater-linux-amd64', 'crewqual-updater-linux-arm64',
            'docker-compose.install.yml', 'Caddyfile', 'configure-domain.sh',
            'evidence.json', 'evidence.json.sig', 'evidence.bundle.json',
        ):
            self.assertIn(asset, config)
        self.assertLess(text.index('Preflight signed upgrade baseline release'),
                        text.index('docker buildx build --pull'))

    def test_upgrade_baseline_preflight_fails_closed(self):
        required = [
            'update-manifest-v1.json', 'update-manifest-v1.json.sig', 'SHA256SUMS',
            'SHA256SUMS.sig', 'crewqual-updater-linux-amd64',
            'crewqual-updater-linux-arm64', 'docker-compose.install.yml', 'Caddyfile',
            'configure-domain.sh', 'evidence.json', 'evidence.json.sig',
            'evidence.bundle.json',
        ]
        release = dict(tagName='v1.0.6-rc.1', isDraft=False, isPrerelease=True,
                       assets=[dict(name=name, size=1) for name in required])
        with tempfile.TemporaryDirectory() as directory:
            fake_gh = Path(directory) / 'gh'
            fake_gh.write_text('''#!/usr/bin/env python3
import os, sys
if os.environ.get("GH_MODE") == "network-error":
    print("network unavailable", file=sys.stderr)
    raise SystemExit(1)
if sys.argv[1] == "api": print(os.environ["REMOTE_TAG_OBJECT"])
elif sys.argv[1:3] == ["release", "view"]: print(os.environ["RELEASE_JSON"])
else: raise SystemExit(2)
''')
            fake_gh.chmod(0o755)
            base = dict(os.environ, PATH=f'{directory}:{os.environ["PATH"]}',
                        RELEASE_UPGRADE_FROM_TAG='v1.0.6-rc.1',
                        GITHUB_REPOSITORY='FlightDan/crewqual',
                        VALIDATED_BASELINE_TAG_OBJECT='a' * 40,
                        REMOTE_TAG_OBJECT='a' * 40,
                        RELEASE_JSON=json.dumps(release))
            script = named_step_script('Preflight signed upgrade baseline release')
            accepted = subprocess.run(['bash'], input=script, env=base, text=True,
                                      capture_output=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            missing = dict(release)
            missing['assets'] = release['assets'][:-1]
            rejected = subprocess.run(['bash'], input=script,
                                      env=dict(base, RELEASE_JSON=json.dumps(missing)),
                                      text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            mismatch = subprocess.run(['bash'], input=script,
                                       env=dict(base, REMOTE_TAG_OBJECT='b' * 40),
                                       text=True, capture_output=True)
            self.assertNotEqual(mismatch.returncode, 0)
            unavailable = subprocess.run(['bash'], input=script,
                                          env=dict(base, GH_MODE='network-error'),
                                          text=True, capture_output=True)
            self.assertNotEqual(unavailable.returncode, 0)

    def test_local_config_step_has_no_full_infrastructure_secrets(self):
        text = WORKFLOW.read_text()
        config = text.split('  acceptance-config:\n', 1)[1].split('  build-platform-images:\n', 1)[0]
        local = text.split('      - name: Validate local release acceptance configuration\n', 1)[1]
        local = local.split('      - name: Validate full release acceptance configuration\n', 1)[0]
        for name in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_ENDPOINT',
                     'DATABASE_URL', 'RESTORE_DATABASE_URL'):
            self.assertNotIn(name, local)
        self.assertLess(config.index('git verify-tag'), config.index('pnpm install'))
        self.assertIn('pnpm install --frozen-lockfile --ignore-scripts', config)
        # Secret entries must be nested under steps, never workflow/job env.
        for line in text.splitlines():
            if 'secrets.' in line:
                self.assertGreaterEqual(len(line) - len(line.lstrip()), 10)


if __name__ == '__main__':
    unittest.main()
