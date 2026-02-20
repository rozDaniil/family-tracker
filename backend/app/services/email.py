import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_resend_configured() -> bool:
    return bool(settings.resend_api_key and settings.resend_sender_email)


def _send_resend_email(*, to_email: str, subject: str, html_content: str, text_content: str) -> bool:
    if not is_resend_configured():
        logger.info("Resend email skipped: service is not configured")
        return False

    from_header = f"{settings.resend_sender_name} <{settings.resend_sender_email}>"
    payload = {
        "from": from_header,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
        "text": text_content,
    }
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": f"Bearer {settings.resend_api_key}",
    }

    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(f"{settings.resend_api_base_url}/emails", json=payload, headers=headers)
        if response.status_code >= 400:
            logger.warning("Resend send failed (%s): %s", response.status_code, response.text)
            return False
        return True
    except httpx.HTTPError as exc:
        logger.warning("Resend send exception: %s", exc)
        return False


def send_verify_email(*, to_email: str, display_name: str, verify_url: str) -> bool:
    subject = "Confirm your email for Family Life"
    html = (
        f"<p>Hello, {display_name}!</p>"
        "<p>Confirm your email to complete registration in Family Life.</p>"
        f'<p><a href="{verify_url}">Confirm email</a></p>'
        "<p>If you did not sign up, you can ignore this message.</p>"
    )
    text = (
        f"Hello, {display_name}!\\n\\n"
        "Confirm your email to complete registration in Family Life.\\n"
        f"{verify_url}\\n\\n"
        "If you did not sign up, you can ignore this message."
    )
    return _send_resend_email(
        to_email=to_email,
        subject=subject,
        html_content=html,
        text_content=text,
    )


def send_invite_email(*, to_email: str, inviter_name: str, project_name: str, invite_url: str) -> bool:
    subject = f"Invitation to family calendar \"{project_name}\""
    html = (
        f"<p>{inviter_name} invited you to the family calendar \"{project_name}\".</p>"
        f'<p><a href="{invite_url}">Accept invitation</a></p>'
        "<p>If the link does not open, copy and paste it into your browser.</p>"
    )
    text = (
        f"{inviter_name} invited you to the family calendar \"{project_name}\".\\n\\n"
        f"Accept invitation: {invite_url}\\n\\n"
        "If the link does not open, copy and paste it into your browser."
    )
    return _send_resend_email(
        to_email=to_email,
        subject=subject,
        html_content=html,
        text_content=text,
    )
