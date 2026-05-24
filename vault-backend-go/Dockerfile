# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the application
RUN go build -o vault-server cmd/api/main.go

# Run stage
FROM alpine:latest

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/vault-server .

# Create a directory for storage if needed (local storage)
RUN mkdir -p /app/storage

# Expose the port the app runs on
EXPOSE 8080

# Command to run the executable
CMD ["./vault-server"]
