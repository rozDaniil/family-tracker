import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any


# Existing invite helpers

def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Generic one-time token helpers

def generate_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Password hashing (PBKDF2-HMAC-SHA256)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 150_000)
    return f"pbkdf2_sha256${base64.urlsafe_b64encode(salt).decode('utf-8')}${base64.urlsafe_b64encode(derived).decode('utf-8')}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt_b64, hash_b64 = encoded.split("$", 2)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode("utf-8"))
        expected = base64.urlsafe_b64decode(hash_b64.encode("utf-8"))
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 150_000)
    return hmac.compare_digest(actual, expected)


# JWT (HS256)

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def create_access_token(payload: dict[str, Any], secret: str, ttl_minutes: int) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    exp = int((datetime.now(UTC) + timedelta(minutes=ttl_minutes)).timestamp())
    body = {**payload, "exp": exp}
    h = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    b = _b64url_encode(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{h}.{b}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    s = _b64url_encode(sig)
    return f"{h}.{b}.{s}"


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    h, b, s = parts
    signing_input = f"{h}.{b}".encode("utf-8")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        provided_sig = _b64url_decode(s)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, provided_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(b).decode("utf-8"))
    except Exception:
        return None
    exp = payload.get("exp")
    if not isinstance(exp, int):
        return None
    if datetime.now(UTC).timestamp() > exp:
        return None
    return payload


# CSRF token signing

def sign_csrf_token(raw: str, secret: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{raw}.{mac}"


def verify_csrf_token(token: str, secret: str) -> bool:
    try:
        raw, mac = token.rsplit(".", 1)
    except ValueError:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, expected)
