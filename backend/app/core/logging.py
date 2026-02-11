import logging
import re

_INSTALLED = False

_SENSITIVE_PATTERNS = [
    re.compile(r'("?(?:password|current_password|new_password|token|access_token|refresh_token|authorization|cookie|csrf_token)"?\s*[:=]\s*)"[^"]*"', re.IGNORECASE),
    re.compile(r"((?:password|current_password|new_password|token|access_token|refresh_token|authorization|cookie|csrf_token)\s*[:=]\s*)\S+", re.IGNORECASE),
]


def _redact_text(value: str) -> str:
    redacted = value
    for pattern in _SENSITIVE_PATTERNS:
        redacted = pattern.sub(r'\1"[REDACTED]"', redacted)
    return redacted


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        record.msg = _redact_text(message)
        record.args = ()
        return True


def _install_filter_on_logger(logger: logging.Logger, filt: logging.Filter) -> None:
    if not any(existing is filt for existing in logger.filters):
        logger.addFilter(filt)
    for handler in logger.handlers:
        if not any(existing is filt for existing in handler.filters):
            handler.addFilter(filt)


def setup_sensitive_log_redaction() -> None:
    global _INSTALLED
    if _INSTALLED:
        return

    filt = SensitiveDataFilter()
    targets: list[logging.Logger] = [
        logging.getLogger(),
        logging.getLogger("uvicorn"),
        logging.getLogger("uvicorn.access"),
        logging.getLogger("uvicorn.error"),
        logging.getLogger("fastapi"),
    ]
    for logger in targets:
        _install_filter_on_logger(logger, filt)
    _INSTALLED = True
