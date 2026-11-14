"""Daily local server. The bind address is deliberately not configurable."""
import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Ruang on this computer only.")
    parser.add_argument("--port", type=int, default=8000)
    options = parser.parse_args()
    if not 1 <= options.port <= 65535:
        parser.error("port must be between 1 and 65535")
    os.environ.setdefault("RUANG_DEBUG", "0")
    from config.wsgi import application
    from waitress import serve

    print(f"Ruang tersedia di http://127.0.0.1:{options.port}", flush=True)
    serve(application, host="127.0.0.1", port=options.port, threads=4, max_request_body_size=32 * 1024 * 1024)


if __name__ == "__main__":
    main()

