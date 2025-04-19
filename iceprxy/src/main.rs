use anyhow::{Context, Result};
use axum::{
    routing::get,
    Router,
    extract::State,
    http::{StatusCode, Method},
    response::{IntoResponse, Sse},
    Json,
};
use futures::{stream::{self, Stream}, StreamExt};
use log::{error, info};
use nom::{
    bytes::complete::{tag, take},
    number::complete::le_u32,
    error::Error,
    IResult,
};
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use std::env;
use tower_http::cors::{CorsLayer, Any};
use std::convert::Infallible;
use axum::response::sse::Event;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StreamMetadata {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    #[serde(flatten)]
    other: HashMap<String, String>,
    last_update: u64,
}

impl StreamMetadata {
    fn new() -> Self {
        Self {
            title: "Unknown".to_string(),
            artist: None,
            album: None,
            genre: None,
            other: HashMap::new(),
            last_update: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        }
    }

    fn display(&self) -> String {
        let mut parts = Vec::new();
        if let Some(artist) = &self.artist {
            parts.push(format!("Artist: {}", artist.trim()));
        }
        parts.push(format!("Title: {}", self.title.trim()));
        if let Some(album) = &self.album {
            parts.push(format!("Album: {}", album.trim()));
        }
        if let Some(genre) = &self.genre {
            parts.push(format!("Genre: {}", genre.trim()));
        }
        // Add any other metadata that might contain special characters
        for (key, value) in &self.other {
            if !["artist", "title", "album", "genre"].contains(&key.to_lowercase().as_str()) {
                parts.push(format!("{}: {}", key.trim(), value.trim()));
            }
        }
        parts.join(" | ")
    }

    fn update_from_comment(&mut self, key: &str, value: &str) -> bool {
        let mut updated = false;
        match key.to_lowercase().as_str() {
            "artist" => {
                if self.artist.as_deref() != Some(value) {
                    self.artist = Some(value.to_string());
                    updated = true;
                }
            }
            "title" => {
                if self.title != value {
                    self.title = value.to_string();
                    updated = true;
                }
            }
            "album" => {
                if self.album.as_deref() != Some(value) {
                    self.album = Some(value.to_string());
                    updated = true;
                }
            }
            "genre" => {
                if self.genre.as_deref() != Some(value) {
                    self.genre = Some(value.to_string());
                    updated = true;
                }
            }
            _ => {
                if !self.other.contains_key(key) || self.other.get(key).map(|v| v.as_str()) != Some(value) {
                    self.other.insert(key.to_string(), value.to_string());
                    updated = true;
                }
            }
        }
        if updated {
            self.last_update = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
        }
        updated
    }

    fn is_complete(&self) -> bool {
        self.title != "Unknown" || self.artist.is_some()
    }
}

fn find_vorbis_comment_start(buffer: &[u8]) -> Vec<usize> {
    let mut positions = Vec::new();
    
    // Look for both initial metadata (type 1) and metadata updates (type 3)
    let patterns = [
        // Initial metadata pattern (type 1)
        &[0x01, 0x76, 0x6F, 0x72, 0x62, 0x69, 0x73][..],
        // Metadata update pattern (type 3)
        &[0x03, 0x76, 0x6F, 0x72, 0x62, 0x69, 0x73][..],
    ];

    for pattern in patterns.iter() {
        let mut start = 0;
        while let Some(pos) = buffer[start..].windows(pattern.len())
            .position(|window| window == *pattern)
        {
            let absolute_pos = start + pos + 1; // Skip the packet type byte
            positions.push(absolute_pos);
            start = absolute_pos;
        }
    }

    positions
}

fn parse_length_string(input: &[u8]) -> IResult<&[u8], String, Error<&[u8]>> {
    let (input, length) = le_u32(input)?;
    let (input, bytes) = take(length)(input)?;
    Ok((input, String::from_utf8_lossy(bytes).into_owned()))
}

fn parse_comment(input: &[u8]) -> IResult<&[u8], (String, String), Error<&[u8]>> {
    let (input, length) = le_u32(input)?;
    let (input, comment_bytes) = take(length)(input)?;
    
    // Convert the bytes to a String, preserving all UTF-8 characters
    let comment_str = String::from_utf8_lossy(comment_bytes);
    
    // Split on the first '=' character to separate key and value
    // This preserves any special characters in both key and value
    match comment_str.split_once('=') {
        Some((key, value)) => Ok((input, (
            key.trim().to_string(),
            value.trim().to_string()
        ))),
        None => Ok((input, (comment_str.trim().to_string(), String::new())))
    }
}

fn parse_vorbis_metadata(input: &[u8]) -> Option<StreamMetadata> {
    let mut metadata = StreamMetadata::new();
    let mut current_input = input;
    
    // Skip "vorbis" as we've already found it
    let (input, _) = tag::<_, _, Error<&[u8]>>(b"vorbis")(current_input).ok()?;
    current_input = input;

    // Parse vendor string
    let (input, _vendor) = parse_length_string(current_input).ok()?;
    current_input = input;

    // Parse comment list
    let (input, comment_count) = le_u32::<&[u8], Error<&[u8]>>(current_input).ok()?;
    current_input = input;

    let mut updated = false;
    for _ in 0..comment_count {
        if let Ok((input, (key, value))) = parse_comment(current_input) {
            updated |= metadata.update_from_comment(&key, &value);
            current_input = input;
        } else {
            break;
        }
    }

    if updated {
        Some(metadata)
    } else {
        None
    }
}

type SharedMetadata = Arc<RwLock<Option<StreamMetadata>>>;

type AppState = (SharedMetadata, broadcast::Sender<StreamMetadata>);

async fn get_metadata(State((metadata, _)): State<AppState>) -> impl IntoResponse {
    let metadata = metadata.read().await;
    match &*metadata {
        Some(meta) => (StatusCode::OK, Json(meta.clone())).into_response(),
        None => (StatusCode::NOT_FOUND, "No metadata available").into_response(),
    }
}

async fn get_live_metadata(
    State((metadata, tx)): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = tx.subscribe();
    let initial_metadata = metadata.read().await.clone();
    
    let stream = stream::once(async move {
        // Send current metadata if available
        if let Some(current) = initial_metadata {
            Ok(Event::default().json_data(current).unwrap())
        } else {
            Ok(Event::default().data("No metadata available"))
        }
    }).chain(stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(msg) => Some((Ok(Event::default().json_data(msg).unwrap()), rx)),
            Err(_) => None,
        }
    }));

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("keep-alive-text")
    )
}

async fn stream_processor(url: &str, metadata: SharedMetadata, tx: broadcast::Sender<StreamMetadata>) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .context("Failed to connect to stream")?;

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut seen_metadata = HashSet::new();
    let mut last_output_time = SystemTime::now();
    let mut initial_metadata_found = false;

    info!("🎵 Connected to stream, listening for metadata updates...");

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.context("Failed to read chunk")?;
        buffer.extend_from_slice(&chunk);

        let positions = find_vorbis_comment_start(&buffer);
        for pos in positions {
            if let Some(new_metadata) = parse_vorbis_metadata(&buffer[pos..]) {
                if new_metadata.is_complete() {
                    let now = SystemTime::now();
                    let display = new_metadata.display();
                    
                    if !initial_metadata_found {
                        info!("🎵 {}", display);
                        seen_metadata.insert(display.clone());
                        last_output_time = now;
                        initial_metadata_found = true;
                        *metadata.write().await = Some(new_metadata.clone());
                        let _ = tx.send(new_metadata);
                    } else if !seen_metadata.contains(&display) && 
                              last_output_time.elapsed().unwrap_or(Duration::from_secs(6)) >= Duration::from_secs(5) {
                        info!("🎵 {}", display);
                        seen_metadata.insert(display);
                        last_output_time = now;
                        *metadata.write().await = Some(new_metadata.clone());
                        let _ = tx.send(new_metadata);
                        
                        if seen_metadata.len() > 100 {
                            seen_metadata.clear();
                        }
                    }
                }
            }
        }

        if buffer.len() > 16384 {
            buffer = buffer[buffer.len() - 16384..].to_vec();
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Set default log level to info if not specified
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "info");
    }
    env_logger::init();

    let stream_url = env::var("STREAM_URL")
        .unwrap_or_else(|_| "http://79.120.11.40:8000/chiptune.ogg".to_string());
    
    let metadata = Arc::new(RwLock::new(None));
    let metadata_clone = metadata.clone();
    
    // Create a broadcast channel for SSE updates
    let (tx, _) = broadcast::channel(100);
    let tx_clone = tx.clone();
    let stream_url_clone = stream_url.clone();

    info!("🎵 Starting metadata processor...");
    info!("📻 Streaming from: {}", stream_url);

    // Start the stream processor in a separate task
    tokio::spawn(async move {
        loop {
            info!("🔄 Connecting to stream...");
            if let Err(e) = stream_processor(&stream_url_clone, metadata_clone.clone(), tx_clone.clone()).await {
                error!("Stream processor error: {}", e);
                info!("⏳ Retrying in 5 seconds...");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_methods([Method::GET])
        .allow_origin(Any)
        .allow_headers(Any);

    // Setup the HTTP server
    let app = Router::new()
        .route("/metadata", get(get_metadata))
        .route("/live", get(get_live_metadata))
        .layer(cors)
        .with_state((metadata, tx));

    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("🌐 HTTP server starting on http://localhost:{}", port);
    
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}