import os

# The background poller must not run inside tests: they drive the engine explicitly.
os.environ.setdefault("EDEN_POLL_SECONDS", "0")
