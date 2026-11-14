"""Pure input-session scope rules; no native hooks, clipboard, Django, or process APIs."""
from workspace.capture_common import KEYBOARD_APPLICATIONS, utc_now


def normalized_applications(applications):
    if not isinstance(applications, list) or not applications or len(applications) > len(KEYBOARD_APPLICATIONS):
        raise ValueError("Pilih minimal satu aplikasi yang didukung.")
    selected = []
    for value in applications:
        if not isinstance(value, str) or value.lower() not in KEYBOARD_APPLICATIONS:
            raise ValueError("Aplikasi tidak didukung untuk sesi input.")
        name = value.lower()
        if name not in selected:
            selected.append(name)
    return selected


class InputBuffer:
    """Only already-scoped events enter this buffer; boundary events contain no text."""
    def __init__(self, applications, on_line):
        self.applications = frozenset(normalized_applications(applications))
        self.on_line = on_line
        self.application = None
        self.text = ""
        self.last_timestamp = None

    def flush(self):
        if self.text and self.application:
            self.on_line(self.application, self.text, self.last_timestamp or utc_now())
        self.text = ""
        self.last_timestamp = None

    def consume(self, application, action, value="", timestamp=None):
        if application not in self.applications or action == "boundary":
            self.flush()
            self.application = None
            return
        if application != self.application:
            self.flush()
            self.application = application
        self.last_timestamp = timestamp or utc_now()
        if action == "enter":
            self.flush()
        elif action == "backspace":
            self.text = self.text[:-1]
        elif action == "text":
            self.text += value
            if len(self.text) >= 8192:
                self.flush()
