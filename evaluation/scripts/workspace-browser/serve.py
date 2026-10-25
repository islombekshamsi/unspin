import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(H, directory="/tmp/unspin-files")).serve_forever()
