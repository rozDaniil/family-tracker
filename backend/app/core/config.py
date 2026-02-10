from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Family Life Calendar API"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./family_life_calendar.db"
    cors_origins: list[str] = ["http://localhost:3000"]
    invite_rate_limit_per_minute: int = 20

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
