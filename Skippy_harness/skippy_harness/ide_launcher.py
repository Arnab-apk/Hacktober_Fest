"""Run the unchanged interactive CLI with the IDE's project/room agent lease."""
import json
import os
import sys
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main():
    endpoint = os.environ.pop('SKIPPY_TERMINAL_URL', '')
    token = os.environ.pop('SKIPPY_TERMINAL_TOKEN', '')
    if not endpoint or not token:
        from .agent import main as cli
        cli()
        return

    def request(action):
        payload = json.dumps({'token': token}).encode('utf-8')
        req = Request(endpoint + '/' + action, data=payload,
                      headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urlopen(req, timeout=5) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                detail = json.load(error).get('error', str(error))
            except (ValueError, OSError):
                detail = str(error)
            raise RuntimeError(detail) from error
        except (URLError, OSError) as error:
            raise RuntimeError('The IDE terminal service is unavailable.') from error

    try:
        request('claim')
    except RuntimeError as error:
        print('Skippy: ' + str(error), file=sys.stderr)
        raise SystemExit(1)

    stopped = threading.Event()

    def heartbeat():
        failures = 0
        while not stopped.wait(8):
            try:
                request('heartbeat')
                failures = 0
            except RuntimeError:
                failures += 1
                if failures >= 3:
                    print('Skippy stopped: lost the IDE agent lease. Reopen Skippy to continue your saved session.', file=sys.stderr, flush=True)
                    os._exit(1)

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        from .agent import main as cli
        cli()
    finally:
        stopped.set()
        worker.join(timeout=6)
        try:
            request('release')
        except RuntimeError:
            pass


if __name__ == '__main__':
    main()
