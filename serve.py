#!/usr/bin/env python3
"""Мини-сервер для запуска Veloria: python3 serve.py [порт]"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # игра генерирует всё на лету — кэш только мешает при правках
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    os.chdir(ROOT)
    handler = partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    print(f'Veloria: http://localhost:{PORT}')
    sys.stdout.flush()
    httpd.serve_forever()
