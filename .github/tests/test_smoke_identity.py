"""PLAT-04 · OP-01..OP-05: el paso de espera del smoke TEST sólo aprueba el commit y el servicio correctos."""
import os, pathlib, subprocess, tempfile, json
import yaml

SERVICE = os.environ.get('EXPECTED_SERVICE_FOR_TEST')
wf = yaml.safe_load(pathlib.Path('.github/workflows/smoke-test.yml').read_text())
step = next(s for s in wf['jobs']['smoke-test']['steps'] if str(s.get('name', '')).startswith('Esperar a que TEST sirva'))
service = step['env']['EXPECTED_SERVICE']
assert 'grep -q' not in step['run'], 'OP-03: no se acepta el SHA en cualquier parte del cuerpo'
sha = 'a' * 40
old = 'b' * 40

cases = [  # nombre, código HTTP, cuerpo, ¿debe aprobar?
  ('ok-plano', 200, {'service': service, 'commit': sha}, True),
  ('ok-envelope', 200, {'data': {'service': service, 'commit': sha}}, True),
  ('OP-01 commit vacío', 200, {'service': service, 'commit': ''}, False),
  ('OP-01 commit null', 200, {'data': {'service': service, 'commit': None}}, False),
  ('OP-02 sha anterior', 200, {'service': service, 'commit': old}, False),
  ('OP-03 sha en otro campo', 200, {'service': service, 'commit': '', 'requestId': sha}, False),
  ('OP-03 sha como prefijo', 200, {'service': service, 'commit': sha[:12]}, False),
  ('OP-04 servicio equivocado', 200, {'service': 'otro-servicio', 'commit': sha}, False),
  ('OP-05 JSON inválido', 200, 'no-json', False),
  ('OP-05 503', 503, {'service': service, 'commit': sha}, False),
  ('OP-05 redirección', 302, {'service': service, 'commit': sha}, False),
]
with tempfile.TemporaryDirectory() as d:
    root = pathlib.Path(d); (root/'bin').mkdir()
    curl = root/'bin'/'curl'
    curl.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
a = sys.argv[1:]
pathlib.Path(a[a.index('--output') + 1]).write_text(os.environ['FAKE_BODY'])
print(os.environ['FAKE_CODE'], end='')
''')
    curl.chmod(0o755)
    for name, code, body, should_pass in cases:
        work = root/name.replace(' ', '_'); work.mkdir()
        script = work/'step.sh'; script.write_text(step['run'])
        env = os.environ | {'PATH': f'{root/"bin"}:{os.environ["PATH"]}', 'TARGET_SHA': sha,
          'SMOKE_BASE_URL': 'http://fake', 'VERSION_PATH': '/v', 'EXPECTED_SERVICE': service,
          'SMOKE_WAIT_SECONDS': '0', 'SMOKE_POLL_SECONDS': '0', 'FAKE_CODE': str(code),
          'FAKE_BODY': body if isinstance(body, str) else json.dumps(body)}
        r = subprocess.run(['bash', str(script)], env=env, cwd=work, capture_output=True, text=True, encoding='utf-8', errors='replace')
        assert (r.returncode == 0) == should_pass, (name, r.returncode, r.stdout, r.stderr)
        diag = json.loads((work/'smoke-diagnostics'/'identity.json').read_text())
        assert diag['result'] == ('identity-ok' if should_pass else 'identity-failed'), (name, diag)
        print(f'{name}: exit={r.returncode} ✓')
print('OP-09: el diagnóstico se conserva también al fallar')
text = pathlib.Path('.github/workflows/smoke-test.yml').read_text()
assert 'smoke-diagnostics-test-' in text and 'if: always()' in text
