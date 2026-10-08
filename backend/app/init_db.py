from backend.app.database import engine, Base
from backend.app import models  # noqa: F401

def init_db():
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully.")

if __name__ == "__main__":
    init_db()
