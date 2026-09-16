import importlib.util
import pathlib
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import requests

source = pathlib.Path(__file__).parents[1] / 'services/shading/trees/public_http.py'
spec = importlib.util.spec_from_file_location('public_http', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicHttpTests(unittest.TestCase):
    def request(self, statuses, method='GET', range_header=None):
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def do_GET(self):
                index = len(calls)
                calls.append(self.headers.get('Range'))
                status = statuses[min(index, len(statuses) - 1)]
                self.send_response(status)
                self.send_header('Content-Length', '2')
                self.send_header('Retry-After', '3600')
                self.end_headers()
                self.wfile.write(b'{}')

            do_POST = do_GET

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with module.resilient_session(requests.Session()) as session:
                response = session.request(method, f'http://127.0.0.1:{server.server_port}',
                                           headers={'Range': range_header} if range_header else {}, timeout=2)
                return response.status_code, calls
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_temporary_failure_recovers(self):
        status, calls = self.request([503, 429, 200])
        self.assertEqual((status, len(calls)), (200, 3))

    def test_failure_is_bounded_and_never_becomes_success(self):
        status, calls = self.request([503])
        self.assertEqual((status, len(calls)), (503, 3))

    def test_missing_coverage_is_not_retried(self):
        status, calls = self.request([404])
        self.assertEqual((status, len(calls)), (404, 1))

    def test_copc_range_preserved_on_retry(self):
        status, calls = self.request([502, 206], range_header='bytes=100-199')
        self.assertEqual(status, 206)
        self.assertEqual(calls, ['bytes=100-199', 'bytes=100-199'])

    def test_mutating_request_never_retried(self):
        status, calls = self.request([503], method='POST')
        self.assertEqual((status, len(calls)), (503, 1))


if __name__ == '__main__': unittest.main()
