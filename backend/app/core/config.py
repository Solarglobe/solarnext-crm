from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_ENV: str
    APP_NAME: str
    APP_DOMAIN: str

    DATABASE_URL: str

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int

    MAIL_GLOBAL_IMAP_HOST: str
    MAIL_GLOBAL_IMAP_PORT: int
    MAIL_GLOBAL_SMTP_HOST: str
    MAIL_GLOBAL_SMTP_PORT: int
    MAIL_GLOBAL_EMAIL: str
    MAIL_GLOBAL_PASSWORD: str

    STORAGE_PROVIDER: str
    STORAGE_S3_ENDPOINT: str
    STORAGE_S3_BUCKET: str
    STORAGE_S3_ACCESS_KEY: str
    STORAGE_S3_SECRET_KEY: str

    LOG_LEVEL: str

    class Config:
        env_file = ".env.dev"


@lru_cache
def get_settings():
    return Settings()


settings = get_settings()
