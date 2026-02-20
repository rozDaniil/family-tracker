from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Family Life Calendar API"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./family_life_calendar.db"
    cors_origins: list[str] = ["http://localhost:3000"]
    invite_rate_limit_per_minute: int = 20
    jwt_secret: str = "dev-jwt-secret-change-me"
    csrf_secret: str = "dev-csrf-secret-change-me"
    access_cookie_name: str = "flc_access"
    refresh_cookie_name: str = "flc_refresh"
    csrf_cookie_name: str = "flc_csrf"
    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 30
    frontend_url: str = "http://localhost:3000"
    resend_api_key: str | None = None
    resend_sender_email: str | None = None
    resend_sender_name: str = "Family Life"
    resend_api_base_url: str = "https://api.resend.com"
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str | None = None
    auth_allow_legacy_session: bool = False
    db_connect_timeout_seconds: int = 5

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
