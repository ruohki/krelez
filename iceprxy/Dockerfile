# Builder stage
FROM rust:latest AS builder

WORKDIR /usr/src/app
COPY . .

# Build for release
RUN cargo build --release

# Final stage
FROM debian:bookworm-slim

# Install SSL dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    libssl3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /usr/src/app/target/release/iceprxy .

# Create a non-root user
RUN useradd -m -u 1001 iceprxy
USER iceprxy

# Run the binary
CMD ["./iceprxy"]
