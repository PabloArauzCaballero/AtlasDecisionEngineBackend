"""Ejercita la resolución del dominio público sin consultar Coolify ni desplegar."""
import os
import pathlib
import subprocess
import tempfile

import yaml

workflow = yaml.safe_load(pathlib.Path('.github/workflows/deploy-dev.yml').read_text())
steps = workflow['jobs']['deploy']['steps']
names = [s.get('name') for s in steps]
assert names.index('Smoke del motor publicado') > names.index('Deploy and wait for Coolify')
step = next(s for s in steps if s.get('name') == 'Smoke del motor publicado')

with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    script = root / 'smoke.sh'
    script.write_text(step['run'])
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    curl = bin_dir / 'curl'
    curl.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
assert args[-1].endswith('/applications/app-1'), args[-1]
out = pathlib.Path(args[args.index('--output') + 1])
out.write_text(json.dumps({'docker_compose_domains': json.dumps({'api': {'domain': 'https://api.example.test:3000'}})}))
print('403' if os.environ.get('MOCK_DENY_READ') == '1' else '200', end='')
''')
    curl.chmod(0o755)
    node = bin_dir / 'node'
    node.write_text('''#!/usr/bin/env python3
import os, pathlib
pathlib.Path(os.environ['MOCK_SMOKE_LOG']).write_text(os.environ['SMOKE_BASE_URL'])
''')
    node.chmod(0o755)

    for name, extra, expected, url in [
        ('coolify-domain', {}, 0, 'https://api.example.test'),
        ('read-denied', {'MOCK_DENY_READ': '1'}, 1, None),
        ('explicit-override', {'DEV_SMOKE_BASE_URL': 'https://override.example.test'}, 0, 'https://override.example.test'),
    ]:
        log = root / f'{name}.log'
        env = os.environ | {
            'PATH': f'{bin_dir}:{os.environ["PATH"]}',
            'MOCK_SMOKE_LOG': str(log),
            'COOLIFY_DEPLOY_WEBHOOK': 'http://host:8000/api/v1/deploy?uuid=app-1&force=false',
            'COOLIFY_API_TOKEN': 'test-token',
            'COOLIFY_API': 'http://host:8000/api/v1',
            'TARGET_SHA': 'a' * 40,
            'DEV_SMOKE_BASE_URL': '',
        } | extra
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
        assert result.returncode == expected, (name, result.stdout, result.stderr)
        assert (log.read_text() if log.exists() else None) == url, name
        print(f'{name}: exit={result.returncode}, url={url}')
