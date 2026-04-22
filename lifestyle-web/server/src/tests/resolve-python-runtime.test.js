const { resolvePythonRuntime } = require('../utils/resolve-python-runtime');

describe('resolvePythonRuntime', () => {
  it('prefers an explicit environment override', () => {
    expect(
      resolvePythonRuntime({
        envOverride: '/custom/python',
        existsSync: (targetPath) => targetPath === '/custom/python',
        commandExistsFn: () => false,
      })
    ).toBe('/custom/python');
  });

  it('ignores an invalid environment override and falls back', () => {
    expect(
      resolvePythonRuntime({
        envOverride: '/missing/python',
        existsSync: () => false,
        commandExistsFn: (command) => command === 'python3',
      })
    ).toBe('python3');
  });

  it('prefers the local POSIX virtualenv when present', () => {
    expect(
      resolvePythonRuntime({
        localVenvPython: '/tmp/.venv/bin/python',
        localVenvWindowsPython: 'C:\\tmp\\.venv\\Scripts\\python.exe',
        existsSync: (targetPath) => targetPath === '/tmp/.venv/bin/python',
        commandExistsFn: () => true,
      })
    ).toBe('/tmp/.venv/bin/python');
  });

  it('falls back to python3 before python when no local virtualenv exists', () => {
    expect(
      resolvePythonRuntime({
        existsSync: () => false,
        commandExistsFn: (command) => command === 'python3',
      })
    ).toBe('python3');
  });

  it('falls back to python when python3 is unavailable', () => {
    expect(
      resolvePythonRuntime({
        existsSync: () => false,
        commandExistsFn: () => false,
      })
    ).toBe('python');
  });
});
