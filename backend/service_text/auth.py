import os
from datetime import datetime, timedelta
from typing import Dict, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

try:
    from .records import get_user_by_id, get_user_by_username  # type: ignore
except Exception:
    from records import get_user_by_id, get_user_by_username


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-secret")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


class TokenData(BaseModel):
    sub: Optional[str] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:
        return False


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def sanitize_user(user: Dict) -> Dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "nickname": user["nickname"],
        "created_at": user["created_at"],
    }


def authenticate_user(username: str, password: str) -> Optional[Dict]:
    user = get_user_by_username(username.strip().lower())
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return sanitize_user(user)


def create_access_token(data: Dict[str, str], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        token_data = TokenData(sub=user_id)
    except JWTError as exc:  # pragma: no cover - defensive guard
        raise credentials_exception from exc
    user = get_user_by_id(token_data.sub)
    if user is None:
        raise credentials_exception
    return sanitize_user(user)


async def get_current_user_optional(token: Optional[str] = Depends(oauth2_scheme_optional)) -> Optional[Dict]:
    if not token:
        return None
    return await get_current_user(token=token)
