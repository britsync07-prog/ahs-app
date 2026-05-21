# Vault Backend Go - Infrastructure

This is the "Blind Cloud" component of the Zero-Knowledge Biometric Vault.

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Go 1.21+ (for development)

### Setup Infrastructure

1.  **Environment Variables**:
    Copy the example environment file and adjust if necessary.
    ```bash
    cp .env.example .env
    ```

2.  **Start Services**:
    Run the following command to start PostgreSQL and MinIO in the background:
    ```bash
    docker compose up -d
    ```

### Service Access
- **PostgreSQL**: `localhost:5434`
- **MinIO API**: `localhost:9000`
- **MinIO Console**: [http://localhost:9001](http://localhost:9001)

## Directory Structure
- `cmd/`: Application entry point.
- `internal/api/`: HTTP/WebSocket handlers and middleware.
- `internal/db/`: Database logic (migrations, models, repository).
- `internal/storage/`: MinIO/S3 storage interface.
- `internal/auth/`: Cryptographic signaling and authentication logic.
- `pkg/`: Shared utility packages.
