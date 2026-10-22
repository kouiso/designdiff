import ctypes
import os
import sys

if len(sys.argv) < 2:
    raise SystemExit('Usage: reap-children.py command [args...]')
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER failed')
command_pid = os.fork()
if command_pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
exit_code = None
while True:
    try:
        pid, status = os.wait()
    except ChildProcessError:
        break
    if pid == command_pid:
        exit_code = os.waitstatus_to_exitcode(status)
if exit_code is None:
    raise RuntimeError('Command outcome was not observed')
raise SystemExit(exit_code if exit_code >= 0 else 128 - exit_code)
